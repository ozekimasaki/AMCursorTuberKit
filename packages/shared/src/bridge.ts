import type { AmctkApi } from './api'
import type { AppEvent, AudioCommand } from './runtime'
import type { AppSettings } from './settings'

/*
 * Renderer ↔ Main の通信の取り決め。デスクトップ基盤（Electron など）には依存しない。
 * Main はこの表のチャンネルにハンドラを登録し、Renderer 側は createAmctkApi で window.amctk を組み立てる。
 * 基盤を変えるときは BridgeTransport（送受信の手段）だけを差し替える。
 * preload から読み込まれるため、このファイルでは型以外を import しない（zod などをバンドルに入れない）。
 */

/** Renderer → Main の呼び出し（応答あり） */
export const INVOKE = {
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsReset: 'settings:reset',
  secretsStatus: 'secrets:status',
  secretsSet: 'secrets:set',
  secretsClear: 'secrets:clear',
  secretsEncryptionAvailable: 'secrets:encryptionAvailable',
  runtimeSnapshot: 'runtime:snapshot',
  runtimeHealthCheck: 'runtime:healthCheck',
  agentSubmit: 'agent:submit',
  agentCancel: 'agent:cancel',
  agentListModels: 'agent:listModels',
  agentTest: 'agent:test',
  agentResetSins: 'agent:resetSins',
  agentNudgeSins: 'agent:nudgeSins',
  agentClearConversation: 'agent:clearConversation',
  ttsListVoices: 'tts:listVoices',
  ttsHealth: 'tts:health',
  ttsPreview: 'tts:preview',
  ttsStop: 'tts:stop',
  streamConnect: 'stream:connect',
  streamDisconnect: 'stream:disconnect',
  streamInjectTest: 'stream:injectTest',
  streamClearQueue: 'stream:clearQueue',
  streamTwitchDeviceLogin: 'stream:twitchDeviceLogin',
  memoryHealth: 'memory:health',
  memoryList: 'memory:list',
  memoryViewers: 'memory:viewers',
  memoryRemember: 'memory:remember',
  memoryForget: 'memory:forget',
  stageOpen: 'stage:open',
  stageClose: 'stage:close',
  assetsImport: 'assets:import',
  logsRecent: 'logs:recent',
  logsOpenFolder: 'logs:openFolder',
  appInfo: 'app:info',
  appOpenExternal: 'app:openExternal',
} as const

/** Renderer → Main の一方向メッセージ */
export const SEND = {
  audioReport: 'audio:report',
  audioLip: 'audio:lip',
  rendererReady: 'renderer:ready',
} as const

/** Main → Renderer の通知 */
export const PUSH = {
  settings: 'amctk:settings',
  event: 'amctk:event',
  audio: 'amctk:audio',
} as const

export type InvokeKey = keyof typeof INVOKE

/** 基盤ごとの送受信の手段（Electron では ipcRenderer） */
export interface BridgeTransport {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  send(channel: string, ...args: unknown[]): void
  subscribe(channel: string, cb: (payload: unknown) => void): () => void
}

/** Renderer に渡すのは型付きAPIだけ。Token類は一切返さない（secrets.status は真偽値のみ） */
export function createAmctkApi(t: BridgeTransport, role: AmctkApi['app']['role']): AmctkApi {
  const call = <T>(channel: string, ...args: unknown[]) => t.invoke(channel, ...args) as Promise<T>
  const on = <T>(channel: string, cb: (payload: T) => void) => t.subscribe(channel, (p) => cb(p as T))
  return {
    settings: {
      get: () => call(INVOKE.settingsGet),
      update: (patch) => call(INVOKE.settingsUpdate, patch),
      reset: (section) => call(INVOKE.settingsReset, section),
      onChange: (cb) => on<AppSettings>(PUSH.settings, cb),
    },
    secrets: {
      status: () => call(INVOKE.secretsStatus),
      set: (key, value) => call(INVOKE.secretsSet, key, value),
      clear: (key) => call(INVOKE.secretsClear, key),
      encryptionAvailable: () => call(INVOKE.secretsEncryptionAvailable),
    },
    runtime: {
      snapshot: () => call(INVOKE.runtimeSnapshot),
      onEvent: (cb) => on<AppEvent>(PUSH.event, cb),
      healthCheck: () => call(INVOKE.runtimeHealthCheck),
    },
    agent: {
      submit: (input) => call(INVOKE.agentSubmit, input),
      cancel: () => call(INVOKE.agentCancel),
      listModels: () => call(INVOKE.agentListModels),
      test: () => call(INVOKE.agentTest),
      resetSins: () => call(INVOKE.agentResetSins),
      nudgeSins: (delta) => call(INVOKE.agentNudgeSins, delta),
      clearConversation: () => call(INVOKE.agentClearConversation),
    },
    tts: {
      listVoices: (provider) => call(INVOKE.ttsListVoices, provider),
      health: (provider) => call(INVOKE.ttsHealth, provider),
      preview: (text) => call(INVOKE.ttsPreview, text),
      stop: () => call(INVOKE.ttsStop),
    },
    stream: {
      connect: (p) => call(INVOKE.streamConnect, p),
      disconnect: (p) => call(INVOKE.streamDisconnect, p),
      injectTest: (count) => call(INVOKE.streamInjectTest, count),
      clearQueue: () => call(INVOKE.streamClearQueue),
      twitchDeviceLogin: () => call(INVOKE.streamTwitchDeviceLogin),
    },
    memory: {
      health: () => call(INVOKE.memoryHealth),
      list: (viewerKey) => call(INVOKE.memoryList, viewerKey),
      viewers: () => call(INVOKE.memoryViewers),
      remember: (input) => call(INVOKE.memoryRemember, input),
      forget: (id) => call(INVOKE.memoryForget, id),
    },
    stage: {
      open: () => call(INVOKE.stageOpen),
      close: () => call(INVOKE.stageClose),
    },
    assets: {
      import: (kind, options) => call(INVOKE.assetsImport, kind, options),
    },
    audio: {
      onCommand: (cb) => {
        const off = on<AudioCommand>(PUSH.audio, cb)
        // 音声プレイヤーが購読を始めてから「再生可能」を通知する
        t.send(SEND.rendererReady)
        return off
      },
      report: (e) => t.send(SEND.audioReport, e),
      lip: (value) => t.send(SEND.audioLip, value),
    },
    logs: {
      recent: () => call(INVOKE.logsRecent),
      openFolder: () => call(INVOKE.logsOpenFolder),
    },
    app: {
      info: () => call(INVOKE.appInfo),
      openExternal: (url) => call(INVOKE.appOpenExternal, url),
      role,
    },
  }
}
