import type { StreamEvent, StreamEventKind } from '@amctk/shared'
import { BaseStreamAdapter, FatalStreamError, JsonObjectStreamParser, type StreamLogger } from '@amctk/stream-core'
import { findLiveVideoId, parseYouTubeTarget } from './target'

export * from './innertube'
export { extractLiveVideoId, findLiveVideoId, parseYouTubeTarget, type YouTubeTarget } from './target'

const API = 'https://youtube.googleapis.com/youtube/v3'

export interface YouTubeOptions {
  /** 配信URL / 動画ID / チャンネルURL（@ハンドル） / liveChatId */
  target: string
  apiKey: string
}

interface LiveChatItem {
  id: string
  snippet?: {
    type?: string
    publishedAt?: string
    displayMessage?: string
    textMessageDetails?: { messageText?: string }
    superChatDetails?: { amountMicros?: string; currency?: string; amountDisplayString?: string; userComment?: string }
    superStickerDetails?: { amountMicros?: string; currency?: string; amountDisplayString?: string }
    newSponsorDetails?: { memberLevelName?: string }
    memberMilestoneChatDetails?: { userComment?: string; memberMonth?: number }
    membershipGiftingDetails?: { giftMembershipsCount?: number }
  }
  authorDetails?: {
    channelId?: string
    displayName?: string
    isChatModerator?: boolean
    isChatOwner?: boolean
    isChatSponsor?: boolean
  }
}

interface LiveChatResponse {
  items?: LiveChatItem[]
  nextPageToken?: string
  pollingIntervalMillis?: number
  offlineAt?: string
  error?: { message?: string; errors?: { reason?: string }[] }
}

/**
 * YouTube Live Chat（公式API）
 * 1. liveChatMessages.streamList（サーバーストリーミング）で低遅延受信
 * 2. 使えない場合は liveChatMessages.list のポーリングへ自動で切り替える
 */
export class YouTubeStreamAdapter extends BaseStreamAdapter {
  readonly platform = 'youtube' as const
  protected readonly stability = 'stable' as const
  private abort?: AbortController
  private pageToken?: string
  private connectedAt = 0
  private usePolling = false

  constructor(private options: YouTubeOptions, log?: StreamLogger) {
    super(log)
  }

  protected async open() {
    if (!this.options.apiKey) throw new FatalStreamError('YouTube Data API Key が未設定です')
    const liveChatId = await this.resolveLiveChatId()
    this.connectedAt = Date.now()
    this.abort = new AbortController()
    void this.loop(liveChatId, this.abort.signal)
  }

  protected async close() {
    this.abort?.abort()
  }

  private async resolveLiveChatId(): Promise<string> {
    const target = parseYouTubeTarget(this.options.target)
    if (target.liveChatId) return target.liveChatId
    const videoId = target.videoId ?? (target.channelPath ? await findLiveVideoId(target.channelPath) : null)
    if (!videoId) throw new FatalStreamError(target.channelPath ? 'このチャンネルは配信中ではありません' : '配信URLまたは動画IDを入力してください')
    const res = await fetch(`${API}/videos?part=liveStreamingDetails&id=${videoId}`, { headers: this.headers })
    const json = (await res.json()) as { items?: { liveStreamingDetails?: { activeLiveChatId?: string } }[]; error?: { message: string } }
    if (!res.ok) throw new FatalStreamError(`YouTube API: ${json.error?.message ?? res.status}`)
    const id = json.items?.[0]?.liveStreamingDetails?.activeLiveChatId
    if (!id) throw new FatalStreamError('この動画にはアクティブなライブチャットがありません（配信開始前/終了後の可能性）')
    return id
  }

  private async loop(liveChatId: string, signal: AbortSignal) {
    while (!signal.aborted && !this.stopped) {
      try {
        if (this.usePolling) await this.poll(liveChatId, signal)
        else await this.stream(liveChatId, signal)
      } catch (err) {
        if (signal.aborted) return
        if (err instanceof FatalStreamError) {
          this.setState('error', err.message)
          this.stopped = true
          return
        }
        if (!this.usePolling && err instanceof StreamUnsupportedError) {
          this.log('warn', 'streamList unavailable, fallback to polling', { reason: err.message })
          this.usePolling = true
          continue
        }
        this.setState('degraded', err instanceof Error ? err.message : String(err))
        await wait(5000, signal)
      }
    }
  }

  /** APIキーはURLに載せずヘッダーで送る（ログ・履歴に残さない） */
  private get headers() {
    return { 'X-Goog-Api-Key': this.options.apiKey }
  }

  private params(liveChatId: string) {
    const p = new URLSearchParams({ liveChatId, part: 'id,snippet,authorDetails' })
    if (this.pageToken) p.set('pageToken', this.pageToken)
    return p
  }

