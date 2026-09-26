import { KickPusherAdapter, KickRelayAdapter } from '@amctk/stream-kick'
import { TikTokBridgeAdapter } from '@amctk/stream-tiktok'
import { TwitchIrcAdapter, TwitchStreamAdapter, pollDeviceToken, startDeviceFlow } from '@amctk/stream-twitch'
import { YouTubeInnertubeAdapter, YouTubeStreamAdapter } from '@amctk/stream-youtube'
import type { BaseStreamAdapter } from '@amctk/stream-core'
import {
  uid,
  type AppSettings,
  type StreamEvent,
  type StreamPlatform,
  type StreamSourceHealth,
  type TwitchDeviceLogin,
} from '@amctk/shared'
import type { Logger } from './logger'
import type { SecretService } from './secret-service'

type ExternalPlatform = Exclude<StreamPlatform, 'manual'>
type StreamSettings = AppSettings['stream']
const PLATFORMS: ExternalPlatform[] = ['youtube', 'twitch', 'kick', 'tiktok']
const SWITCHABLE = ['youtube', 'twitch', 'kick'] as const

/** 未接続時に表示する安定度。接続中は各Adapterの値を使う */
function stabilityOf(platform: ExternalPlatform, s: StreamSettings): StreamSourceHealth['stability'] {
  switch (platform) {
    case 'youtube':
      return s.youtube.source === 'api' ? 'stable' : 'beta'
    case 'twitch':
      return 'stable'
    case 'kick':
      return 'beta'
    case 'tiktok':
      return 'experimental'
  }
}

export interface StreamServiceDeps {
  /** Kick の slug → チャットルームID（Electron の通信処理で調べる） */
  resolveKickChatroomId(slug: string): Promise<number>
}

/**
 * 各プラットフォームを独立して接続する。1つが落ちても他は継続（Platform Failure Isolation）。
 * YouTube / Twitch / Kick は取得経路（web: APIキー不要 / api: 公式API）を設定で選ぶ。
 */
export class StreamSourceService {
  private adapters = new Map<ExternalPlatform, BaseStreamAdapter>()
  private deviceAbort?: AbortController
  onEvent?: (e: StreamEvent) => void
  onHealth?: (h: StreamSourceHealth[]) => void

  constructor(
    private getSettings: () => AppSettings,
    private secrets: SecretService,
    private logger: Logger,
    private deps: StreamServiceDeps,
  ) {}

  private create(platform: ExternalPlatform): BaseStreamAdapter {
    const s = this.getSettings().stream
    const log = (category: `stream.${ExternalPlatform}`) => (level: 'info' | 'warn' | 'error', m: string, d?: Record<string, unknown>) =>
      this.logger.log(level, category, m, d)
    switch (platform) {
      case 'youtube':
        if (s.youtube.source === 'web') return new YouTubeInnertubeAdapter({ target: s.youtube.target }, log('stream.youtube'))
        return new YouTubeStreamAdapter({ target: s.youtube.target, apiKey: this.secrets.get('youtubeApiKey') }, log('stream.youtube'))
      case 'twitch':
        if (s.twitch.source === 'web') return new TwitchIrcAdapter({ channelLogin: s.twitch.channelLogin }, log('stream.twitch'))
        return new TwitchStreamAdapter(
          {
            clientId: s.twitch.clientId,
            channelLogin: s.twitch.channelLogin,
            getTokens: async () => {
              const accessToken = this.secrets.get('twitchAccessToken')
              return accessToken ? { accessToken, refreshToken: this.secrets.get('twitchRefreshToken') } : null
            },
            saveTokens: async (t) => {
              await this.secrets.set('twitchAccessToken', t.accessToken)
              if (t.refreshToken) await this.secrets.set('twitchRefreshToken', t.refreshToken)
            },
          },
          log('stream.twitch'),
        )
      case 'kick':
        if (s.kick.source === 'web') {
          return new KickPusherAdapter(
            {
              channelSlug: s.kick.channelSlug,
              chatroomId: Number(s.kick.chatroomId.trim()) || undefined,
              resolveChatroomId: (slug) => this.deps.resolveKickChatroomId(slug),
            },
            log('stream.kick'),
          )
        }
        return new KickRelayAdapter(
          { relayUrl: s.kick.relayUrl, channelSlug: s.kick.channelSlug, relaySecret: this.secrets.get('kickRelaySecret') },
          log('stream.kick'),
        )
      case 'tiktok':
        return new TikTokBridgeAdapter(
          { bridgeUrl: s.tiktok.bridgeUrl, uniqueId: s.tiktok.uniqueId, token: this.secrets.get('tiktokBridgeToken') || undefined },
          log('stream.tiktok'),
        )
    }
  }

