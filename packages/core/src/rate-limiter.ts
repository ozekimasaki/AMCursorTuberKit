/** 1分あたりの呼び出し数と最短間隔で、LLM呼び出しの暴走を防ぐ */
export class CallRateLimiter {
  private calls: number[] = []

  constructor(
    private options: { maxPerMinute: number; minIntervalMs: number },
    private now: () => number = Date.now,
  ) {}

  configure(options: Partial<{ maxPerMinute: number; minIntervalMs: number }>) {
    this.options = { ...this.options, ...options }
  }

  canCall(): boolean {
    const now = this.now()
    this.calls = this.calls.filter((t) => now - t < 60_000)
    if (this.calls.length >= this.options.maxPerMinute) return false
    const last = this.calls[this.calls.length - 1]
    return !(last && now - last < this.options.minIntervalMs)
  }

  record() {
    this.calls.push(this.now())
  }

  get lastMinute(): number {
    const now = this.now()
    return this.calls.filter((t) => now - t < 60_000).length
  }
}
