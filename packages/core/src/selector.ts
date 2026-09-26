import { uid, viewerKeyOf, type SelectedInteraction, type StreamEvent } from '@amctk/shared'

export interface SelectorOptions {
  /** 最初のコメントが届いてから選ぶまで待つ時間。まとめて届いたものを比較するため */
  bufferMs: number
  minScore: number
  ignorePrefixes: string[]
  blockedWords: string[]
  maxQueue: number
  characterName: string
  /** 重複とみなす時間 */
  dedupeWindowMs?: number
  now?: () => number
}

interface Queued {
  event: StreamEvent
  baseScore: number
}

/**
 * Deduplicate → Buffer → Local Priority Scoring → Interaction Selector
 * すべてのコメントをLLMへ送らず、選ばれた1件（＋関連数件）だけを渡す。
 */
export class InteractionSelector {
  private queue: Queued[] = []
  private seenIds = new Map<string, number>()
  private recentTexts = new Map<string, number>()
  private knownViewers = new Set<string>()
  private lastAnsweredViewer = new Map<string, number>()
  private readonly now: () => number

  constructor(private options: SelectorOptions) {
    this.now = options.now ?? Date.now
  }

  configure(options: Partial<SelectorOptions>) {
    this.options = { ...this.options, ...options }
  }

  /** 受理されたら true。重複・フィルタで捨てたら false */
  push(event: StreamEvent): boolean {
    const now = this.now()
    this.gc(now)
    if (this.seenIds.has(event.id)) return false
    this.seenIds.set(event.id, now)

    const text = event.text.trim()
    if (event.kind === 'chat' && !text) return false
    if (event.kind === 'chat' && this.options.ignorePrefixes.some((p) => p && text.startsWith(p))) return false
    const lower = text.toLowerCase()
    if (this.options.blockedWords.some((w) => w && lower.includes(w.toLowerCase()))) return false

    const dedupeKey = `${viewerKeyOf(event.viewer)}|${normalizeText(text)}`
    const lastSame = this.recentTexts.get(dedupeKey)
    if (lastSame && now - lastSame < (this.options.dedupeWindowMs ?? 30_000) && event.kind === 'chat') return false
    this.recentTexts.set(dedupeKey, now)

    const baseScore = this.score(event)
    this.knownViewers.add(viewerKeyOf(event.viewer))
    this.queue.push({ event, baseScore })

    if (this.queue.length > this.options.maxQueue) {
      // 一番スコアの低いものから捨てる
      this.queue.sort((a, b) => this.effectiveScore(b, now) - this.effectiveScore(a, now))
      this.queue.length = this.options.maxQueue
    }
    return true
  }

  /** 選べる状態なら1件選んでキューから取り出す */
  take(): SelectedInteraction | null {
    const now = this.now()
    if (!this.queue.length) return null

    const manual = this.queue.find((q) => q.event.platform === 'manual')
    const oldest = Math.min(...this.queue.map((q) => q.event.receivedAt))
    if (!manual && now - oldest < this.options.bufferMs) return null

    const ranked = [...this.queue].sort((a, b) => this.effectiveScore(b, now) - this.effectiveScore(a, now))
    const best = manual ?? ranked[0]
    const bestScore = this.effectiveScore(best, now)
    if (!manual && bestScore < this.options.minScore) {
      // どれも低スコア。古すぎるものは捨てる
      this.queue = this.queue.filter((q) => now - q.event.receivedAt < 60_000)
      return null
    }

    this.queue = this.queue.filter((q) => q !== best)
    const related = ranked
      .filter((q) => q !== best && q.event.platform !== 'manual')
      .slice(0, 3)
      .map((q) => q.event)
    this.lastAnsweredViewer.set(viewerKeyOf(best.event.viewer), now)

    return {
      id: uid('int_'),
      primary: best.event,
      related,
      score: Math.round(bestScore),
      reason: describe(best.event, bestScore),
      selectedAt: now,
    }
  }

  pending(): StreamEvent[] {
    const now = this.now()
    return [...this.queue]
      .sort((a, b) => this.effectiveScore(b, now) - this.effectiveScore(a, now))
      .map((q) => q.event)
  }

  clear() {
    this.queue = []
  }

  get size() {
    return this.queue.length
  }

  score(event: StreamEvent): number {
    if (event.platform === 'manual') return 1000
    let s = 10
    switch (event.kind) {
      case 'superchat':
        s += 40 + Math.min(40, Math.log10(Math.max(1, event.amount?.value ?? 1)) * 12)
        break
      case 'cheer':
        s += 30 + Math.min(30, Math.log10(Math.max(1, event.amount?.value ?? 1)) * 10)
        break
      case 'subscribe':
      case 'gift':
        s += 25
        break
      case 'raid':
        s += 30
        break
      case 'follow':
        s += 8
        break
      case 'system':
        s -= 5
        break
    }
    const text = event.text.trim()
    const len = [...text].length
    if (/[?？]/.test(text)) s += 10
    if (this.options.characterName && text.includes(this.options.characterName)) s += 15
    if (len <= 1) s -= 10
    else if (len <= 60) s += 5
    else if (len > 140) s -= 6
    if (/^[\sw草ｗ笑!！。、.…]+$/i.test(text)) s -= 8
    if (!this.knownViewers.has(viewerKeyOf(event.viewer))) s += 8
    if (event.viewer.isModerator) s += 3
    if (event.viewer.isMember) s += 3
    return s
  }

  private effectiveScore(q: Queued, now: number): number {
    const ageSec = (now - q.event.receivedAt) / 1000
    let s = q.baseScore - ageSec / 5
    const answered = this.lastAnsweredViewer.get(viewerKeyOf(q.event.viewer))
    if (answered && now - answered < 60_000 && q.event.platform !== 'manual') s -= 15
    return s
  }

  private gc(now: number) {
    if (this.seenIds.size > 5000) {
      for (const [k, t] of this.seenIds) if (now - t > 10 * 60_000) this.seenIds.delete(k)
    }
    if (this.recentTexts.size > 2000) {
      for (const [k, t] of this.recentTexts) if (now - t > 60_000) this.recentTexts.delete(k)
    }
  }
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, '').toLowerCase().slice(0, 80)
}

function describe(event: StreamEvent, score: number): string {
  const parts: string[] = []
  if (event.platform === 'manual') parts.push('手入力')
  if (event.kind !== 'chat') parts.push(event.kind)
  if (/[?？]/.test(event.text)) parts.push('質問')
  parts.push(`score ${Math.round(score)}`)
  return parts.join(' / ')
}
