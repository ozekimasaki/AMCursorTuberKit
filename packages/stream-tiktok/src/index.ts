import type { StreamEvent, StreamEventKind } from '@amctk/shared'
import { BaseStreamAdapter, FatalStreamError, type StreamLogger } from '@amctk/stream-core'

export interface TikTokBridgeOptions {
  /** 例: ws://127.0.0.1:21213 */
  bridgeUrl: string
  uniqueId?: string
  token?: string
}

/**
 * TikTok LIVE（Experimental）
 * 一般開発者向けの公式なLIVEコメント取得手段が明確でないため、アプリ本体ではスクレイピングを行わない。
 * 外部のブリッジ（TikFinity等）が流すJSONをWebSocketで受け取り、共通イベントへ正規化するだけにする。
 * Provider差し替え式なので、公式APIが提供されたらこのAdapterを置き換える。
 */
export class TikTokBridgeAdapter extends BaseStreamAdapter {
  readonly platform = 'tiktok' as const
  protected readonly stability = 'experimental' as const
  private ws?: WebSocket
  private seq = 0

  constructor(private options: TikTokBridgeOptions, log?: StreamLogger) {
    super(log)
  }

  protected async open() {
    if (!this.options.bridgeUrl) throw new FatalStreamError('ブリッジURLが未設定です')
    const ws = new WebSocket(this.options.bridgeUrl)
    this.ws = ws
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('ブリッジに接続できません')), 8000)
      ws.onopen = () => {
        clearTimeout(timer)
        if (this.options.token || this.options.uniqueId) {
          ws.send(JSON.stringify({ type: 'auth', token: this.options.token, uniqueId: this.options.uniqueId }))
        }
        this.markHealthy('ブリッジ経由で受信中（Experimental）')
        resolve()
      }
      ws.onmessage = (ev) => {
        try {
          const e = normalizeTikTokBridgeMessage(JSON.parse(String(ev.data)), ++this.seq)
          if (e) this.emit(e)
        } catch {
          /* ignore non JSON */
        }
      }
      ws.onclose = () => {
        clearTimeout(timer)
        if (this.ws === ws) this.scheduleReconnect('ブリッジとの接続が切れました')
      }
    })
  }

  protected async close() {
    const ws = this.ws
    this.ws = undefined
    ws?.close()
  }
}

type Obj = Record<string, unknown>

/** TikFinity / TikTok-Live-Connector 系のメッセージ形式をゆるく受け付ける */
export function normalizeTikTokBridgeMessage(raw: unknown, seq: number): StreamEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const msg = raw as Obj
  const event = String(msg.event ?? msg.type ?? '').toLowerCase()
  const d = ((msg.data ?? msg) as Obj) ?? {}
  const pick = (...keys: string[]) => {
    for (const k of keys) if (typeof d[k] === 'string' || typeof d[k] === 'number') return String(d[k])
    const user = d.user as Obj | undefined
    if (user) for (const k of keys) if (typeof user[k] === 'string') return String(user[k])
    return ''
  }
  let kind: StreamEventKind
  let text = pick('comment', 'text', 'message')
  let amount: StreamEvent['amount']
  switch (event) {
    case 'chat':
    case 'comment':
      kind = 'chat'
      break
    case 'gift': {
      kind = 'gift'
      const count = Number(d.repeatCount ?? 1)
      const diamonds = Number(d.diamondCount ?? 0) * count
      text = `${pick('giftName') || 'ギフト'} x${count}`
      if (diamonds) amount = { value: diamonds, currency: 'diamonds', display: `${diamonds} diamonds` }
      if (d.repeatEnd === false) return null
      break
    }
    case 'follow':
      kind = 'follow'
      text = 'フォローしました'
      break
    case 'subscribe':
      kind = 'subscribe'
      text = 'サブスクしました'
      break
    default:
      return null
  }
  const userId = pick('userId', 'uniqueId') || 'anon'
  return {
    id: `tt:${pick('msgId') || `${userId}-${seq}-${Date.now()}`}`,
    platform: 'tiktok',
    kind,
    text,
    amount,
    receivedAt: Date.now(),
    viewer: {
      platform: 'tiktok',
      platformUserId: userId,
      displayName: pick('nickname', 'uniqueId') || 'viewer',
      isModerator: Boolean(d.isModerator),
      isMember: Boolean(d.isSubscriber),
    },
  }
}
