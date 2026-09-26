import type { StreamEvent, StreamEventKind, StreamViewer } from '@amctk/shared'
import { BaseStreamAdapter, FatalStreamError, type StreamLogger } from '@amctk/stream-core'
import { ChatClient, LogLevel } from '@twurple/chat'

export interface TwitchIrcOptions {
  /** チャンネル名 / チャンネルURL */
  channelLogin: string
}

/** twurple の ChatUser のうち、変換に使う部分 */
export interface TwitchIrcUser {
  userId: string
  userName: string
  displayName: string
  isMod: boolean
  isSubscriber: boolean
  isFounder?: boolean
  isBroadcaster: boolean
}

export type TwitchIrcNotice =
  | { type: 'sub'; months: number; message?: string }
  | { type: 'gift'; count: number; recipient?: string }
  | { type: 'raid'; viewers: number }
  | { type: 'announcement'; message: string }

/** URL の最初の部分がチャンネル名ではないページ（ポップアウトのチャット・モデレーター画面・埋め込み・ダッシュボード） */
const NON_CHANNEL_PREFIXES = new Set(['popout', 'moderator', 'embed', 'u'])

/** チャンネル名・チャンネルURL（twitch.tv/popout/<名前>/chat などを含む）からログイン名を取り出す */
export function normalizeTwitchLogin(input: string): string {
  const parts = input
    .trim()
    .replace(/^(?:https?:\/\/)?(?:[\w-]+\.)*twitch\.tv\//i, '')
    .replace(/^[#@]/, '')
    .split(/[/?#]/)
  const login = NON_CHANNEL_PREFIXES.has(parts[0].toLowerCase()) && parts[1] ? parts[1] : parts[0]
  return login.toLowerCase()
}

/**
 * twurple の参加失敗を、再試行するかどうかで分ける。
 * 応答が無いだけ（twurple_timeout）は回線が遅いときにも起きるので再試行する。存在しないチャンネルもこの理由になる。
 */
export function twitchJoinError(login: string, reason: string): Error {
  if (reason === 'twurple_timeout') {
    return new Error(`#${login} に参加できませんでした（応答がありません）。チャンネル名が正しいか確認してください`)
  }
  return new FatalStreamError(`チャンネル「${login}」に参加できません（${reason}）`)
}

/**
 * Twitch チャット（ログイン不要）
 * Twitch の Web 版チャットと同じ IRC に匿名で接続して読む。書き込みはできない。
 * 切断時の再接続は twurple が行う。フォロー通知は IRC に流れないため取れない。
 */
export class TwitchIrcAdapter extends BaseStreamAdapter {
  readonly platform = 'twitch' as const
  protected readonly stability = 'stable' as const
  private client?: ChatClient

  constructor(
    private options: TwitchIrcOptions,
    log?: StreamLogger,
  ) {
    super(log)
  }

  protected async open() {
    const login = normalizeTwitchLogin(this.options.channelLogin)
    if (!/^\w{2,25}$/.test(login)) throw new FatalStreamError('チャンネル名を入力してください')
    const client = new ChatClient({
      channels: [login],
      logger: {
        minLevel: LogLevel.WARNING,
        custom: (level, message) => this.log(level <= LogLevel.ERROR ? 'error' : 'warn', 'twurple', { message }),
      },
    })
    this.client = client
    const alive = () => this.client === client
    const push = (e: StreamEvent) => alive() && this.emit(e)

    client.onMessage((_channel, _user, text, msg) =>
      push(mapTwitchIrcMessage({ id: msg.id, text, bits: msg.bits, user: msg.userInfo })),
    )
    // /me のメッセージは onMessage ではなく onAction に届く
    client.onAction((_channel, _user, text, msg) =>
      push(mapTwitchIrcMessage({ id: msg.id, text, bits: msg.bits, user: msg.userInfo })),
    )
    client.onSub((_c, _u, info, msg) =>
      push(mapTwitchIrcNotice(msg.id, msg.userInfo, { type: 'sub', months: info.months, message: info.message })),
    )
    client.onResub((_c, _u, info, msg) =>
      push(mapTwitchIrcNotice(msg.id, msg.userInfo, { type: 'sub', months: info.months, message: info.message })),
    )
    client.onSubGift((_c, _u, info, msg) => {
      // まとめてギフトの内訳は onCommunitySub で1件にまとめて扱う
      if (msg.tags.get('msg-param-community-gift-id')) return
      push(mapTwitchIrcNotice(msg.id, msg.userInfo, { type: 'gift', count: 1, recipient: info.displayName }))
    })
    client.onCommunitySub((_c, _u, info, msg) =>
      push(mapTwitchIrcNotice(msg.id, msg.userInfo, { type: 'gift', count: info.count })),
    )
    client.onRaid((_c, _u, info, msg) =>
      push(mapTwitchIrcNotice(msg.id, msg.userInfo, { type: 'raid', viewers: info.viewerCount })),
    )
    client.onAnnouncement((_c, _u, _info, msg) =>
      push(mapTwitchIrcNotice(msg.id, msg.userInfo, { type: 'announcement', message: msg.text ?? '' })),
    )

    try {
      await new Promise<void>((resolve, reject) => {
        const finish = (err?: Error) => {
          clearTimeout(timer)
          joined.unbind()
          failed.unbind()
          if (err) reject(err)
          else resolve()
        }
        const timer = setTimeout(() => finish(new Error('Twitch チャットへの接続がタイムアウトしました')), 15_000)
        const joined = client.onJoin((channel) => channel === login && finish())
        const failed = client.onJoinFailure(
          (channel, reason) => channel === login && finish(twitchJoinError(login, reason)),
        )
        client.connect()
      })
    } catch (err) {
      if (alive()) this.client = undefined
      client.quit()
      throw err
    }

    client.onDisconnect((manually) => {
      if (alive() && !manually) this.setState('degraded', 'Twitch チャットとの接続が切れました。自動で再接続します')
    })
    client.onJoin((channel) => {
      if (alive() && channel === login) this.markHealthy(`#${login} のチャットを受信中`)
    })
    // twurple は再接続した後の参加に失敗しても再試行しないため、こちらでつなぎ直す
    client.onJoinFailure((channel, reason) => {
      if (!alive() || channel !== login) return
      this.client = undefined
      client.quit()
      const err = twitchJoinError(login, reason)
      if (err instanceof FatalStreamError) this.fail(err.message)
      else this.scheduleReconnect(err.message)
    })
    this.markHealthy(`#${login} のチャットを受信中`)
  }

  protected async close() {
    const client = this.client
    this.client = undefined
    client?.quit()
  }
}

function viewerOf(u: TwitchIrcUser): StreamViewer {
  return {
    platform: 'twitch',
    platformUserId: u.userId || u.userName || 'anon',
    displayName: u.displayName || u.userName || 'anonymous',
    isModerator: u.isMod,
    isMember: u.isSubscriber || Boolean(u.isFounder),
    isOwner: u.isBroadcaster,
  }
}

export function mapTwitchIrcMessage(m: { id: string; text: string; bits: number; user: TwitchIrcUser }): StreamEvent {
  const kind: StreamEventKind = m.bits > 0 ? 'cheer' : 'chat'
  return {
    id: `tw:${m.id}`,
    platform: 'twitch',
    kind,
    text: m.text,
    amount: m.bits > 0 ? { value: m.bits, currency: 'bits', display: `${m.bits} bits` } : undefined,
    viewer: viewerOf(m.user),
    receivedAt: Date.now(),
  }
}

export function mapTwitchIrcNotice(id: string, user: TwitchIrcUser, notice: TwitchIrcNotice): StreamEvent {
  let kind: StreamEventKind
  let text: string
  switch (notice.type) {
    case 'sub':
      kind = 'subscribe'
      text = notice.message || `サブスクしました（${notice.months}か月）`
      break
    case 'gift':
      kind = 'gift'
      text = notice.recipient ? `${notice.recipient}さんにサブスクをギフト` : `サブスクを${notice.count}件ギフト`
      break
    case 'raid':
      kind = 'raid'
      text = `${notice.viewers}人でレイドしました`
      break
    case 'announcement':
      kind = 'system'
      text = notice.message
      break
  }
  return { id: `tw:${id}`, platform: 'twitch', kind, text, viewer: viewerOf(user), receivedAt: Date.now() }
}
