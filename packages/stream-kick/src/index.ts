import type { StreamEvent } from '@amctk/shared'
import { BaseStreamAdapter, FatalStreamError, type StreamLogger } from '@amctk/stream-core'

export * from './chatroom'
export * from './pusher'
export * from './slug'

export interface KickOptions {
  /** 例: wss://amctk-relay.<account>.workers.dev */
  relayUrl: string
  channelSlug: string
  relaySecret: string
}

/**
 * Kick（公式API）
 * 公式Webhookは公開URLが必要なため、Cloudflare Worker (workers/stream-relay) で受けて
 * WebSocketでアプリへ中継する。Relayが落ちてもKickだけがDegradedになる。
 */
export class KickRelayAdapter extends BaseStreamAdapter {
  readonly platform = 'kick' as const
  protected readonly stability = 'beta' as const
  private ws?: WebSocket
  private ping?: ReturnType<typeof setInterval>

  constructor(private options: KickOptions, log?: StreamLogger) {
    super(log)
  }

  protected async open() {
    if (!this.options.relayUrl) throw new FatalStreamError('Relay URL が未設定です')
    if (!this.options.relaySecret) throw new FatalStreamError('Relay Secret が未設定です')
    const base = this.options.relayUrl.replace(/^http/, 'ws').replace(/\/$/, '')
    const ws = new WebSocket(`${base}/ws`)
    this.ws = ws
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Relayへの接続がタイムアウトしました')), 10_000)
      ws.onopen = () => {
        // 認証はURLではなく最初のメッセージで送る
        ws.send(JSON.stringify({ type: 'auth', token: this.options.relaySecret, channel: this.options.channelSlug }))
      }
      ws.onmessage = (ev) => {
        const msg = safeJson(String(ev.data))
        if (!msg) return
        if (msg.type === 'auth_ok') {
          clearTimeout(timer)
          this.markHealthy('Cloud Relay 経由で受信中')
          resolve()
          return
        }
        if (msg.type === 'auth_error') {
          clearTimeout(timer)
          reject(new FatalStreamError('Relay Secret が一致しません'))
          return
        }
        if (msg.type === 'kick') {
          const e = mapKickWebhook(String(msg.event ?? ''), (msg.data ?? {}) as Record<string, unknown>, String(msg.id ?? ''))
          if (e) this.emit(e)
        }
      }
      ws.onclose = () => {
        clearTimeout(timer)
        if (this.ws === ws) this.scheduleReconnect('Relayとの接続が切れました')
      }
    })
    this.ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('{"type":"ping"}'), 25_000)
  }

  protected async close() {
    if (this.ping) clearInterval(this.ping)
    const ws = this.ws
    this.ws = undefined
    ws?.close()
  }
}

function safeJson(s: string): Record<string, unknown> | null {
  try {
    return JSON.parse(s) as Record<string, unknown>
  } catch {
    return null
  }
}

type Obj = Record<string, unknown>

export function mapKickWebhook(event: string, data: Obj, id: string): StreamEvent | null {
  const user = (o: unknown) => {
    const u = (o ?? {}) as Obj
    return {
      platform: 'kick' as const,
      platformUserId: String(u.user_id ?? u.username ?? 'anon'),
      displayName: String(u.username ?? u.channel_slug ?? 'anonymous'),
    }
  }
  const base = { id: `kick:${id || String(data.message_id ?? Date.now())}`, platform: 'kick' as const, receivedAt: Date.now() }
  switch (event) {
    case 'chat.message.sent': {
      const sender = (data.sender ?? {}) as Obj
      const badges = (((sender.identity ?? {}) as Obj).badges ?? []) as { type?: string }[]
      return {
        ...base,
        kind: 'chat',
        text: String(data.content ?? ''),
        viewer: {
          ...user(sender),
          isModerator: badges.some((b) => b.type === 'moderator'),
          isMember: badges.some((b) => b.type === 'subscriber'),
          isOwner: badges.some((b) => b.type === 'broadcaster'),
        },
      }
    }
    case 'channel.followed':
      return { ...base, kind: 'follow', text: 'フォローしました', viewer: user(data.follower) }
    case 'channel.subscription.new':
    case 'channel.subscription.renewal':
      return { ...base, kind: 'subscribe', text: 'サブスクしました', viewer: user(data.subscriber) }
    case 'channel.subscription.gifts': {
      const giftees = Array.isArray(data.giftees) ? data.giftees.length : 1
      return { ...base, kind: 'gift', text: `サブスクを${giftees}件ギフト`, viewer: user(data.gifter) }
    }
    case 'kicks.gifted': {
      const gift = (data.gift ?? {}) as Obj
      const amount = Number(gift.amount ?? 0)
      return {
        ...base,
        kind: 'superchat',
        text: String(gift.message ?? gift.name ?? 'Kicks'),
        amount: { value: amount, currency: 'KICKS', display: `${amount} Kicks` },
        viewer: user(data.sender),
      }
    }
    default:
      return null
  }
}
