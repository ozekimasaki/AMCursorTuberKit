/**
 * Main Process の SecretService だけが値を保持する。
 * Renderer には「設定済みかどうか」だけを返す。
 */
export const SECRET_KEYS = [
  'cursorApiKey',
  'cloudflareApiToken',
  'youtubeApiKey',
  'twitchAccessToken',
  'twitchRefreshToken',
  'kickRelaySecret',
  'tiktokBridgeToken',
] as const

export type SecretKey = (typeof SECRET_KEYS)[number]

export type SecretStatus = Record<SecretKey, boolean>

export const SECRET_LABELS: Record<SecretKey, string> = {
  cursorApiKey: 'Cursor API Key',
  cloudflareApiToken: 'Cloudflare API Token',
  youtubeApiKey: 'YouTube Data API Key',
  twitchAccessToken: 'Twitch Access Token',
  twitchRefreshToken: 'Twitch Refresh Token',
  kickRelaySecret: 'Kick Relay Secret',
  tiktokBridgeToken: 'TikTok Bridge Token',
}

export function isSecretKey(value: unknown): value is SecretKey {
  return typeof value === 'string' && (SECRET_KEYS as readonly string[]).includes(value)
}