  async connect(platform: StreamPlatform) {
    if (platform === 'manual') return
    await this.disconnect(platform)
    const adapter = this.create(platform)
    adapter.onHealthChange = () => this.emitHealth()
    this.adapters.set(platform, adapter)
    await adapter.connect()
    void this.pump(platform, adapter)
    this.emitHealth()
  }

  private async pump(platform: ExternalPlatform, adapter: BaseStreamAdapter) {
    try {
      for await (const e of adapter.events()) {
        if (this.adapters.get(platform) !== adapter) break
        try {
          this.onEvent?.(e)
        } catch (err) {
          this.logger.log('error', 'stream', 'event handler failed', { error: String(err) })
        }
      }
    } catch (err) {
      this.logger.log('error', 'stream', 'event pump crashed', { platform, error: String(err) })
    }
  }

  async disconnect(platform: StreamPlatform) {
    if (platform === 'manual') return
    const adapter = this.adapters.get(platform)
    this.adapters.delete(platform)
    if (adapter) await adapter.disconnect().catch(() => undefined)
    this.emitHealth()
  }

  /** 設定で有効なものだけ接続する */
  async connectEnabled() {
    const s = this.getSettings().stream
    for (const p of PLATFORMS) {
      if (s[p].enabled) void this.connect(p).catch((err) => this.logger.log('warn', 'stream', 'connect failed', { platform: p, error: String(err) }))
    }
  }

  async disconnectAll() {
    await Promise.all(PLATFORMS.map((p) => this.disconnect(p)))
  }

  /** 取得経路を切り替えたら、接続中のものは新しい経路でつなぎ直す。安定度の表示も更新する */
  handleSettingsChange(next: StreamSettings, prev: StreamSettings) {
    for (const p of SWITCHABLE) {
      if (next[p].source === prev[p].source || !this.adapters.has(p)) continue
      void this.connect(p).catch((err) => this.logger.log('warn', 'stream', 'reconnect failed', { platform: p, error: String(err) }))
    }
    this.emitHealth()
  }

  health(): StreamSourceHealth[] {
    const s = this.getSettings().stream
    return PLATFORMS.map(
      (p) =>
        this.adapters.get(p)?.health() ?? {
          platform: p,
          state: s[p].enabled ? 'disconnected' : 'disabled',
          stability: stabilityOf(p, s),
          eventCount: 0,
        },
    )
  }

  private emitHealth() {
    this.onHealth?.(this.health())
  }

  /** Twitch Device Code Flow（公式API用）。コードを返し、裏でトークン取得を待つ */
  async twitchDeviceLogin(onDone: (ok: boolean, message: string) => void): Promise<TwitchDeviceLogin> {
    const clientId = this.getSettings().stream.twitch.clientId
    if (!clientId) throw new Error('先に Twitch Client ID を入力してください')
    this.deviceAbort?.abort()
    const abort = new AbortController()
    this.deviceAbort = abort
    const start = await startDeviceFlow(clientId)
    void pollDeviceToken(clientId, start, abort.signal)
      .then(async (tokens) => {
        await this.secrets.set('twitchAccessToken', tokens.accessToken)
        if (tokens.refreshToken) await this.secrets.set('twitchRefreshToken', tokens.refreshToken)
        onDone(true, 'Twitchにログインしました')
      })
      .catch((err) => onDone(false, err instanceof Error ? err.message : String(err)))
    return { userCode: start.userCode, verificationUri: start.verificationUri, expiresIn: start.expiresIn }
  }

  /** 負荷テスト用のダミーコメント */
  static testEvents(count: number): StreamEvent[] {
    const names = ['もちこ', 'たぴおか', 'Kuma_77', 'ねこまる', 'sora', 'プリン大好き', 'ゆず', 'Taro', 'ぽてと', 'りんご飴']
    const texts = [
      'こんばんは！', 'かわいい〜', '今日のご飯なに食べた？', '眠い…', 'ポンコツかわいい', 'プリン好き？', '初見です！',
      'www', '他の配信者さんも見てるよ', '好き！', '歌ってほしい！', 'おやすみ〜', 'すごい！天才！', '今日は何するの？',
    ]
    const platforms: ExternalPlatform[] = ['youtube', 'twitch', 'kick', 'tiktok']
    return Array.from({ length: count }, (_, i) => {
      const platform = platforms[Math.floor(Math.random() * platforms.length)]
      const name = names[Math.floor(Math.random() * names.length)]
      const superchat = Math.random() < 0.06
      return {
        id: `test:${uid()}${i}`,
        platform,
        kind: superchat ? 'superchat' : 'chat',
        text: texts[Math.floor(Math.random() * texts.length)],
        amount: superchat ? { value: 500, currency: 'JPY', display: '¥500' } : undefined,
        receivedAt: Date.now(),
        viewer: { platform, platformUserId: `test-${name}`, displayName: name },
      } satisfies StreamEvent
    })
  }
}
