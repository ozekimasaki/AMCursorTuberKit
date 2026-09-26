/*
 * Kick のチャンネル名（slug）の扱い。Renderer からも使うため、ほかのモジュールを import しない。
 */

/**
 * チャンネル名・チャンネルURL・ユーザー名から slug を取り出す。
 * slug はユーザー名を小文字にし、_ を - にしたもの（例: Sir_Fas → sir-fas）。
 */
export function normalizeKickSlug(input: string): string {
  const parts = input
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?kick\.com\//i, '')
    .replace(/^@/, '')
    .split(/[/?#]/)
  // ポップアウトのチャット（kick.com/popout/<slug>/chat）の URL も受け付ける
  const slug = parts[0].toLowerCase() === 'popout' && parts[1] ? parts[1] : parts[0]
  return slug.toLowerCase().replace(/_/g, '-')
}

/** チャンネル情報（チャットルームID・ユーザーIDを含む）の URL */
export function kickChannelApiUrl(slug: string): string {
  return `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`
}
