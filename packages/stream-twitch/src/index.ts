import type { StreamEvent, StreamEventKind } from '@amctk/shared'
import { BaseStreamAdapter, FatalStreamError, type StreamLogger } from '@amctk/stream-core'

export * from './irc'

const EVENTSUB_WS = 'wss://eventsub.wss.twitch.tv/ws'
const HELIX = 'https://api.twitch.tv/helix'
const ID = 'https://id.twitch.tv/oauth2'
export const TWITCH_SCOPES = ['user:read:chat']

export interface TwitchTokens {
  accessToken: string
  refreshToken?: string
}

export interface TwitchOptions {
  clientId: string
  channelLogin: string
  getTokens(): Promise<TwitchTokens | null>
  saveTokens(tokens: TwitchTokens): Promise<void>
}

/* ---------------- Device Code Flow（Client Secret不要） ---------------- */

export interface DeviceCodeStart {
  deviceCode: string
  userCode: string
  verificationUri: string
  interval: number
  expiresIn: number
}

export async function startDeviceFlow(clientId: string): Promise<DeviceCodeStart> {
  const res = await fetch(`${ID}/device`, {
    method: 'POST',
    body: new URLSearchParams({ client_id: clientId, scopes: TWITCH_SCOPES.join(' ') }),
  })
  const json = (await res.json()) as Record<string, unknown>
  if (!res.ok) throw new Error(`Twitch device flow: ${String(json.message ?? res.status)}`)
  return {
    deviceCode: String(json.device_code),
    userCode: String(json.user_code),
    verificationUri: String(json.verification_uri),
    interval: Number(json.interval ?? 5),
    expiresIn: Number(json.expires_in ?? 1800),
  }
}

export async function pollDeviceToken(clientId: string, start: DeviceCodeStart, signal?: AbortSignal): Promise<TwitchTokens> {
  const deadline = Date.now() + start.expiresIn * 1000
  let interval = start.interval
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval * 1000))
    if (signal?.aborted) throw new Error('cancelled')
    const res = await fetch(`${ID}/token`, {
      method: 'POST',
      body: new URLSearchParams({
        client_id: clientId,
        scopes: TWITCH_SCOPES.join(' '),
        device_code: start.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    })
    const json = (await res.json()) as Record<string, unknown>
    if (res.ok) return { accessToken: String(json.access_token), refreshToken: String(json.refresh_token ?? '') }
    const msg = String(json.message ?? '')
    if (msg === 'authorization_pending') continue
    if (msg === 'slow_down') {
      interval += 2
      continue
    }
    throw new Error(`Twitch認証に失敗しました: ${msg || res.status}`)
  }
  throw new Error('Twitch認証の有効期限が切れました')
}

export async function refreshTwitchToken(clientId: string, refreshToken: string): Promise<TwitchTokens> {
  const res = await fetch(`${ID}/token`, {
    method: 'POST',
    body: new URLSearchParams({ client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken }),
  })
  const json = (await res.json()) as Record<string, unknown>
  if (!res.ok) throw new Error(`Twitch token refresh failed: ${String(json.message ?? res.status)}`)
  return { accessToken: String(json.access_token), refreshToken: String(json.refresh_token ?? refreshToken) }
}

/* ---------------- EventSub WebSocket（公式API） ---------------- */

interface EventSubMessage {
  metadata: { message_type: string; subscription_type?: string; message_id: string }
  payload: {
    session?: { id: string; keepalive_timeout_seconds?: number; reconnect_url?: string }
    subscription?: { type: string }
    event?: Record<string, unknown>
  }
}

export class TwitchStreamAdapter extends BaseStreamAdapter {
  readonly platform = 'twitch' as const
  protected readonly stability = 'stable' as const
  private ws?: WebSocket
  private keepaliveTimer?: ReturnType<typeof setTimeout>
  private keepaliveMs = 15_000
  private token = ''
  private userId = ''
  private broadcasterId = ''

  constructor(private options: TwitchOptions, log?: StreamLogger) {
    super(log)
  }

  protected async open() {
    if (!this.options.clientId) throw new FatalStreamError('Twitch Client ID が未設定です')
    if (!this.options.channelLogin) throw new FatalStreamError('チャンネル名が未設定です')
    await this.authorize()
    this.broadcasterId = await this.lookupUserId(this.options.channelLogin.trim().toLowerCase())
    this.connectWs(EVENTSUB_WS)
  }

