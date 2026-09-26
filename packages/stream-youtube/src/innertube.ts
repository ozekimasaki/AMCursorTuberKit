import type { StreamEvent, StreamEventKind } from '@amctk/shared'
import { BaseStreamAdapter, FatalStreamError, type StreamLogger } from '@amctk/stream-core'
import { Innertube, Parser, YTNodes, type YT } from 'youtubei.js'
import { findLiveVideoId, parseYouTubeTarget } from './target'

export interface YouTubeInnertubeOptions {
  /** 配信URL / 動画ID / チャンネルURL（@ハンドル） */
  target: string
}

interface TextLike {
  text?: string
}
interface BadgeLike {
  icon_type?: string
  custom_thumbnail?: unknown[]
}
interface AuthorLike {
  id?: string
  name?: string
  is_moderator?: boolean
  badges?: BadgeLike[]
}

/** youtubei.js のライブチャット項目（YTNode）のうち、変換に使う部分 */
export interface InnertubeChatItem {
  type: string
  id?: string
  message?: TextLike
  author?: AuthorLike
  purchase_amount?: string
  header_primary_text?: TextLike
  header_subtext?: TextLike
  header?: { author_name?: TextLike; author_badges?: BadgeLike[]; primary_text?: TextLike } | null
  author_external_channel_id?: string
  timestamp?: number
  timestamp_usec?: string
}

// youtubei.js の解析エラー（YouTube側の仕様変更の兆候）は種類ごとに1回だけ記録する
let parserLog: StreamLogger | undefined
const reportedParserErrors = new Set<string>()
Parser.setParserErrorHandler((err) => {
  const key = `${err.error_type}:${err.classname}`
  if (reportedParserErrors.has(key)) return
  reportedParserErrors.add(key)
  parserLog?.('warn', 'youtube parser error', { type: err.error_type, classname: err.classname })
})

/**
 * YouTube Live Chat（APIキー不要）
 * YouTube の Web 版と同じ InnerTube API を youtubei.js 経由で使う。クォータ制限はないが、仕様変更で止まることがある。
 * チャンネルURLが指定された場合は配信中の枠を探し、配信前なら始まるまで再試行する。
 */
export class YouTubeInnertubeAdapter extends BaseStreamAdapter {
  readonly platform = 'youtube' as const
  protected readonly stability = 'beta' as const
  private yt?: Innertube
  private chat?: YT.LiveChat
  private connectedAt = 0

  constructor(
    private options: YouTubeInnertubeOptions,
    log?: StreamLogger,
  ) {
    super(log)
  }

  protected async open() {
    parserLog = this.log
    const target = parseYouTubeTarget(this.options.target)
    if (target.liveChatId) {
      throw new FatalStreamError(
        'APIキー不要モードでは liveChatId は使えません。配信URL・動画ID・チャンネルURLを入力してください',
      )
    }
    let videoId = target.videoId
    if (!videoId && target.channelPath) {
      videoId = (await findLiveVideoId(target.channelPath)) ?? undefined
      if (!videoId) throw new Error('配信がまだ始まっていません。始まったら自動で接続します')
    }
    if (!videoId) throw new FatalStreamError('配信URL・動画ID・チャンネルURL（@ハンドル）を入力してください')

    this.yt ??= await Innertube.create({ lang: 'ja', location: 'JP', retrieve_player: false })
    const info = await this.yt.getInfo(videoId)
    if (!info.livechat || info.livechat.is_replay) {
      if (target.channelPath) throw new Error('ライブチャットが見つかりません。配信が始まったら自動で接続します')
      throw new FatalStreamError('この動画にはライブチャットがありません（配信終了後の可能性）')
    }

    const chat = info.getLiveChat()
    this.chat = chat
    this.connectedAt = Date.now()
    chat.on('chat-update', (action) => {
      if (this.chat !== chat || !action.is(YTNodes.AddChatItemAction)) return
      const item = action.item as unknown as InnertubeChatItem
      const postedAt = item.timestamp ?? Number(item.timestamp_usec ?? 0) / 1000
      // 接続直後に届く過去ログは読まない
      if (postedAt && postedAt < this.connectedAt - 5000) return
      const ev = mapInnertubeChatItem(item)
      if (ev) this.emit(ev)
    })
    chat.on('error', (err) => this.log('warn', 'youtube live chat error', { error: String(err) }))

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('ライブチャットに接続できませんでした（タイムアウト）')),
          20_000,
        )
        chat.once('start', () => {
          clearTimeout(timer)
          resolve()
        })
        chat.once('end', () => {
          clearTimeout(timer)
          reject(new Error('ライブチャットに接続できませんでした'))
        })
        chat.start()
      })
    } catch (err) {
      if (this.chat === chat) this.chat = undefined
      chat.stop()
      throw err
    }

    // 受信開始後に止まった場合（配信終了・取得失敗の連続）は再接続する。配信が終わっていれば再接続時に判定される
    chat.on('end', () => {
      if (this.chat !== chat) return
      this.chat = undefined
      this.scheduleReconnect('ライブチャットの取得が止まりました')
    })
    this.markHealthy('APIキー不要モードで受信中')
  }

  protected async close() {
    const chat = this.chat
    this.chat = undefined
    chat?.stop()
  }
}

