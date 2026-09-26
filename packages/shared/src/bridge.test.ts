import { describe, expect, it } from 'vitest'
import { createAmctkApi, INVOKE, PUSH, SEND, type BridgeTransport } from './bridge'

function fakeTransport() {
  const calls: { kind: 'invoke' | 'send' | 'subscribe'; channel: string; args: unknown[] }[] = []
  const listeners = new Map<string, (p: unknown) => void>()
  const t: BridgeTransport = {
    invoke: async (channel, ...args) => {
      calls.push({ kind: 'invoke', channel, args })
      return channel
    },
    send: (channel, ...args) => void calls.push({ kind: 'send', channel, args }),
    subscribe: (channel, cb) => {
      calls.push({ kind: 'subscribe', channel, args: [] })
      listeners.set(channel, cb)
      return () => listeners.delete(channel)
    },
  }
  return { t, calls, listeners }
}

describe('Renderer ↔ Main の通信の取り決め', () => {
  it('チャンネル名に重複がない', () => {
    const all = [...Object.values(INVOKE), ...Object.values(SEND), ...Object.values(PUSH)]
    expect(new Set(all).size).toBe(all.length)
  })

  it('API の呼び出しを対応するチャンネルへ引数ごと渡す', async () => {
    const { t, calls } = fakeTransport()
    const api = createAmctkApi(t, 'control')
    await api.settings.update({ ui: { theme: 'dark' } })
    await api.assets.import('vrm', { assetId: 'vrm-1' })
    await api.stream.connect('kick')
    expect(calls).toEqual([
      { kind: 'invoke', channel: 'settings:update', args: [{ ui: { theme: 'dark' } }] },
      { kind: 'invoke', channel: 'assets:import', args: ['vrm', { assetId: 'vrm-1' }] },
      { kind: 'invoke', channel: 'stream:connect', args: ['kick'] },
    ])
    expect(api.app.role).toBe('control')
  })

  it('音声コマンドの購読を始めたら再生可能を通知し、解除できる', () => {
    const { t, calls, listeners } = fakeTransport()
    const api = createAmctkApi(t, 'stage')
    const got: unknown[] = []
    const off = api.audio.onCommand((cmd) => got.push(cmd))
    expect(calls.map((c) => `${c.kind}:${c.channel}`)).toEqual(['subscribe:amctk:audio', 'send:renderer:ready'])
    listeners.get(PUSH.audio)?.({ type: 'stop' })
    expect(got).toEqual([{ type: 'stop' }])
    off()
    expect(listeners.has(PUSH.audio)).toBe(false)
    api.audio.lip(0.5)
    expect(calls.at(-1)).toEqual({ kind: 'send', channel: 'audio:lip', args: [0.5] })
  })
})
