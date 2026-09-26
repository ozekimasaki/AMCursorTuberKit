import {
  SECRET_KEYS,
  createSins,
  defaultSettings,
  mergeDeep,
  parseSettings,
  uid,
  type AmctkApi,
  type AppEvent,
  type AppSettings,
  type AudioCommand,
  type ConversationEntry,
  type RuntimeSnapshot,
  type SecretStatus,
} from '@amctk/shared'

/**
 * ブラウザ単体でUIを確認するためのモック（`pnpm preview:web`）。
 * Electron上では使われない。
 */
export function createMockApi(): AmctkApi {
  let settings = defaultSettings()
  const secrets = Object.fromEntries(SECRET_KEYS.map((k) => [k, false])) as SecretStatus
  const eventCbs = new Set<(e: AppEvent) => void>()
  const settingsCbs = new Set<(s: AppSettings) => void>()
  const audioCbs = new Set<(c: AudioCommand) => void>()
  const emit = (e: AppEvent) => eventCbs.forEach((cb) => cb(e))
  const sins = { ...createSins(50), pride: 58, gluttony: 66, sloth: 38 }
  const conversation: ConversationEntry[] = [
    { id: 'c1', role: 'viewer', text: 'こんばんは！初見です', viewerName: 'もちこ', platform: 'youtube', at: Date.now() - 60000 },
    { id: 'c2', role: 'character', text: 'もちこさん、ようこそ月灯りのティーサロンへ。ゆっくりしていってくださいね。', at: Date.now() - 55000, emotion: 'happy', sinDelta: { lust: 2, sloth: -3 } },
    { id: 'c3', role: 'viewer', text: '紅茶は好き？', viewerName: 'Kuma_77', platform: 'twitch', at: Date.now() - 30000 },
    { id: 'c4', role: 'character', text: 'いい香りのお話ですね。わたしのおすすめは、はちみつ入りのミルクティーかしら。', at: Date.now() - 25000, emotion: 'happy', sinDelta: { gluttony: 7 } },
  ]
  const snapshot = (): RuntimeSnapshot => ({
    sins: { current: { ...sins }, baseline: settings.character.baseline, updatedAt: Date.now() },
    emotion: { emotion: 'happy', intensity: 0.7 },
    speaking: false,
    ttsQueue: 0,
    agent: { phase: 'idle', provider: 'demo', turns: 2, callsLastMinute: 1 },
    health: {
      checkedAt: Date.now(),
      items: [
        { id: 'runtime', label: 'ランタイム', level: 'ok', message: 'ブラウザプレビュー' },
        { id: 'agent', label: 'AI (Cursor SDK)', level: 'ok', message: 'デモ応答モード' },
        { id: 'tts', label: '音声合成', level: 'warn', message: 'VOICEVOX に接続できません（字幕のみで続行）' },
        { id: 'memory', label: '長期記憶', level: 'ok', message: 'ローカル記憶（SQLite）' },
        { id: 'storage', label: 'ローカルDB', level: 'ok', message: 'SQLite 正常' },
        { id: 'stage', label: 'ステージ', level: 'off', message: '閉じています' },
      ],
    },
    streams: [
      { platform: 'youtube', state: 'disabled', stability: 'beta', eventCount: 0 },
      { platform: 'twitch', state: 'disabled', stability: 'stable', eventCount: 0 },
      { platform: 'kick', state: 'disabled', stability: 'beta', eventCount: 0 },
      { platform: 'tiktok', state: 'disabled', stability: 'experimental', eventCount: 0 },
    ],
    conversation,
    pending: [],
    stageOpen: false,
  })

  const reply = async (text: string, name: string) => {
    const inId = uid('in_')
    emit({ type: 'CONVERSATION_APPENDED', payload: { id: inId, role: 'viewer', text, viewerName: name, platform: 'manual', at: Date.now() } })
    emit({ type: 'AGENT_STATUS', payload: { phase: 'thinking', provider: 'demo', turns: 3, callsLastMinute: 1 } })
    const out: ConversationEntry = { id: uid('out_'), role: 'character', text: '', at: Date.now(), streaming: true }
    emit({ type: 'CONVERSATION_APPENDED', payload: { ...out } })
    const answer = `${name}さん、ありがとうございます。これはブラウザプレビュー用のお試しの返事ですよ。`
    emit({ type: 'EMOTION_CHANGED', payload: { emotion: 'happy', intensity: 0.8 } })
    emit({ type: 'TTS_STARTED', payload: { id: out.id, text: answer, emotion: 'happy' } })
    for (const ch of answer) {
      await new Promise((r) => setTimeout(r, 30))
      emit({ type: 'AGENT_DELTA', payload: { entryId: out.id, text: ch } })
      emit({ type: 'LIPSYNC_FRAME', payload: { value: Math.random() * 0.9, at: Date.now() } })
    }
    emit({ type: 'LIPSYNC_FRAME', payload: { value: 0, at: Date.now() } })
    emit({ type: 'CONVERSATION_UPDATED', payload: { ...out, text: answer, streaming: false, emotion: 'happy', sinDelta: { pride: 2 } } })
    emit({ type: 'TTS_ENDED', payload: { id: out.id, text: answer, emotion: 'happy' } })
    sins.pride = Math.min(100, sins.pride + 2)
    emit({ type: 'SIN_STATE_CHANGED', payload: { current: { ...sins }, baseline: settings.character.baseline, updatedAt: Date.now() } })
    emit({ type: 'AGENT_STATUS', payload: { phase: 'idle', provider: 'demo', turns: 3, callsLastMinute: 1 } })
  }

  return {
    settings: {
      get: async () => settings,
      update: async (patch) => {
        settings = parseSettings(mergeDeep(settings, patch))
        settingsCbs.forEach((cb) => cb(settings))
        return settings
      },
      reset: async () => {
        settings = defaultSettings()
        settingsCbs.forEach((cb) => cb(settings))
        return settings
      },
      onChange: (cb) => {
        settingsCbs.add(cb)
        return () => settingsCbs.delete(cb)
      },
    },
    secrets: {
      status: async () => secrets,
      set: async (k) => ((secrets[k] = true), secrets),
      clear: async (k) => ((secrets[k] = false), secrets),
      encryptionAvailable: async () => true,
    },
    runtime: {
      snapshot: async () => snapshot(),
      onEvent: (cb) => {
        eventCbs.add(cb)
        return () => eventCbs.delete(cb)
      },
      healthCheck: async () => snapshot().health,
    },
    agent: {
      submit: async ({ text, viewerName }) => void reply(text, viewerName || '配信者'),
      cancel: async () => {},
      listModels: async () => [
        { id: 'composer-2', name: 'Composer 2' },
        { id: 'claude-sonnet-5', name: 'Claude Sonnet 5' },
      ],
      test: async () => ({ ok: true, message: '接続OK（プレビュー）' }),
      resetSins: async () => {},
      nudgeSins: async (d) => {
        for (const [k, v] of Object.entries(d)) sins[k as keyof typeof sins] = Math.max(0, Math.min(100, sins[k as keyof typeof sins] + (v ?? 0)))
        emit({ type: 'SIN_STATE_CHANGED', payload: { current: { ...sins }, baseline: settings.character.baseline, updatedAt: Date.now() } })
      },
      clearConversation: async () => {},
    },
    tts: {
      listVoices: async () => [
        { id: '3', name: 'ずんだもん', style: 'ノーマル' },
        { id: '1', name: 'ずんだもん', style: 'あまあま' },
        { id: '2', name: '四国めたん', style: 'ノーマル' },
        { id: '8', name: '春日部つむぎ', style: 'ノーマル' },
      ],
      health: async () => ({ ok: false, provider: 'voicevox', message: 'プレビューでは接続しません' }),
      preview: async () => {},
      stop: async () => {},
    },
    stream: {
      connect: async () => {},
      disconnect: async () => {},
      injectTest: async () => {},
      clearQueue: async () => {},
      twitchDeviceLogin: async () => ({ userCode: 'ABCD-EFGH', verificationUri: 'https://www.twitch.tv/activate', expiresIn: 1800 }),
    },
    memory: {
      health: async () => ({ ok: true, provider: 'local' }),
      list: async () => [
        { id: 'm1', viewerKey: 'youtube:mochiko', viewerName: 'もちこ', kind: 'preference', content: 'ミルクティーが好き', createdAt: Date.now() - 86400000 },
        { id: 'm2', viewerKey: 'youtube:mochiko', viewerName: 'もちこ', kind: 'fact', content: '猫を2匹飼っている', createdAt: Date.now() - 3600000 },
      ],
      viewers: async () => [
        { viewerKey: 'youtube:mochiko', displayName: 'もちこ', platform: 'youtube', interactions: 12, lastSeenAt: Date.now() - 60000, memoryCount: 2 },
        { viewerKey: 'twitch:kuma', displayName: 'Kuma_77', platform: 'twitch', interactions: 4, lastSeenAt: Date.now() - 300000, memoryCount: 0 },
      ],
      remember: async () => {},
      forget: async () => {},
    },
    stage: { open: async () => {}, close: async () => {} },
    assets: { import: async () => null },
    audio: {
      onCommand: (cb) => {
        audioCbs.add(cb)
        return () => audioCbs.delete(cb)
      },
      report: () => {},
      lip: () => {},
    },
    logs: {
      recent: async () => [
        { at: Date.now(), level: 'info', category: 'app', message: 'app started (browser preview)' },
      ],
      openFolder: async () => {},
    },
    app: {
      info: async () => ({ version: '0.1.0', host: 'ブラウザプレビュー', node: '-', chrome: navigator.userAgent, platform: 'browser', userData: '-', nodeOk: true }),
      openExternal: async (url) => void window.open(url, '_blank'),
      role: /stage\.html/.test(location.pathname) ? 'stage' : 'control',
    },
  }
}
