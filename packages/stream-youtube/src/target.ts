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
  const t = target.trim()
  if (!t) return {}
  const url = t.match(/(?:v=|youtu\.be\/|\/live\/|\/shorts\/)([A-Za-z0-9_-]{11})/)
  if (url) return { videoId: url[1] }
  const channel = t.match(/youtube\.com\/(@[\w.-]+|channel\/UC[\w-]{22}|c\/[^/?#]+|user\/[^/?#]+)/)
  if (channel) return { channelPath: channel[1] }
  if (/^@[\w.-]+$/.test(t)) return { channelPath: t }
  if (/^UC[\w-]{22}$/.test(t)) return { channelPath: `channel/${t}` }
  if (/^[A-Za-z0-9_-]{11}$/.test(t)) return { videoId: t }
  return { liveChatId: t }
}

/** `/{channel}/live` のHTMLから、配信中または配信予定の枠の動画IDを取り出す */
export function extractLiveVideoId(html: string): string | null {
  const id = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/)?.[1]
  if (!id) return null
  return /"isLiveNow":true/.test(html) || /"isUpcoming":true/.test(html) ? id : null
}

/** チャンネルで配信中（または待機所を開いている）枠を探す。見つからなければ null */
export async function findLiveVideoId(channelPath: string, signal?: AbortSignal): Promise<string | null> {
  const res = await fetch(`https://www.youtube.com/${channelPath}/live`, { headers: BROWSER_HEADERS, signal })
  if (res.status === 404) throw new FatalStreamError(`チャンネル「${channelPath}」が見つかりません`)
  if (!res.ok) throw new Error(`YouTube のチャンネルページを取得できませんでした (HTTP ${res.status})`)
  return extractLiveVideoId(await res.text())
}
