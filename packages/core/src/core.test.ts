import { describe, expect, it } from 'vitest'
import { createSins, type StreamEvent } from '@amctk/shared'
import { CallRateLimiter } from './rate-limiter'
import { InteractionSelector } from './selector'
import { SentenceSegmenter } from './segmenter'
import { SevenSinsEngine, sanitizeDelta } from './sins-engine'
import { StreamingMetaParser, parseMetaJson } from './meta-parser'

function clock(start = 1_000_000) {
  let t = start
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

function event(partial: Partial<StreamEvent> & { id: string; text: string }, at: number): StreamEvent {
  return {
    platform: 'youtube',
    kind: 'chat',
    receivedAt: at,
    viewer: { platform: 'youtube', platformUserId: partial.id, displayName: `v-${partial.id}` },
    ...partial,
  }
}

describe('SevenSinsEngine', () => {
  it('LLMの提案値は1ターンの上限でClampされ、0〜100に収まる', () => {
    const c = clock()
    const e = new SevenSinsEngine({ baseline: { ...createSins(50), wrath: 95 }, halfLifeSec: 60, maxDeltaPerTurn: 8, now: c.now })
    const applied = e.applyDelta({ wrath: 40, pride: -100, unknown: 5, sloth: 'x' })
    expect(applied.wrath).toBe(5) // 95 → 100 で頭打ち
    expect(applied.pride).toBeLessThanOrEqual(0)
    expect(applied.pride).toBeGreaterThanOrEqual(-8)
    expect(e.values.wrath).toBe(100)
    expect('unknown' in applied).toBe(false)
  })

  it('合計の変化量にも上限がある', () => {
    const e = new SevenSinsEngine({ baseline: createSins(50), halfLifeSec: 60, maxDeltaPerTurn: 8, maxTotalDeltaPerTurn: 10 })
    const applied = e.applyDelta({ pride: 8, greed: 8, lust: 8, envy: 8 })
    const total = Object.values(applied).reduce((s, v) => s + Math.abs(v ?? 0), 0)
    expect(total).toBeLessThanOrEqual(10.5)
  })

  it('時間経過でbaselineへ戻る（半減期）', () => {
    const c = clock()
    const e = new SevenSinsEngine({ baseline: createSins(50), halfLifeSec: 10, maxDeltaPerTurn: 30, now: c.now })
    e.applyDelta({ gluttony: 20 })
    expect(e.values.gluttony).toBe(70)
    c.advance(10_000)
    e.tick()
    expect(e.values.gluttony).toBeCloseTo(60, 1)
    c.advance(200_000)
    e.tick()
    expect(e.values.gluttony).toBe(50)
  })

  it('sanitizeDelta は大文字キーや文字列数値も受け付ける', () => {
    expect(sanitizeDelta({ Pride: '3', WRATH: -2 }, 8)).toEqual({ pride: 3, wrath: -2 })
    expect(sanitizeDelta(null, 8)).toEqual({})
  })
})

describe('InteractionSelector', () => {
  const opts = { bufferMs: 1000, minScore: 5, ignorePrefixes: ['!'], blockedWords: ['NG'], maxQueue: 20, characterName: 'ぷるる' }

  it('重複・コマンド・NGワードを除外する', () => {
    const c = clock()
    const s = new InteractionSelector({ ...opts, now: c.now })
    expect(s.push(event({ id: 'a', text: 'こんにちは' }, c.now()))).toBe(true)
    expect(s.push(event({ id: 'a', text: 'こんにちは' }, c.now()))).toBe(false) // 同じID
    expect(s.push(event({ id: 'b', text: '!song' }, c.now()))).toBe(false)
    expect(s.push(event({ id: 'c', text: 'これはNGです' }, c.now()))).toBe(false)
    expect(s.size).toBe(1)
  })

  it('バッファ時間を待ってから、スパチャ・質問を優先して1件だけ選ぶ', () => {
    const c = clock()
    const s = new InteractionSelector({ ...opts, now: c.now })
    for (let i = 0; i < 40; i++) s.push(event({ id: `x${i}`, text: `コメント${i}` }, c.now()))
    s.push(event({ id: 'sc', text: '応援してます', kind: 'superchat', amount: { value: 1000, currency: 'JPY' } }, c.now()))
    expect(s.take()).toBeNull() // まだバッファ中
    c.advance(1200)
    const picked = s.take()
    expect(picked?.primary.id).toBe('sc')
    expect(picked?.related.length).toBeLessThanOrEqual(3)
    expect(s.size).toBe(19) // maxQueue(20) - 1
  })

  it('手入力は待たずに最優先', () => {
    const c = clock()
    const s = new InteractionSelector({ ...opts, now: c.now })
    s.push(event({ id: 'y', text: '質問です？' }, c.now()))
    s.push(event({ id: 'm', text: 'テスト', platform: 'manual', viewer: { platform: 'manual', platformUserId: 'me', displayName: '配信者' } }, c.now()))
    expect(s.take()?.primary.id).toBe('m')
  })

  it('キャラ名入りのコメントはスコアが上がる', () => {
    const s = new InteractionSelector(opts)
    const a = s.score(event({ id: 'p', text: 'ぷるるちゃん元気？' }, 0))
    const b = s.score(event({ id: 'q', text: '元気？' }, 0))
    expect(a).toBeGreaterThan(b)
  })
})

describe('CallRateLimiter', () => {
  it('1分あたりの回数と最短間隔を守る', () => {
    const c = clock()
    const l = new CallRateLimiter({ maxPerMinute: 3, minIntervalMs: 1000 }, c.now)
    expect(l.canCall()).toBe(true)
    l.record()
    expect(l.canCall()).toBe(false)
    c.advance(1000)
    l.record()
    c.advance(1000)
    l.record()
    c.advance(1000)
    expect(l.canCall()).toBe(false) // 3回/分に到達
    c.advance(60_000)
    expect(l.canCall()).toBe(true)
  })
})

describe('SentenceSegmenter', () => {
  it('句点で区切り、ストリームの途中でも文が完成したら返す', () => {
    const seg = new SentenceSegmenter()
    expect(seg.push('こんにちは。今日は')).toEqual(['こんにちは。'])
    expect(seg.push('いい天気だね！？ ')).toEqual(['今日はいい天気だね！？'])
    expect(seg.flush()).toEqual([])
  })

  it('句点がなく長い文は読点で切る', () => {
    const seg = new SentenceSegmenter({ maxChars: 20 })
    const out = seg.push('あいうえおかきくけこ、さしすせそたちつてとなにぬねの')
    expect(out[0]).toBe('あいうえおかきくけこ、')
  })
})

describe('StreamingMetaParser', () => {
  it('チャンクの境界で <meta> が分かれても取り除ける', () => {
    const p = new StreamingMetaParser()
    const chunks = ['<me', 'ta>{"emotion":"happy","sin_del', 'ta":{"pride":3}}</me', 'ta>\nやったー！', 'うれしい']
    const text = chunks.map((c) => p.push(c)).join('') + p.flush()
    expect(text.trim()).toBe('やったー！うれしい')
    expect(p.meta.emotion).toBe('happy')
    expect(p.meta.sinDelta).toEqual({ pride: 3 })
  })

  it('メタがなくてもそのまま流す', () => {
    const p = new StreamingMetaParser()
    expect(p.push('こんにちは<') + p.push('b>') + p.flush()).toBe('こんにちは<b>')
    expect(p.meta.emotion).toBeUndefined()
  })

  it('不正な感情名は無視する', () => {
    expect(parseMetaJson('{"emotion":"furious"}')?.emotion).toBeUndefined()
    expect(parseMetaJson('not json')).toBeNull()
  })
})
