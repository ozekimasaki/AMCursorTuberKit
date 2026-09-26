import type {
  ExplicitMemoryInput,
  MemoryContext,
  MemoryHealth,
  MemoryIngestInput,
  MemoryItem,
  MemoryProvider,
  RecallInput,
} from '@amctk/shared'

/**
 * primary（Cloudflare等）が落ちても local で続行する。
 * ingest は両方に書き、recall は primary 優先・失敗時 local。
 */
export class FallbackMemoryProvider implements MemoryProvider {
  readonly id: string
  private degradedUntil = 0

  constructor(
    private primary: MemoryProvider,
    private local: MemoryProvider,
    private onDegraded?: (err: unknown) => void,
  ) {
    this.id = `${primary.id}+${local.id}`
  }

  private get primaryUsable() {
    return Date.now() > this.degradedUntil
  }

  private fail(err: unknown) {
    // 60秒は primary を叩かない
    this.degradedUntil = Date.now() + 60_000
    this.onDegraded?.(err)
  }

  async health(): Promise<MemoryHealth> {
    const h = await this.primary.health().catch((e) => ({ ok: false, provider: this.primary.id, message: String(e) }))
    if (h.ok) return h
    return { ok: true, provider: this.local.id, message: `${h.message}（ローカル記憶で続行中）` }
  }

  async recall(input: RecallInput): Promise<MemoryContext> {
    if (this.primaryUsable) {
      try {
        const res = await this.primary.recall(input)
        if (res.items.length || res.summary) return res
      } catch (err) {
        this.fail(err)
      }
    }
    return this.local.recall(input)
  }

  async ingest(input: MemoryIngestInput): Promise<void> {
    await this.local.ingest(input).catch(() => undefined)
    if (!this.primaryUsable) return
    try {
      await this.primary.ingest(input)
    } catch (err) {
      this.fail(err)
    }
  }

  async remember(input: ExplicitMemoryInput): Promise<void> {
    await this.local.remember?.(input).catch(() => undefined)
    if (!this.primaryUsable || !this.primary.remember) return
    try {
      await this.primary.remember(input)
    } catch (err) {
      this.fail(err)
    }
  }

  async list(viewerKey?: string, limit?: number): Promise<MemoryItem[]> {
    return (await this.local.list?.(viewerKey, limit)) ?? []
  }

  async forget(id: string): Promise<void> {
    await this.local.forget?.(id)
  }
}
