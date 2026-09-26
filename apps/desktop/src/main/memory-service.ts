import { CloudflareAgentMemoryProvider, FallbackMemoryProvider, LocalMemoryProvider } from '@amctk/memory'
import {
  withTimeout,
  type AppSettings,
  type ExplicitMemoryInput,
  type MemoryContext,
  type MemoryHealth,
  type MemoryIngestInput,
  type MemoryItem,
  type MemoryProvider,
  type RecallInput,
} from '@amctk/shared'
import type { ScopedLogger } from './logger'
import type { SecretService } from './secret-service'
import type { Storage } from './storage'

/**
 * Memory Failure → Memoryなしで会話続行。
 * recall はタイムアウト付きで、失敗しても null を返すだけにする。
 */
export class MemoryService {
  private provider: MemoryProvider
  private local: LocalMemoryProvider

  constructor(
    private getSettings: () => AppSettings,
    private secrets: SecretService,
    storage: Storage,
    private log: ScopedLogger,
  ) {
    this.local = new LocalMemoryProvider(storage)
    this.provider = this.build()
  }

  rebuild() {
    this.provider = this.build()
  }

  private build(): MemoryProvider {
    const m = this.getSettings().memory
    if (m.provider !== 'cloudflare') return this.local
    const cf = new CloudflareAgentMemoryProvider({
      accountId: m.cloudflare.accountId,
      apiToken: this.secrets.get('cloudflareApiToken'),
      namespace: m.cloudflare.namespace,
      apiBase: m.cloudflare.apiBase,
    })
    return new FallbackMemoryProvider(cf, this.local, (err) =>
      this.log.warn('cloudflare agent memory degraded, using local', { error: String(err) }),
    )
  }

  health(): Promise<MemoryHealth> {
    return this.provider.health()
  }

  async recall(input: RecallInput): Promise<MemoryContext | null> {
    const timeout = this.getSettings().memory.recallTimeoutMs
    return withTimeout(
      this.provider.recall(input).catch((err) => {
        this.log.warn('recall failed', { error: String(err) })
        return null
      }),
      timeout,
      null,
    )
  }

  async ingest(input: MemoryIngestInput) {
    if (!this.getSettings().memory.ingestEnabled) return
    await this.provider.ingest(input).catch((err) => this.log.warn('ingest failed', { error: String(err) }))
  }

  async remember(input: ExplicitMemoryInput & { viewerKey?: string }) {
    const target = this.provider.remember ? this.provider : this.local
    await target.remember!(input).catch((err: unknown) => this.log.warn('remember failed', { error: String(err) }))
  }

  async list(viewerKey?: string): Promise<MemoryItem[]> {
    return (await this.local.list(viewerKey, 300)) ?? []
  }

  async forget(id: string) {
    await this.local.forget(id)
  }
}