export function mapInnertubeChatItem(item: InnertubeChatItem): StreamEvent | null {
  if (!item.id) return null
  let kind: StreamEventKind
  let text: string
  let amount: StreamEvent['amount']
  let author = item.author
  switch (item.type) {
    case 'LiveChatTextMessage':
      kind = 'chat'
      text = item.message?.text ?? ''
      break
    case 'LiveChatPaidMessage':
      kind = 'superchat'
      text = item.message?.text ?? ''
      amount = item.purchase_amount ? parseYouTubeAmount(item.purchase_amount) : undefined
      break
    case 'LiveChatPaidSticker':
      kind = 'superchat'
      text = 'スーパーステッカー'
      amount = item.purchase_amount ? parseYouTubeAmount(item.purchase_amount) : undefined
      break
    case 'LiveChatMembershipItem':
      kind = 'subscribe'
      text = item.message?.text || item.header_primary_text?.text || item.header_subtext?.text || 'メンバーになりました'
      break
    case 'LiveChatSponsorshipsGiftPurchaseAnnouncement':
      kind = 'gift'
      text = item.header?.primary_text?.text || 'メンバーシップをギフトしました'
      author = {
        id: item.author_external_channel_id,
        name: item.header?.author_name?.text,
        badges: item.header?.author_badges,
      }
      break
    default:
      return null
  }
  const badges = author?.badges ?? []
  // youtubei.js は名前が取れないと 'N/A' を入れる
  const name = author?.name && author.name !== 'N/A' ? author.name : undefined
  return {
    id: `yt:${item.id}`,
    platform: 'youtube',
    kind,
    text,
    amount,
    receivedAt: Date.now(),
    viewer: {
      platform: 'youtube',
      platformUserId: author?.id || name || 'unknown',
      displayName: name ?? '名無し',
      isModerator: Boolean(author?.is_moderator) || badges.some((b) => b.icon_type === 'MODERATOR'),
      isOwner: badges.some((b) => b.icon_type === 'OWNER'),
      isMember: badges.some((b) => (b.custom_thumbnail?.length ?? 0) > 0),
    },
  }
}

// 長い記号を先に判定する（'CA$' を '$' より先に見る）
const CURRENCY_SYMBOLS: [string, string][] = [
  ['CA$', 'CAD'],
  ['NT$', 'TWD'],
  ['HK$', 'HKD'],
  ['MX$', 'MXN'],
  ['NZ$', 'NZD'],
  ['US$', 'USD'],
  ['CN¥', 'CNY'],
  ['A$', 'AUD'],
  ['R$', 'BRL'],
  ['￥', 'JPY'],
  ['¥', 'JPY'],
  ['$', 'USD'],
  ['€', 'EUR'],
  ['£', 'GBP'],
  ['₩', 'KRW'],
  ['₹', 'INR'],
  ['₱', 'PHP'],
  ['₫', 'VND'],
  ['₪', 'ILS'],
  ['₺', 'TRY'],
  ['₽', 'RUB'],
  ['฿', 'THB'],
]

/** InnerTube の金額表示（例: "￥1,000" "$5.00" "PHP 100.00"）を数値と通貨コードに分ける。通貨が判別できなければ currency は空 */
export function parseYouTubeAmount(display: string): NonNullable<StreamEvent['amount']> {
  const s = display.trim()
  const currency = s.match(/\b([A-Z]{3})\b/)?.[1] ?? CURRENCY_SYMBOLS.find(([sym]) => s.includes(sym))?.[1] ?? ''
  return { value: parseLocaleNumber(s.replace(/[^\d.,]/g, '')), currency, display: s }
}

function parseLocaleNumber(n: string): number {
  if (!n) return 0
  const dot = n.lastIndexOf('.')
  const comma = n.lastIndexOf(',')
  let normalized = n
  if (dot >= 0 && comma >= 0) {
    // 後ろにある方を小数点とみなす
    normalized = dot > comma ? n.replace(/,/g, '') : n.replace(/\./g, '').replace(',', '.')
  } else if (comma >= 0) {
    // "1,000" は桁区切り、"2,50" は小数
    normalized = /^\d+,\d{2}$/.test(n) ? n.replace(',', '.') : n.replace(/,/g, '')
  }
  return Number(normalized) || 0
}
