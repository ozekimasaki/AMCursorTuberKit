import type { StreamEvent, StreamViewer } from '@amctk/shared'
import { BaseStreamAdapter, FatalStreamError, type StreamLogger } from '@amctk/stream-core'

/** Kick の Web 版が使っている Pusher の接続先。公開仕様ではないため、変わったらここを更新する */
const PUSHER_URL = 'wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0&flash=false'

/** 受け取っても使わないイベント（未知のイベントとしてログに残さない） */
const IGNORED_EVENTS = new Set(
  [
    'MessageDeletedEvent',
    'PinnedMessageCreatedEvent',
    'PinnedMessageDeletedEvent',
    'UserBannedEvent',
    'UserUnbannedEvent',
    'PollUpdateEvent',
    'PollDeleteEvent',
    'ChatroomUpdatedEvent',
    'ChatroomClearEvent',
  ].map((e) => `App\\Events\\${e}`),
)

export interface KickPusherOptions {
  /** チャンネル名 / チャンネルURL */
  channelSlug: string
  /** 手動で指定したチャットルームID。無ければ resolveChatroomId で調べる */
  chatroomId?: number
  /** slug からチャットルームIDを調べる。Kick の API は Cloudflare に保護されているため、呼び出し側（Electron）で実装する */
  resolveChatroomId(slug: string): Promise<number>
}

type Obj = Record<string, unknown>

export function normalizeKickSlug(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\/(?:www\.)?kick\.com\//i, '')
    .replace(/^@/, '')
    .split(/[/?#]/)[0]
    .toLowerCase()
}

/**
 * Kick チャット（APIキー不要）
 * Kick の Web 版と同じ Pusher WebSocket を購読する。公式 Webhook と違って中継サーバーは要らないが、
 * 接続キーやイベント名は予告なく変わる可能性がある。
 */
export class KickPusherAdapter extends BaseStreamAdapter {
  readonly platform = 'kick' as const
  protected readonly stability = 'beta' as const
  private ws?: WebSocket
  private watchdog?: ReturnType<typeof setInterval>
  private chatroomId?: number
  private unknownEvents = new Set<string>()

  constructor(
    private options: KickPusherOptions,
    log?: StreamLogger,
  ) {
    super(log)
  }

  protected async open() {
    const slug = normalizeKickSlug(this.options.channelSlug)
    if (!slug) throw new FatalStreamError('チャンネル名を入力してください')
    this.chatroomId ??= this.options.chatroomId || (await this.options.resolveChatroomId(slug))
    await this.listen(this.chatroomId, slug)
  }

  protected async close() {
    this.stopWatchdog()
    const ws = this.ws
    this.ws = undefined
    ws?.close()
  }

  private listen(chatroomId: number, slug: string) {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(PUSHER_URL)
      this.ws = ws
      let settled = false
      let lastMessageAt = Date.now()
      let activityTimeoutMs = 120_000
      const settle = (err?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (err) reject(err)
        else resolve()
      }
      // 失敗で閉じるときは先に切り離し、onclose からの再接続と二重にならないようにする
      const abandon = (err: Error) => {
        if (this.ws === ws) this.ws = undefined
        this.stopWatchdog()
        ws.close()
        settle(err)
      }
      const timer = setTimeout(() => abandon(new Error('Kick チャットへの接続がタイムアウトしました')), 15_000)

      ws.onmessage = (ev) => {
        lastMessageAt = Date.now()
        const msg = safeJson(String(ev.data))
        if (!msg || typeof msg.event !== 'string') return
        const data = (typeof msg.data === 'string' ? safeJson(msg.data) : (msg.data as Obj | undefined)) ?? {}
        switch (msg.event) {
          case 'pusher:connection_established':
            activityTimeoutMs = Number(data.activity_timeout ?? 120) * 1000
            ws.send(
              JSON.stringify({ event: 'pusher:subscribe', data: { auth: '', channel: `chatrooms.${chatroomId}.v2` } }),
            )
            return
          case 'pusher_internal:subscription_succeeded':
            settle()
            this.markHealthy(`${slug} のチャットを受信中`)
            this.startWatchdog(ws, () => lastMessageAt, activityTimeoutMs)
            return
          case 'pusher:ping':
            ws.send(JSON.stringify({ event: 'pusher:pong', data: {} }))
            return
          case 'pusher:error': {
            const code = Number(data.code ?? 0)
            this.log('warn', 'kick pusher error', { code, message: String(data.message ?? '') })
            // 4000〜4099 は再接続しても直らない（接続キーの変更など）
            if (code >= 4000 && code < 4100) {
              const err = new FatalStreamError(
                `Kick のチャットに接続できません（${code}）。仕様が変わった可能性があるため、公式APIへの切り替えを検討してください`,
              )
              if (settled) {
                this.stopped = true
                this.setState('error', err.message)
              }
              abandon(err)
            }
            return
          }
        }
        if (msg.event.startsWith('pusher')) return
        const e = mapKickPusherEvent(msg.event, data)
        if (e) this.emit(e)
        else if (!IGNORED_EVENTS.has(msg.event) && !this.unknownEvents.has(msg.event)) {
          this.unknownEvents.add(msg.event)
          this.log('info', 'kick unknown event', { event: msg.event, keys: Object.keys(data) })
        }
      }
      ws.onclose = (ev) => {
        const current = this.ws === ws
        if (current) this.stopWatchdog()
        if (!settled) settle(new Error(`Kick チャットとの接続が切れました (${ev.code})`))
        else if (current) this.scheduleReconnect('Kick チャットとの接続が切れました')
      }
      ws.onerror = () => {
        /* onclose で処理する */
      }
    })
  }

  /** 無通信が続いたら ping を送り、それでも応答が無ければ切断して再接続させる */
  private startWatchdog(ws: WebSocket, lastMessageAt: () => number, activityTimeoutMs: number) {
    this.stopWatchdog()
    this.watchdog = setInterval(() => {
      const idle = Date.now() - lastMessageAt()
      if (idle > activityTimeoutMs + 30_000) ws.close()
      else if (idle > activityTimeoutMs / 2 && ws.readyState === WebSocket.OPEN)
        ws.send('{"event":"pusher:ping","data":{}}')
    }, 15_000)
  }

  private stopWatchdog() {
    if (this.watchdog) clearInterval(this.watchdog)
    this.watchdog = undefined
  }
}

