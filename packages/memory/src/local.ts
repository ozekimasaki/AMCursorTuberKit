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
} from '@amctk/shared'

/** SQLite等の実体はアプリ側が実装する */
export interface MemoryStore {
  insert(item: MemoryItem): void
  byViewer(viewerKey: string, limit: number): MemoryItem[]
  search(terms: string[], limit: number): MemoryItem[]
  list(viewerKey: string | undefined, limit: number): MemoryItem[]
  remove(id: string): void
  exists(viewerKey: string | undefined, content: string): boolean
}

const PREFERENCE_PATTERNS: { re: RegExp; kind: MemoryItem['kind']; template: (m: RegExpMatchArray) => string }[] = [
  { re: /(.{1,20}?)(?:が|も)(?:大?好き|すき)/, kind: 'preference', template: (m) => `${m[1]}が好き` },
  { re: /(.{1,20}?)(?:が|は)(?:嫌い|きらい|苦手)/, kind: 'preference', template: (m) => `${m[1]}が苦手` },
  { re: /趣味は(.{1,20})/, kind: 'preference', template: (m) => `趣味は${m[1]}` },
  { re: /誕生日は(.{1,15})/, kind: 'fact', template: (m) => `誕生日は${m[1]}` },
  { re: /(.{1,15})に住んで/, kind: 'fact', template: (m) => `${m[1]}に住んでいる` },
  { re: /(.{1,20})(?:を|が)?(?:始めた|はじめた)/, kind: 'event', template: (m) => `${m[1]}を始めた` },
]

/**
 * ローカル記憶。Cloudflare Agent Memory が使えないときも会話を続けられるようにする。
 */
export class LocalMemoryProvider implements MemoryProvider {
  readonly id = 'local'

  constructor(private store: MemoryStore) {}

  async health(): Promise<MemoryHealth> {
    try {
      this.store.list(undefined, 1)
      return { ok: true, provider: this.id, message: 'ローカル記憶（SQLite）' }
    } catch (err) {
      return { ok: false, provider: this.id, message: String(err) }
    }
  }

  async recall(input: RecallInput): Promise<MemoryContext> {
    const limit = input.limit ?? 6
    const viewerKey = input.viewer ? viewerKeyOf(input.viewer) : undefined
    const own = viewerKey ? this.store.byViewer(viewerKey, 30) : []
    const terms = tokenize(input.query)
    const scored = own
      .map((item) => ({ item, score: overlap(terms, item.content) + recency(item.createdAt) + kindWeight(item.kind) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ item, score }) => ({ ...item, score }))
    // 視聴者に紐づかない記憶（継続中の話題など）も少しだけ
    const general = terms.length
      ? this.store
          .search(terms, 3)
          .filter((m) => m.viewerKey !== viewerKey && (m.kind === 'topic' || m.kind === 'event'))
      : []
    return { items: [...scored, ...general].slice(0, limit) }
  }

  async ingest(input: MemoryIngestInput): Promise<void> {
    const viewerKey = input.viewer ? viewerKeyOf(input.viewer) : undefined
    for (const msg of input.messages) {
      if (msg.role !== 'user') continue
      for (const p of PREFERENCE_PATTERNS) {
        const m = msg.content.match(p.re)
        if (!m) continue
        const content = p.template(m).replace(/^[、。\s]+/, '').trim()
        if (content.length < 3 || this.store.exists(viewerKey, content)) continue
        this.store.insert({
          id: uid('mem_'),
          viewerKey,
          viewerName: input.viewer?.displayName,
          kind: p.kind,
          content,
          createdAt: msg.timestamp,
        })
      }
    }
  }

  async remember(input: ExplicitMemoryInput & { viewerKey?: string }): Promise<void> {
    const viewerKey = input.viewerKey ?? (input.viewer ? viewerKeyOf(input.viewer) : undefined)
    const content = input.content.trim()
    if (!content || this.store.exists(viewerKey, content)) return
    this.store.insert({
      id: uid('mem_'),
      viewerKey,
      viewerName: input.viewer?.displayName,
      kind: input.kind,
      content: content.slice(0, 400),
      createdAt: Date.now(),
    })
  }

  async list(viewerKey?: string, limit = 200): Promise<MemoryItem[]> {
    return this.store.list(viewerKey, limit)
  }

  async forget(id: string): Promise<void> {
    this.store.remove(id)
  }
}

export function tokenize(text: string): string[] {
  const words = text
    .toLowerCase()
    .split(/[\s、。！？!?,.「」『』（）()・…ー〜~]+/)
    .filter((w) => w.length >= 2)
  // 日本語は分かち書きしないので2文字のn-gramも使う
  const grams: string[] = []
  const compact = text.replace(/[\s、。！？!?,.]/g, '')
  for (let i = 0; i < compact.length - 1 && grams.length < 40; i++) grams.push(compact.slice(i, i + 2))
  return [...new Set([...words, ...grams])]
}

function overlap(terms: string[], content: string): number {
  if (!terms.length) return 0
  const lower = content.toLowerCase()
  let hit = 0
  for (const t of terms) if (lower.includes(t)) hit++
  return (hit / terms.length) * 10
}

function recency(createdAt: number): number {
  const days = (Date.now() - createdAt) / 86_400_000
  return Math.max(0, 3 - days / 10)
}

function kindWeight(kind: MemoryItem['kind']): number {
  return kind === 'preference' || kind === 'relationship' ? 2 : kind === 'fact' ? 1.5 : 1
}
