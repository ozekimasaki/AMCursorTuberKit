import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { LogEntry } from '@amctk/shared'

export type LogCategory =
  | 'app'
  | 'agent'
  | 'memory'
  | 'stream.youtube'
  | 'stream.twitch'
  | 'stream.kick'
  | 'stream.tiktok'
  | 'stream'
  | 'tts'
  | 'avatar'
  | 'stage'
  | 'storage'

const SECRET_PATTERNS: RegExp[] = [
  /(key_[A-Za-z0-9_-]{16,})/g, // Cursor API Key
  /(AIza[0-9A-Za-z_-]{20,})/g, // Google API Key
  /(Bearer\s+)[A-Za-z0-9._~+/-]{12,}/gi,
  /(OAuth\s+)[A-Za-z0-9._~+/-]{12,}/gi,
  /("?(?:access_token|refresh_token|token|apiKey|api_key|secret|password)"?\s*[:=]\s*"?)[^"\s,}]{6,}/gi,
]

/** ログへトークンを出さない */
export function redact(input: string): string {
  let out = input
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (_m, prefix: string) => (prefix && prefix.length < 40 && !/^key_|^AIza/.test(prefix) ? `${prefix}***` : '***'))
  }
  return out
}

function redactData(data?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!data) return undefined
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    if (/token|secret|key|password|authorization/i.test(k)) out[k] = '***'
    else if (typeof v === 'string') out[k] = redact(v).slice(0, 500)
    else out[k] = v
  }
  return out
}

/** 構造化ログ（JSON Lines）。リングバッファでDebug画面にも出す */
export class Logger {
  private ring: LogEntry[] = []
  private file: string
  private ready: Promise<void>
  private listeners = new Set<(e: LogEntry) => void>()

  constructor(private dir: string) {
    this.file = join(dir, 'app.log')
    this.ready = mkdir(dir, { recursive: true }).then(() => this.rotate())
  }

  private async rotate() {
    try {
      const s = await stat(this.file)
      if (s.size > 5 * 1024 * 1024) await rename(this.file, join(this.dir, 'app.1.log'))
    } catch {
      /* no file yet */
    }
  }

  onEntry(cb: (e: LogEntry) => void) {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  log(level: LogEntry['level'], category: LogCategory, message: string, data?: Record<string, unknown>) {
    const entry: LogEntry = { at: Date.now(), level, category, message: redact(message), data: redactData(data) }
    this.ring.push(entry)
    if (this.ring.length > 400) this.ring.shift()
    for (const l of this.listeners) l(entry)
    const line = JSON.stringify({ t: new Date(entry.at).toISOString(), ...entry }) + '\n'
    void this.ready.then(() => appendFile(this.file, line)).catch(() => undefined)
    if (process.env.NODE_ENV !== 'production' || level === 'error') {
      const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
      fn(`[${category}] ${entry.message}`, entry.data ?? '')
    }
  }

  scope(category: LogCategory) {
    return {
      debug: (m: string, d?: Record<string, unknown>) => this.log('debug', category, m, d),
      info: (m: string, d?: Record<string, unknown>) => this.log('info', category, m, d),
      warn: (m: string, d?: Record<string, unknown>) => this.log('warn', category, m, d),
      error: (m: string, d?: Record<string, unknown>) => this.log('error', category, m, d),
    }
  }

  recent(): LogEntry[] {
    return [...this.ring]
  }

  get directory() {
    return this.dir
  }
}

export type ScopedLogger = ReturnType<Logger['scope']>