  private async stream(liveChatId: string, signal: AbortSignal) {
    const res = await fetch(`${API}/liveChat/messages/stream?${this.params(liveChatId)}`, { signal, headers: this.headers })
    if (res.status === 404 || res.status === 400 || res.status === 501) {
      throw new StreamUnsupportedError(`HTTP ${res.status}`)
    }
    if (!res.ok || !res.body) await this.throwApiError(res)
    this.markHealthy('streamList で受信中')
    const parser = new JsonObjectStreamParser()
    const decoder = new TextDecoder()
    const reader = res.body!.getReader()
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      for (const obj of parser.push(decoder.decode(value, { stream: true }))) this.handleResponse(obj as LiveChatResponse)
    }
  }

  private async poll(liveChatId: string, signal: AbortSignal) {
    const res = await fetch(`${API}/liveChat/messages?${this.params(liveChatId)}`, { signal, headers: this.headers })
    if (!res.ok) await this.throwApiError(res)
    const json = (await res.json()) as LiveChatResponse
    this.markHealthy('ポーリングで受信中')
    this.handleResponse(json)
    await wait(Math.max(2000, json.pollingIntervalMillis ?? 5000), signal)
  }

  private async throwApiError(res: Response): Promise<never> {
    const json = (await res.json().catch(() => ({}))) as LiveChatResponse
    const reason = json.error?.errors?.[0]?.reason
    if (reason === 'liveChatEnded' || reason === 'liveChatNotFound') throw new FatalStreamError('ライブチャットが終了しました')
    if (res.status === 403 && reason === 'forbidden') throw new FatalStreamError('このライブチャットにはアクセスできません')
    throw new Error(`YouTube API ${res.status}: ${json.error?.message ?? ''}`)
  }

  private handleResponse(res: LiveChatResponse) {
    if (res.nextPageToken) this.pageToken = res.nextPageToken
    if (res.offlineAt) throw new FatalStreamError('配信は終了しています')
    for (const item of res.items ?? []) {
      const published = Date.parse(item.snippet?.publishedAt ?? '') || Date.now()
      // 接続直後に届く過去ログは読まない
      if (published < this.connectedAt - 5000) continue
      const ev = mapYouTubeItem(item)
      if (ev) this.emit(ev)
    }
  }
}

class StreamUnsupportedError extends Error {}

export function mapYouTubeItem(item: LiveChatItem): StreamEvent | null {
  const s = item.snippet
  const a = item.authorDetails
  if (!s || !a) return null
  let kind: StreamEventKind = 'chat'
  let text = s.displayMessage ?? s.textMessageDetails?.messageText ?? ''
  let amount: StreamEvent['amount']
  switch (s.type) {
    case 'textMessageEvent':
      break
    case 'superChatEvent':
      kind = 'superchat'
      text = s.superChatDetails?.userComment ?? ''
      amount = {
        value: Number(s.superChatDetails?.amountMicros ?? 0) / 1e6,
        currency: s.superChatDetails?.currency ?? '',
        display: s.superChatDetails?.amountDisplayString,
      }
      break
    case 'superStickerEvent':
      kind = 'superchat'
      text = 'スーパーステッカー'
      amount = {
        value: Number(s.superStickerDetails?.amountMicros ?? 0) / 1e6,
        currency: s.superStickerDetails?.currency ?? '',
        display: s.superStickerDetails?.amountDisplayString,
      }
      break
    case 'newSponsorEvent':
      kind = 'subscribe'
      text = `メンバーになりました${s.newSponsorDetails?.memberLevelName ? `（${s.newSponsorDetails.memberLevelName}）` : ''}`
      break
    case 'memberMilestoneChatEvent':
      kind = 'subscribe'
      text = s.memberMilestoneChatDetails?.userComment ?? `メンバー${s.memberMilestoneChatDetails?.memberMonth ?? ''}か月`
      break
    case 'membershipGiftingEvent':
      kind = 'gift'
      text = `メンバーシップを${s.membershipGiftingDetails?.giftMembershipsCount ?? ''}件ギフト`
      break
    default:
      return null
  }
  return {
    id: `yt:${item.id}`,
    platform: 'youtube',
    kind,
    text,
    amount,
    receivedAt: Date.now(),
    viewer: {
      platform: 'youtube',
      platformUserId: a.channelId ?? a.displayName ?? 'unknown',
      displayName: a.displayName ?? '名無し',
      isModerator: a.isChatModerator,
      isOwner: a.isChatOwner,
      isMember: a.isChatSponsor,
    },
  }
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(t)
      resolve()
    }, { once: true })
  })
}
