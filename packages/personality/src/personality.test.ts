import { describe, expect, it } from 'vitest'
import { createSins, defaultSettings } from '@amctk/shared'
import { buildTurnPrompt, deriveEmotion, motionProfile, voiceModulation } from './index'

describe('personality', () => {
  it('状態が声色に反映される（憤怒で速く、怠惰で遅く）', () => {
    const angry = voiceModulation({ ...createSins(50), wrath: 100 }, 'neutral')
    const lazy = voiceModulation({ ...createSins(50), sloth: 100 }, 'neutral')
    expect(angry.speed).toBeGreaterThan(1)
    expect(lazy.speed).toBeLessThan(1)
    expect(lazy.intonation).toBeLessThan(angry.intonation)
  })

  it('目立つパラメーターから表情を推定する', () => {
    expect(deriveEmotion({ ...createSins(50), sloth: 90 }).emotion).toBe('sleepy')
    expect(deriveEmotion(createSins(50)).emotion).toBe('neutral')
  })

  it('モーション係数は安全な範囲に収まる', () => {
    const m = motionProfile(createSins(100))
    expect(m.bounce).toBeLessThanOrEqual(1.8)
    expect(m.blinkPerMinute).toBeGreaterThanOrEqual(6)
  })

  it('プロンプトに出力形式・状態・記憶・相手の発言が入る', () => {
    const s = defaultSettings()
    const prompt = buildTurnPrompt({
      character: s.character,
      current: { ...createSins(50), gluttony: 80 },
      baseline: createSins(50),
      interaction: {
        id: 'i',
        primary: { id: 'e', platform: 'twitch', kind: 'chat', text: 'おなかすいた', receivedAt: 0, viewer: { platform: 'twitch', platformUserId: '1', displayName: 'Kuma' } },
        related: [],
        score: 10,
        reason: '',
        selectedAt: 0,
      },
      memory: { items: [{ id: 'm', kind: 'preference', content: 'ラーメンが好き', createdAt: 0 }] },
      recent: [],
      maxDelta: 8,
      toolsAvailable: false,
    })
    expect(prompt).toContain('<meta>')
    expect(prompt).toContain('暴食')
    expect(prompt).toContain('ラーメンが好き')
    expect(prompt).toContain('おなかすいた')
    expect(prompt).toContain('-8〜8')
  })
})