  protected async close() {
    if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer)
    this.ws?.close()
    this.ws = undefined
  }

  private async authorize() {
    const tokens = await this.options.getTokens()
    if (!tokens?.accessToken) throw new FatalStreamError('Twitchにログインしてください')
    this.token = tokens.accessToken
    let v = await fetch(`${ID}/validate`, { headers: { Authorization: `OAuth ${this.token}` } })
    if (v.status === 401 && tokens.refreshToken) {
      const refreshed = await refreshTwitchToken(this.options.clientId, tokens.refreshToken)
      await this.options.saveTokens(refreshed)
      this.token = refreshed.accessToken
      v = await fetch(`${ID}/validate`, { headers: { Authorization: `OAuth ${this.token}` } })
    }
    if (!v.ok) throw new FatalStreamError('Twitchトークンが無効です。再ログインしてください')
    const info = (await v.json()) as { user_id: string }
    this.userId = info.user_id
  }

  private helixHeaders() {
    return { Authorization: `Bearer ${this.token}`, 'Client-Id': this.options.clientId, 'Content-Type': 'application/json' }
  }

  private async lookupUserId(login: string): Promise<string> {
    const res = await fetch(`${HELIX}/users?login=${encodeURIComponent(login)}`, { headers: this.helixHeaders() })
    const json = (await res.json()) as { data?: { id: string }[] }
    const id = json.data?.[0]?.id
    if (!id) throw new FatalStreamError(`チャンネル「${login}」が見つかりません`)
    return id
  }

  private connectWs(url: string) {
    const ws = new WebSocket(url)
    const previous = this.ws
    this.ws = ws
    ws.onmessage = (ev) => {
      this.resetKeepalive()
      try {
        void this.handle(JSON.parse(String(ev.data)) as EventSubMessage, previous)
      } catch (err) {
        this.log('warn', 'bad eventsub message', { error: String(err) })
      }
    }
    ws.onclose = () => {
      if (this.ws === ws) this.scheduleReconnect('EventSub WebSocket が切断されました')
    }
    ws.onerror = () => {
      /* onclose で処理 */
    }
  }

  private resetKeepalive() {
    if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer)
    this.keepaliveTimer = setTimeout(() => {
      this.ws?.close()
    }, this.keepaliveMs + 5000)
  }

  private async handle(msg: EventSubMessage, previous?: WebSocket) {
    switch (msg.metadata.message_type) {
      case 'session_welcome': {
        const session = msg.payload.session!
        this.keepaliveMs = (session.keepalive_timeout_seconds ?? 10) * 1000
        previous?.close()
        await this.subscribe(session.id)
        this.markHealthy(`#${this.options.channelLogin} のチャットを受信中`)
        break
      }
      case 'session_reconnect': {
        const url = msg.payload.session?.reconnect_url
        if (url) this.connectWs(url)
        break
      }
      case 'notification': {
        const ev = mapTwitchEvent(msg.payload.subscription?.type ?? '', msg.payload.event ?? {}, msg.metadata.message_id)
        if (ev) this.emit(ev)
        break
      }
      case 'revocation':
        this.setState('error', 'サブスクリプションが取り消されました。再ログインしてください')
        break
    }
  }

  private async subscribe(sessionId: string) {
    for (const type of ['channel.chat.message', 'channel.chat.notification']) {
      const res = await fetch(`${HELIX}/eventsub/subscriptions`, {
        method: 'POST',
        headers: this.helixHeaders(),
        body: JSON.stringify({
          type,
          version: '1',
          condition: { broadcaster_user_id: this.broadcasterId, user_id: this.userId },
          transport: { method: 'websocket', session_id: sessionId },
        }),
      })
      if (!res.ok && res.status !== 409) {
        const body = await res.text()
        this.log('error', 'eventsub subscribe failed', { type, status: res.status })
        if (type === 'channel.chat.message') throw new Error(`EventSub購読に失敗しました (${res.status}) ${body.slice(0, 120)}`)
      }
    }
  }
}

export function mapTwitchEvent(type: string, e: Record<string, unknown>, messageId: string): StreamEvent | null {
  const str = (k: string) => (typeof e[k] === 'string' ? (e[k] as string) : '')
  const badges = (Array.isArray(e.badges) ? e.badges : []) as { set_id?: string }[]
  const has = (id: string) => badges.some((b) => b.set_id === id)
  const message = (e.message ?? {}) as { text?: string }
  const viewer = {
    platform: 'twitch' as const,
    platformUserId: str('chatter_user_id') || 'anon',
    displayName: str('chatter_user_name') || str('chatter_user_login') || 'anonymous',
    isModerator: has('moderator'),
    isMember: has('subscriber'),
    isOwner: has('broadcaster'),
  }
  if (type === 'channel.chat.message') {
    const cheer = e.cheer as { bits?: number } | null | undefined
    const kind: StreamEventKind = cheer?.bits ? 'cheer' : 'chat'
    return {
      id: `tw:${str('message_id') || messageId}`,
      platform: 'twitch',
      kind,
      text: message.text ?? '',
      amount: cheer?.bits ? { value: cheer.bits, currency: 'bits', display: `${cheer.bits} bits` } : undefined,
      viewer,
      receivedAt: Date.now(),
    }
  }
  if (type === 'channel.chat.notification') {
    const notice = str('notice_type')
    const kind: StreamEventKind = notice.includes('gift')
      ? 'gift'
      : notice.includes('sub')
        ? 'subscribe'
        : notice === 'raid'
          ? 'raid'
          : 'system'
    return {
      id: `tw:${str('message_id') || messageId}`,
      platform: 'twitch',
      kind,
      text: message.text || str('system_message'),
      viewer,
      receivedAt: Date.now(),
    }
  }
  return null
}
