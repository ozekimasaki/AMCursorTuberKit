import {
  SIN_KEYS,
  clampSin,
  createSins,
  isSinKey,
  type SevenSins,
  type SinDelta,
  type SinStateSnapshot,
} from '@amctk/shared'

export interface SinsEngineOptions {
  baseline: SevenSins
  /** baselineとの差が半分になるまでの秒数 */
  halfLifeSec: number
  /** 1回の適用で各値が動ける最大量 */
  maxDeltaPerTurn: number
  /** 1回の適用で全体として動ける最大量（合計の絶対値） */
  maxTotalDeltaPerTurn?: number
  now?: () => number
}

/**
 * 七つの大罪の内部ステート。
 * LLMは propose_sin_delta で「提案」するだけで、ここでValidation/Clampして適用する。
 */
export class SevenSinsEngine {
  private baseline: SevenSins
  private current: SevenSins
  private lastTick: number
  private updatedAt: number
  private readonly now: () => number

  constructor(private options: SinsEngineOptions, current?: SevenSins) {
    this.now = options.now ?? Date.now
    this.baseline = sanitize(options.baseline)
    this.current = current ? sanitize(current) : { ...this.baseline }
    this.lastTick = this.now()
    this.updatedAt = this.lastTick
  }

  configure(options: Partial<Omit<SinsEngineOptions, 'now'>>) {
    this.options = { ...this.options, ...options }
    if (options.baseline) this.baseline = sanitize(options.baseline)
  }

  /** 提案値を検証して、実際に適用された差分を返す */
  applyDelta(proposal: unknown): SinDelta {
    const delta = sanitizeDelta(proposal, this.options.maxDeltaPerTurn)
    const maxTotal = this.options.maxTotalDeltaPerTurn ?? this.options.maxDeltaPerTurn * 3
    const total = Object.values(delta).reduce((s, v) => s + Math.abs(v ?? 0), 0)
    const ratio = total > maxTotal ? maxTotal / total : 1

    const applied: SinDelta = {}
    for (const key of SIN_KEYS) {
      const d = delta[key]
      if (!d) continue
      const before = this.current[key]
      const after = clampSin(before + d * ratio)
      const real = Math.round((after - before) * 10) / 10
      if (real !== 0) {
        this.current[key] = after
        applied[key] = real
      }
    }
    if (Object.keys(applied).length) this.updatedAt = this.now()
    return applied
  }

  /** 時間経過でbaselineへ戻す。変化があれば true */
  tick(): boolean {
    const now = this.now()
    const dt = (now - this.lastTick) / 1000
    this.lastTick = now
    if (dt <= 0) return false
    const k = Math.pow(0.5, dt / this.options.halfLifeSec)
    let changed = false
    for (const key of SIN_KEYS) {
      const b = this.baseline[key]
      const c = this.current[key]
      if (Math.abs(c - b) < 0.05) {
        if (c !== b) {
          this.current[key] = b
          changed = true
        }
        continue
      }
      const next = b + (c - b) * k
      this.current[key] = Math.abs(next - b) < 0.05 ? b : next
      changed = true
    }
    if (changed) this.updatedAt = now
    return changed
  }

  reset() {
    this.current = { ...this.baseline }
    this.updatedAt = this.now()
  }

  snapshot(): SinStateSnapshot {
    return {
      current: roundSins(this.current),
      baseline: { ...this.baseline },
      updatedAt: this.updatedAt,
    }
  }

  get values(): SevenSins {
    return { ...this.current }
  }
}

function sanitize(input: Partial<SevenSins> | undefined): SevenSins {
  const out = createSins(50)
  for (const key of SIN_KEYS) {
    const v = input?.[key]
    if (typeof v === 'number') out[key] = clampSin(v)
  }
  return out
}

export function sanitizeDelta(proposal: unknown, maxAbs: number): SinDelta {
  const out: SinDelta = {}
  if (!proposal || typeof proposal !== 'object') return out
  for (const [rawKey, rawValue] of Object.entries(proposal as Record<string, unknown>)) {
    const key = rawKey.toLowerCase()
    if (!isSinKey(key)) continue
    const n = typeof rawValue === 'number' ? rawValue : Number(rawValue)
    if (!Number.isFinite(n) || n === 0) continue
    out[key] = Math.max(-maxAbs, Math.min(maxAbs, n))
  }
  return out
}

function roundSins(s: SevenSins): SevenSins {
  return Object.fromEntries(SIN_KEYS.map((k) => [k, Math.round(s[k] * 10) / 10])) as SevenSins
}
