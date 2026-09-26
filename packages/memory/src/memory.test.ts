import { describe, expect, it, vi } from 'vitest'
import type { MemoryItem, MemoryProvider } from '@amctk/shared'
import { normalizeRecall } from './cloudflare'
import { FallbackMemoryProvider } from './fallback'
import { LocalMemoryProvider, type MemoryStore } from './local'

class InMemoryStore implements MemoryStore {
  items: MemoryItem[] = []
  insert(item: MemoryItem) {
    this.items.push(item)
  }
  byViewer(viewerKey: string, limit: number) {
    return this.items.filter((m) => m.viewerKey === viewerKey).slice(0, limit)
  }
  search(terms: string[], limit: number) {
    return this.items.filter((m) => terms.some((t) => m.content.includes(t))).slice(0, limit)
  }
  list(viewerKey: string | undefined, limit: number) {
    return this.items.filter((m) => !viewerKey || m.viewerKey === viewerKey).slice(0, limit)
  }
  remove(id: string) {
    this.items = this.items.filter((m) => m.id !== id)
  }
  exists(viewerKey: string | undefined, content: string) {
    return this.items.some((m) => m.viewerKey === viewerKey && m.content === content)
  }
}

const viewer = { platform: 'youtube' as const, platformUserId: 'u1', displayName: 'もちこ' }

describe('LocalMemoryProvider', () => {
  it('会話から好みを抽出し、同じ内容は重複保存しない', async () => {
    const store = new InMemoryStore()
    const mem = new LocalMemoryProvider(store)
    const msg = { role: 'user' as const, content: 'もちこ: わたしはプリンが好きなんだよね', timestamp: Date.now() }
    await mem.ingest({ viewer, sessionId: 's', messages: [msg] })
    await mem.ingest({ viewer, sessionId: 's', messages: [msg] })
    expect(store.items).toHaveLength(1)
    expect(store.items[0].kind).toBe('preference')
    const ctx = await mem.recall({ viewer, query: 'プリン食べたい' })
    expect(ctx.items[0].content).toContain('プリン')
  })
})

describe('FallbackMemoryProvider', () => {
  it('primaryが落ちてもローカルで recall できる', async () => {
    const store = new InMemoryStore()
    const local = new LocalMemoryProvider(store)
    await local.remember({ viewer, kind: 'fact', content: '猫を飼っている' })
    const broken: MemoryProvider = {
      id: 'cf',
      health: async () => ({ ok: false, provider: 'cf' }),
      recall: vi.fn(async () => {
        throw new Error('network down')
      }),
      ingest: vi.fn(async () => {
        throw new Error('network down')
      }),
    }
    const onDegraded = vi.fn()
    const mem = new FallbackMemoryProvider(broken, local, onDegraded)
    const ctx = await mem.recall({ viewer, query: '猫' })
    expect(ctx.items.map((m) => m.content)).toContain('猫を飼っている')
    expect(onDegraded).toHaveBeenCalledOnce()
    // 落ちている間は primary を叩かない
    await mem.recall({ viewer, query: '猫' })
    expect(broken.recall).toHaveBeenCalledTimes(1)
    await expect(mem.ingest({ viewer, sessionId: 's', messages: [] })).resolves.toBeUndefined()
  })
})

describe('normalizeRecall', () => {
  it('Cloudflareのレスポンス形式の違いを吸収する', () => {
    expect(normalizeRecall({ memories: [{ id: 'a', content: 'x', type: 'event' }], answer: 'まとめ' }, 5)).toMatchObject({
      items: [{ id: 'a', content: 'x', kind: 'event' }],
      summary: 'まとめ',
    })
    expect(normalizeRecall(['a', 'b'], 1).items).toHaveLength(1)
  })
})
