import { FatalStreamError } from '@amctk/stream-core'
import { kickChannelApiUrl, normalizeKickSlug } from './slug'

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

const JSON_HEADERS = { accept: 'application/json' }

/**
 * Kick の slug からチャットルームIDを調べる関数を作る。
 * kick.com の API は Cloudflare に保護されていて Node の fetch では 403 になるため、
 * ブラウザエンジンの通信処理（DesktopHost.browserFetch）を渡して使う。IDはチャンネルごとに変わらないのでキャッシュする。
 */
export function createKickChatroomResolver(fetchImpl: FetchLike): (slug: string) => Promise<number> {
  const cache = new Map<string, number>()
  return async (slug) => {
    const cached = cache.get(slug)
    if (cached) return cached
    const res = await fetchImpl(kickChannelApiUrl(slug), {
      headers: JSON_HEADERS,
      signal: AbortSignal.timeout(15_000),
    })
    if (res.status === 404) throw new FatalStreamError(`Kick のチャンネル「${slug}」が見つかりません`)
    if (!res.ok) {
      throw new Error(
        `Kick のチャンネル情報を取得できませんでした (HTTP ${res.status})。続く場合は Kick の「チャットルームID」欄に数字を入力してください（次の再接続から使います）`,
      )
    }
    const json = (await res.json().catch(() => null)) as { chatroom?: { id?: unknown } } | null
    const id = json?.chatroom?.id
    if (typeof id !== 'number') throw new Error('Kick のチャンネル情報からチャットルームIDを読み取れませんでした')
    cache.set(slug, id)
    return id
  }
}

/**
 * Kick のユーザー名から数値のユーザーIDを調べる関数を作る。調べられなければ undefined。
 * サブスク・ギフト・ホストのイベントにはユーザー名しか無いため、チャットと同じ視聴者IDにそろえるのに使う（AGENTS.md「視聴者ID」）。
 * チャットの sender.id とチャンネル情報の user_id は同じ値。
 */
export function createKickUserIdResolver(fetchImpl: FetchLike): (username: string) => Promise<number | undefined> {
  const cache = new Map<string, number>()
  return async (username) => {
    const slug = normalizeKickSlug(username)
    const cached = cache.get(slug)
    if (cached) return cached
    // イベントを待たせすぎないよう、チャットルームIDより短く打ち切る
    const res = await fetchImpl(kickChannelApiUrl(slug), {
      headers: JSON_HEADERS,
      signal: AbortSignal.timeout(5_000),
    }).catch(() => null)
    if (!res?.ok) return undefined
    const json = (await res.json().catch(() => null)) as { user_id?: unknown } | null
    const id = json?.user_id
    if (typeof id !== 'number') return undefined
    cache.set(slug, id)
    return id
  }
}
