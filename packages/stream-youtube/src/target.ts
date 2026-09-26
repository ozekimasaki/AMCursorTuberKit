import { FatalStreamError } from '@amctk/stream-core'

export interface YouTubeTarget {
  videoId?: string
  liveChatId?: string
  /** `@handle` / `channel/UC…` / `c/name` / `user/name`。配信中の枠は `/{channelPath}/live` から探す */
  channelPath?: string
}

const BROWSER_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  'accept-language': 'ja,en;q=0.9',
  // EU圏で同意画面へ飛ばされないようにする
  cookie: 'SOCS=CAI',
}

export function parseYouTubeTarget(target: string): YouTubeTarget {
  // ブラウザのアドレス欄からコピーした URL は、日本語のハンドルが %E3%81… の形になっている
  const t = safeDecode(target.trim())
  if (!t) return {}
  // Studio の配信画面（studio.youtube.com/video/<ID>/livestreaming）も受け付ける
  const url = t.match(/(?:v=|youtu\.be\/|\/live\/|\/shorts\/|\/video\/)([A-Za-z0-9_-]{11})/)
  if (url) return { videoId: url[1] }
  // ハンドルには日本語などの文字も使えるため、区切り文字までをハンドルとみなす
  const channel = t.match(/youtube\.com\/(@[^/?#\s]+|channel\/UC[\w-]{22}|c\/[^/?#\s]+|user\/[^/?#\s]+)/)
  if (channel) return { channelPath: channel[1] }
  if (/^@[^/?#\s]+$/.test(t)) return { channelPath: t }
  if (/^UC[\w-]{22}$/.test(t)) return { channelPath: `channel/${t}` }
  if (/^[A-Za-z0-9_-]{11}$/.test(t)) return { videoId: t }
  return { liveChatId: t }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/**
 * `/{channel}/live` のHTMLから、配信中の枠の動画IDを取り出す。
 * 配信予定の枠（待機所・フリーチャット）は対象にしない。つないでしまうと、別の枠で配信が始まっても切り替わらないため。
 */
export function extractLiveVideoId(html: string): string | null {
  const id = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/)?.[1]
  if (!id) return null
  // 関連動画などの値を拾わないよう、表示中の動画の liveBroadcastDetails だけを見る
  return /"liveBroadcastDetails":\{[^{}]*"isLiveNow":true/.test(html) ? id : null
}

/** チャンネルで配信中の枠を探す。配信していなければ null */
export async function findLiveVideoId(channelPath: string, signal?: AbortSignal): Promise<string | null> {
  const res = await fetch(`https://www.youtube.com/${channelPath}/live`, {
    headers: BROWSER_HEADERS,
    signal: signal ?? AbortSignal.timeout(15_000),
  })
  if (res.status === 404) throw new FatalStreamError(`チャンネル「${channelPath}」が見つかりません`)
  if (!res.ok) throw new Error(`YouTube のチャンネルページを取得できませんでした (HTTP ${res.status})`)
  return extractLiveVideoId(await res.text())
}
