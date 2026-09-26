import type {
  StreamConnectionState,
  StreamEvent,
  StreamPlatform,
  StreamSourceAdapter,
  StreamSourceHealth,
} from '@amctk/shared'

export type StreamLogger = (level: 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown>) => void

/** events() 用の非同期キュー */
export class AsyncEventQueue<T> implements AsyncIterable<T> {
  private items: T[] = []
  private waiters: ((r: IteratorResult<T>) => void)[] = []
  private closed = false

  push(item: T) {
    if (this.closed) return
    const w = this.waiters.shift()
    if (w) w({ value: item, done: false })
    else {
      this.items.push(item)
      if (this.items.length > 1000) this.items.shift()
    }
  }

  close() {
    this.closed = true
    for (const w of this.waiters) w({ value: undefined as never, done: true })
    this.waiters = []
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const item = this.items.shift()
        if (item !== undefined) return Promise.resolve({ value: item, done: false })
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true })
        return new Promise((resolve) => this.waiters.push(resolve))
      },
      return: () => {
        this.close()
        return Promise.resolve({ value: undefined as never, done: true })
      },
    }
  }
}

/**
 * 各プラットフォームAdapterの共通処理。
 * 状態管理・イベントキュー・再接続のバックオフを持つ。
 */
export abstract class BaseStreamAdapter implements StreamSourceAdapter {
  abstract readonly platform: StreamPlatform
  protected abstract readonly stability: StreamSourceHealth['stability']
  private queue = new AsyncEventQueue<StreamEvent>()
  private state: StreamConnectionState = 'disconnected'
  private message?: string
  private lastEventAt?: number
  private eventCount = 0
  protected stopped = true
  private retry = 0
  private retryTimer?: ReturnType<typeof setTimeout>

  constructor(protected log: StreamLogger = () => undefined) {}

  protected abstract open(): Promise<void>
  protected abstract close(): Promise<void>

  onHealthChange?: (h: StreamSourceHealth) => void

  async connect(): Promise<void> {
    this.stopped = false
    this.retry = 0
    this.queue = new AsyncEventQueue()
    await this.tryOpen()
  }

  async disconnect(): Promise<void> {
    this.stopped = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    await this.close().catch(() => undefined)
    this.queue.close()
    this.setState('disconnected')
  }

  health(): StreamSourceHealth {
    return {
      platform: this.platform,
      state: this.state,
      message: this.message,
      stability: this.stability,
      lastEventAt: this.lastEventAt,
      eventCount: this.eventCount,
    }
  }

  events(): AsyncIterable<StreamEvent> {
    return this.queue
  }

  protected emit(event: StreamEvent) {
    this.eventCount++
    this.lastEventAt = event.receivedAt
    this.queue.push(event)
  }

  protected setState(state: StreamConnectionState, message?: string) {
    this.state = state
    this.message = message
    this.onHealthChange?.(this.health())
  }

  /** 接続が切れたときにサブクラスから呼ぶ */
  protected scheduleReconnect(reason: string) {
    if (this.stopped) return
    const delay = Math.min(60_000, 1000 * 2 ** this.retry) + Math.random() * 500
    this.retry++
    this.setState('degraded', `${reason} / ${Math.round(delay / 1000)}秒後に再接続`)
    this.log('warn', 'reconnect scheduled', { platform: this.platform, reason, delay })
    this.retryTimer = setTimeout(() => void this.tryOpen(), delay)
  }

  protected markHealthy(message?: string) {
    this.retry = 0
    this.setState('connected', message)
  }

  private async tryOpen() {
    if (this.stopped) return
    this.setState('connecting')
    try {
      await this.open()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (err instanceof FatalStreamError) {
        this.stopped = true
        this.setState('error', msg)
        return
      }
      this.scheduleReconnect(msg)
    }
  }
}

/** 設定不備など、再試行しても直らないエラー */
export class FatalStreamError extends Error {}

/** 中括弧の深さを数えて、ストリームで届くJSON配列/NDJSONを1オブジェクトずつ取り出す */
export class JsonObjectStreamParser {
  private buf = ''
  private depth = 0
  private inString = false
  private escape = false
  private start = -1
  private scanned = 0

  push(chunk: string): unknown[] {
    this.buf += chunk
    const out: unknown[] = []
    for (let i = this.scanned; i < this.buf.length; i++) {
      const c = this.buf[i]
      if (this.inString) {
        if (this.escape) this.escape = false
        else if (c === '\\') this.escape = true
        else if (c === '"') this.inString = false
        continue
      }
      if (c === '"') this.inString = true
      else if (c === '{') {
        if (this.depth === 0) this.start = i
        this.depth++
      } else if (c === '}') {
        this.depth--
        if (this.depth === 0 && this.start >= 0) {
          try {
            out.push(JSON.parse(this.buf.slice(this.start, i + 1)))
          } catch {
            /* skip broken object */
          }
          this.buf = this.buf.slice(i + 1)
          i = -1
          this.start = -1
        }
      }
    }
    this.scanned = this.buf.length
    if (this.depth === 0) {
      this.buf = ''
      this.scanned = 0
    }
    return out
  }
}
