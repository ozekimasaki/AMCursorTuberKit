import {
  uid,
  viewerKeyOf,
  type ExplicitMemoryInput,
  type MemoryContext,
  type MemoryHealth,
  type MemoryIngestInput,
  type MemoryItem,
  type MemoryProvider,
  type RecallInput,
  type StreamViewer,
} from '@amctk/shared'

export interface CloudflareMemoryOptions {
  accountId: string
  apiToken: string
  namespace: string
  apiBase?: string
  /** 視聴者に紐づかない記憶を入れるprofile名 */
  defaultProfile?: string
  fetchImpl?: typeof fetch
}

interface CfEnvelope<T> {
  success: boolean
  result: T
  errors?: { message: string }[]
}

/**
 * Cloudflare Agent Memory (HTTP API)
 * namespace = キャラクター単位 / profile = 視聴者単位 で分ける。
 * private beta のため、失敗しても FallbackMemoryProvider がローカルへ切り替える。
 */
export class CloudflareAgentMemoryProvider implements MemoryProvider {
  readonly id = 'cloudflare'
  private ensured = false

  constructor(private options: CloudflareMemoryOptions) {}

  private get base() {
    const api = (this.options.apiBase ?? 'https://api.cloudflare.com/client/v4').replace(/\/$/, '')
    return `${api}/accounts/${encodeURIComponent(this.options.accountId)}/agent-memory`
  }

  private profileUrl(viewer?: StreamViewer, viewerKey?: string) {
    const key = viewerKey ?? (viewer ? viewerKeyOf(viewer) : (this.options.defaultProfile ?? 'shared'))
    const profile = key.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
    return `${this.base}/namespaces/${encodeURIComponent(this.options.namespace)}/profiles/${profile}`
  }

  private async call<T>(url: string, init: RequestInit = {}): Promise<T> {
    const f = this.options.fetchImpl ?? fetch
    const res = await f(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.options.apiToken}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    })
    const body = (await res.json().catch(() => null)) as CfEnvelope<T> | null
    if (!res.ok || !body?.success) {
      const msg = body?.errors?.map((e) => e.message).join(', ') || `HTTP ${res.status}`
      throw new Error(`Cloudflare Agent Memory: ${msg}`)
    }
    return body.result
  }

  private async ensureNamespace() {
    if (this.ensured) return
    try {
      await this.call(`${this.base}/namespaces/${encodeURIComponent(this.options.namespace)}`)
    } catch {
      await this.call(`${this.base}/namespaces`, {
        method: 'POST',
        body: JSON.stringify({ name: this.options.namespace }),
      })
    }
    this.ensured = true
  }

  async health(): Promise<MemoryHealth> {
    if (!this.options.accountId || !this.options.apiToken) {
      return { ok: false, provider: this.id, message: 'Account ID または API Token が未設定です' }
    }
    try {
      await this.ensureNamespace()
      return { ok: true, provider: this.id, message: `namespace: ${this.options.namespace}` }
    } catch (err) {
      return { ok: false, provider: this.id, message: err instanceof Error ? err.message : String(err) }
    }
  }

  async recall(input: RecallInput): Promise<MemoryContext> {
    await this.ensureNamespace()
    const result = await this.call<unknown>(`${this.profileUrl(input.viewer)}/recall`, {
      method: 'POST',
      body: JSON.stringify({ query: input.query, thinkingLevel: 'low', responseLength: 'short' }),
    })
    return normalizeRecall(result, input.limit ?? 6)
  }

  async ingest(input: MemoryIngestInput): Promise<void> {
    await this.ensureNamespace()
    await this.call(`${this.profileUrl(input.viewer)}/ingest`, {
      method: 'POST',
      body: JSON.stringify({
        sessionId: input.sessionId,
        messages: input.messages.map((m) => ({
          role: m.role,
          content: m.content,
          timestamp: new Date(m.timestamp).toISOString(),
        })),
      }),
    })
  }

  async remember(input: ExplicitMemoryInput & { viewerKey?: string }): Promise<void> {
    await this.ensureNamespace()
    await this.call(`${this.profileUrl(input.viewer, input.viewerKey)}/remember`, {
      method: 'POST',
      body: JSON.stringify({ content: input.content }),
    })
  }

  async list(viewerKey?: string, limit = 50): Promise<MemoryItem[]> {
    await this.ensureNamespace()
    const result = await this.call<unknown>(`${this.profileUrl(undefined, viewerKey)}/memories?per_page=${limit}`)
    return normalizeRecall(result, limit).items.map((m) => ({ ...m, viewerKey }))
  }
}

/** レスポンス形式が変わっても落ちないよう緩く解釈する */
export function normalizeRecall(result: unknown, limit: number): MemoryContext {
  const items: MemoryItem[] = []
  let summary: string | undefined
  const pushItem = (raw: unknown) => {
    if (typeof raw === 'string') {
      items.push({ id: uid('cf_'), kind: 'fact', content: raw, createdAt: Date.now() })
      return
    }
    if (!raw || typeof raw !== 'object') return
    const r = raw as Record<string, unknown>
    const content = [r.content, r.text, r.memory, r.value].find((v) => typeof v === 'string') as string | undefined
    if (!content) return
    const type = String(r.type ?? r.kind ?? 'fact')
    items.push({
      id: String(r.id ?? uid('cf_')),
      kind: (['fact', 'event', 'preference', 'relationship', 'topic', 'note'].includes(type) ? type : 'fact') as MemoryItem['kind'],
      content,
      createdAt: Date.parse(String(r.createdAt ?? r.created_at ?? '')) || Date.now(),
      score: typeof r.score === 'number' ? r.score : undefined,
    })
  }
  if (Array.isArray(result)) result.forEach(pushItem)
  else if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>
    for (const key of ['memories', 'results', 'items', 'data']) if (Array.isArray(r[key])) (r[key] as unknown[]).forEach(pushItem)
    for (const key of ['answer', 'summary', 'response', 'text']) if (typeof r[key] === 'string') summary = r[key] as string
  } else if (typeof result === 'string') summary = result
  return { items: items.slice(0, limit), summary }
}
