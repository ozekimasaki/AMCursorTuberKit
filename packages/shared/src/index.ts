export * from './sins'
export * from './emotion'
export * from './stream'
export * from './settings'
export * from './providers'
export * from './runtime'
export * from './secrets'
export * from './api'

export function uid(prefix = ''): string {
  const rand = Math.random().toString(36).slice(2, 10)
  return `${prefix}${Date.now().toString(36)}${rand}`
}

export function viewerKeyOf(viewer: { platform: string; platformUserId: string }): string {
  return `${viewer.platform}:${viewer.platformUserId}`
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}

/** Promise にタイムアウトを付ける。失敗時は fallback を返す */
export async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([p, new Promise<T>((resolve) => (timer = setTimeout(() => resolve(fallback), ms)))])
  } catch {
    return fallback
  } finally {
    if (timer) clearTimeout(timer)
  }
}
