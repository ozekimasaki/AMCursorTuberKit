import { FatalStreamError } from '@amctk/stream-core'

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

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
    const res = await fetchImpl(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
    if (res.status === 404) throw new FatalStreamError(`Kick のチャンネル「${slug}」が見つかりません`)
    if (!res.ok) {
      throw new Error(
        `Kick のチャンネル情報を取得できませんでした (HTTP ${res.status})。続く場合は詳細設定でチャットルームIDを入力してください`,
      )
    }
    const json = (await res.json().catch(() => null)) as { chatroom?: { id?: unknown } } | null
    const id = json?.chatroom?.id
    if (typeof id !== 'number') throw new Error('Kick のチャンネル情報からチャットルームIDを読み取れませんでした')
    cache.set(slug, id)
    return id
  }
}