function safeJson(s: string): Obj | null {
  try {
    const v = JSON.parse(s) as unknown
    return v && typeof v === 'object' ? (v as Obj) : null
  } catch {
    return null
  }
}

function viewerByName(username: string): StreamViewer {
  return { platform: 'kick', platformUserId: username, displayName: username }
}

/** Kick のエモート表記 [emote:123:name] を :name: にする */
function kickText(content: string): string {
  return content.replace(/\[emote:\d+:([^\]]*)\]/g, ':$1:')
}

export function mapKickPusherEvent(event: string, data: Obj): StreamEvent | null {
  const now = Date.now()
  switch (event.replace(/^App\\Events\\/, '')) {
    case 'ChatMessageEvent': {
      if (!data.id) return null
      const sender = (data.sender ?? {}) as Obj
      const badges = ((sender.identity ?? {}) as Obj).badges
      const has = (type: string) => Array.isArray(badges) && badges.some((b) => (b as Obj | null)?.type === type)
      return {
        id: `kick:${String(data.id)}`,
        platform: 'kick',
        kind: 'chat',
        text: kickText(String(data.content ?? '')),
        receivedAt: now,
        viewer: {
          platform: 'kick',
          platformUserId: String(sender.id ?? sender.username ?? 'anon'),
          displayName: String(sender.username ?? 'anonymous'),
          isModerator: has('moderator'),
          isMember: has('subscriber') || has('founder'),
          isOwner: has('broadcaster'),
        },
      }
    }
    case 'SubscriptionEvent': {
      const name = String(data.username ?? 'anonymous')
      const months = Number(data.months ?? 1)
      return {
        id: `kick:sub:${name}:${months}:${now}`,
        platform: 'kick',
        kind: 'subscribe',
        text: `サブスクしました（${months}か月）`,
        receivedAt: now,
        viewer: viewerByName(name),
      }
    }
    case 'GiftedSubscriptionsEvent': {
      const gifter = String(data.gifter_username ?? 'anonymous')
      const count = Array.isArray(data.gifted_usernames) ? data.gifted_usernames.length : 1
      return {
        id: `kick:gift:${gifter}:${now}`,
        platform: 'kick',
        kind: 'gift',
        text: `サブスクを${count}件ギフト`,
        receivedAt: now,
        viewer: viewerByName(gifter),
      }
    }
    case 'StreamHostEvent': {
      const host = String(data.host_username ?? 'anonymous')
      const note = String(data.optional_message ?? '').trim()
      return {
        id: `kick:host:${host}:${now}`,
        platform: 'kick',
        kind: 'raid',
        text: note || `${Number(data.number_viewers ?? 0)}人でホストしました`,
        receivedAt: now,
        viewer: viewerByName(host),
      }
    }
    default:
      return null
  }
}
