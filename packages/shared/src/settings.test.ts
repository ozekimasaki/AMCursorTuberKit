import { describe, expect, it } from 'vitest'
import { DEFAULT_CHARACTER, defaultSettings, parseSettings } from './settings'

const legacy = {
  name: 'ぷるる',
  persona: 'ゆるくて明るいAI配信者の女の子。視聴者のことを「みんな」と呼ぶ。語尾はときどき「〜だよ」「〜かも！」。好きなものはプリンとゲーム。',
  speakingStyle: '一文を短めに。返答は2〜3文程度。絵文字や顔文字は使わない。',
  baseline: { pride: 50, greed: 50, lust: 50, envy: 50, gluttony: 50, wrath: 50, sloth: 50 },
}

describe('settings', () => {
  it('初期キャラクターはキャットリン', () => {
    const s = defaultSettings()
    expect(s.character.name).toBe('キャットリン')
    expect(s.character.persona).toContain('月灯りのティーサロン')
    expect(s.character.speakingStyle).toContain('1ターンに1つまで')
    expect(s.character.baseline).toEqual(DEFAULT_CHARACTER.baseline)
  })

  it('初版のまま編集されていないキャラクターは新しい初期値へ移行する', () => {
    const s = parseSettings({ character: legacy, stage: { scale: 1.5 } })
    expect(s.character.name).toBe('キャットリン')
    expect(s.character.speakingStyle).toBe(DEFAULT_CHARACTER.speakingStyle)
    expect(s.character.baseline).toEqual(DEFAULT_CHARACTER.baseline)
    expect(s.stage.scale).toBe(1.5)
  })

  it('利用者が編集した項目は移行しない', () => {
    const edited = parseSettings({ character: { ...legacy, name: 'みけ' } })
    expect(edited.character.name).toBe('みけ')
    expect(edited.character.persona).toBe(legacy.persona)
    const style = parseSettings({ character: { ...legacy, speakingStyle: '関西弁で話す', baseline: { ...legacy.baseline, wrath: 80 } } })
    expect(style.character.name).toBe('キャットリン')
    expect(style.character.speakingStyle).toBe('関西弁で話す')
    expect(style.character.baseline.wrath).toBe(80)
  })

  it('配信コメントの取得経路は既定でAPIキー不要（web）。保存済みの設定にも補われ、公式APIの選択は残す', () => {
    const s = defaultSettings().stream
    expect([s.youtube.source, s.twitch.source, s.kick.source]).toEqual(['web', 'web', 'web'])
    expect(s.kick.chatroomId).toBe('')
    const saved = parseSettings({ stream: { youtube: { enabled: true, target: 'abcdefghijk' }, twitch: { source: 'api', clientId: 'cid' } } })
    expect(saved.stream.youtube).toMatchObject({ enabled: true, source: 'web', target: 'abcdefghijk' })
    expect(saved.stream.twitch).toMatchObject({ source: 'api', clientId: 'cid' })
  })

  it('組み込みアバターの既定はココア。旧版の既定色（strawberry）だけ移行し、選び直した色は残す', () => {
    expect(defaultSettings().avatar.builtin).toEqual({ palette: 'cocoa', revision: 2 })
    expect(parseSettings({ avatar: { kind: 'builtin', builtin: { palette: 'strawberry' } } }).avatar.builtin.palette).toBe('cocoa')
    expect(parseSettings({ avatar: { builtin: { palette: 'mint' } } }).avatar.builtin.palette).toBe('mint')
    expect(parseSettings({ avatar: { builtin: { palette: 'strawberry', revision: 2 } } }).avatar.builtin.palette).toBe('strawberry')
  })
})
