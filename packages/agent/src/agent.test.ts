import { describe, expect, it, vi } from 'vitest'
import { StreamingMetaParser } from '@amctk/core'
import { createSins } from '@amctk/shared'
import { DENIED_BUILTIN_TOOLS, allowedBuiltinTools } from './cursor-agent'
import { DemoCharacterAgent } from './demo-agent'
import { createCharacterTools } from './tools'

describe('custom tools', () => {
  const bridge = {
    getCharacterState: () => ({ ok: true }),
    getViewerContext: async () => ({ memories: [] }),
    proposeSinDelta: vi.fn(),
    setEmotion: vi.fn(),
  }
  const tools = createCharacterTools(bridge)

  it('公開するのは4つのCustom Toolだけ', () => {
    expect(Object.keys(tools).sort()).toEqual(['get_character_state', 'get_viewer_context', 'propose_sin_delta', 'set_emotion'])
  })

  it('set_emotion は未知の感情を拒否する', async () => {
    expect(await tools.set_emotion.execute({ emotion: 'rage' })).toMatchObject({ accepted: false })
    expect(bridge.setEmotion).not.toHaveBeenCalled()
    await tools.set_emotion.execute({ emotion: 'HAPPY', intensity: 0.5 })
    expect(bridge.setEmotion).toHaveBeenCalledWith('happy', 0.5)
  })

  it('propose_sin_delta は提案を渡すだけ', async () => {
    await tools.propose_sin_delta.execute({ pride: 3 })
    expect(bridge.proposeSinDelta).toHaveBeenCalledWith({ pride: 3 })
  })
})

describe('built-in tools', () => {
  it('Web系ツールは設定で切り替え、シェル・ファイル操作は常に許可しない', () => {
    expect(allowedBuiltinTools({ web: true })).toEqual(['mcp', 'webSearch', 'webFetch'])
    expect(allowedBuiltinTools({ web: false })).toEqual(['mcp'])
    for (const web of [true, false]) {
      const allowed = allowedBuiltinTools({ web })
      for (const denied of DENIED_BUILTIN_TOOLS) expect(allowed).not.toContain(denied)
    }
    expect(DENIED_BUILTIN_TOOLS).toEqual(expect.arrayContaining(['shell', 'edit', 'delete']))
  })
})

describe('DemoCharacterAgent', () => {
  it('メタ情報付きで返事をストリーミングする', async () => {
    const agent = new DemoCharacterAgent()
    const parser = new StreamingMetaParser()
    let visible = ''
    await agent.run('', {
      onText: (d) => (visible += parser.push(d)),
      context: {
        interaction: {
          id: 'i',
          primary: { id: 'e', platform: 'youtube', kind: 'chat', text: 'プリン食べたい', receivedAt: 0, viewer: { platform: 'youtube', platformUserId: '1', displayName: 'もちこ' } },
          related: [],
          score: 1,
          reason: '',
          selectedAt: 0,
        },
        memory: null,
        sins: createSins(50),
        characterName: 'キャットリン',
        firstPerson: 'わたし',
      },
    })
    visible += parser.flush()
    expect(visible.trim().length).toBeGreaterThan(5)
    expect(visible).not.toContain('<meta>')
    expect(parser.meta.sinDelta).toMatchObject({ gluttony: 7 })
  })
})
