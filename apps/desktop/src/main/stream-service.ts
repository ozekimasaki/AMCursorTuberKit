import { KickRelayAdapter } from '@amctk/stream-kick'
import { TikTokBridgeAdapter } from '@amctk/stream-tiktok'
import { TwitchStreamAdapter, pollDeviceToken, startDeviceFlow } from '@amctk/stream-twitch'
import { YouTubeStreamAdapter } from '@amctk/stream-youtube'
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
const PLATFORMS: ExternalPlatform[] = ['youtube', 'twitch', 'kick', 'tiktok']
const STABILITY: Record<ExternalPlatform, StreamSourceHealth['stability']> = {
  youtube: 'stable',
  twitch: 'stable',
  kick: 'beta',
  tiktok: 'experimental',
}

/**
 * 各プラットフォームを独立して接続する。1つが落ちても他は継続（Platform Failure Isolation）。
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
  ) {}

  private create(platform: ExternalPlatform): BaseStreamAdapter {
    const s = this.getSettings().stream
    const log = (category: `stream.${ExternalPlatform}`) => (level: 'info' | 'warn' | 'error', m: string, d?: Record<string, unknown>) =>
      this.logger.log(level, category, m, d)
    switch (platform) {
      case 'youtube':
        return new YouTubeStreamAdapter({ target: s.youtube.target, apiKey: this.secrets.get('youtubeApiKey') }, log('stream.youtube'))
      case 'twitch':
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

  health(): StreamSourceHealth[] {
    const s = this.getSettings().stream
    return PLATFORMS.map(
      (p) =>
        this.adapters.get(p)?.health() ?? {
          platform: p,
          state: s[p].enabled ? 'disconnected' : 'disabled',
          stability: STABILITY[p],
          eventCount: 0,
        },
    )
  }

  private emitHealth() {
    this.onHealth?.(this.health())
  }

  /** Twitch Device Code Flow。コードを返し、裏でトークン取得を待つ */
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
