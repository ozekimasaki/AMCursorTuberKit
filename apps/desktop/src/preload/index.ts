import { contextBridge, ipcRenderer } from 'electron'
import type { AmctkApi, AppEvent, AppSettings, AudioCommand } from '@amctk/shared'

const invoke = <T>(channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<T>

function subscribe<T>(channel: string, cb: (payload: T) => void) {
  const listener = (_e: Electron.IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const role: 'control' | 'stage' = /stage\.html/.test(location.pathname) ? 'stage' : 'control'

/**
 * Renderer に渡すのは型付きAPIだけ。Token類は一切返さない（status は真偽値のみ）。
 */
const api: AmctkApi = {
  settings: {
    get: () => invoke('settings:get'),
    update: (patch) => invoke('settings:update', patch),
    reset: (section) => invoke('settings:reset', section),
    onChange: (cb) => subscribe<AppSettings>('amctk:settings', cb),
  },
  secrets: {
    status: () => invoke('secrets:status'),
    set: (key, value) => invoke('secrets:set', key, value),
    clear: (key) => invoke('secrets:clear', key),
    encryptionAvailable: () => invoke('secrets:encryptionAvailable'),
  },
  runtime: {
    snapshot: () => invoke('runtime:snapshot'),
    onEvent: (cb) => subscribe<AppEvent>('amctk:event', cb),
    healthCheck: () => invoke('runtime:healthCheck'),
  },
  agent: {
    submit: (input) => invoke('agent:submit', input),
    cancel: () => invoke('agent:cancel'),
    listModels: () => invoke('agent:listModels'),
    test: () => invoke('agent:test'),
    resetSins: () => invoke('agent:resetSins'),
    nudgeSins: (delta) => invoke('agent:nudgeSins', delta),
    clearConversation: () => invoke('agent:clearConversation'),
  },
  tts: {
    listVoices: (provider) => invoke('tts:listVoices', provider),
    health: (provider) => invoke('tts:health', provider),
    preview: (text) => invoke('tts:preview', text),
    stop: () => invoke('tts:stop'),
  },
  stream: {
    connect: (p) => invoke('stream:connect', p),
    disconnect: (p) => invoke('stream:disconnect', p),
    injectTest: (count) => invoke('stream:injectTest', count),
    clearQueue: () => invoke('stream:clearQueue'),
    twitchDeviceLogin: () => invoke('stream:twitchDeviceLogin'),
  },
  memory: {
    health: () => invoke('memory:health'),
    list: (viewerKey) => invoke('memory:list', viewerKey),
    viewers: () => invoke('memory:viewers'),
    remember: (input) => invoke('memory:remember', input),
    forget: (id) => invoke('memory:forget', id),
  },
  stage: {
    open: () => invoke('stage:open'),
    close: () => invoke('stage:close'),
  },
  assets: {
    import: (kind, options) => invoke('assets:import', kind, options),
  },
  audio: {
    onCommand: (cb) => {
      const off = subscribe<AudioCommand>('amctk:audio', cb)
      // 音声プレイヤーが購読を始めてから「再生可能」を通知する
      ipcRenderer.send('renderer:ready')
      return off
    },
    report: (e) => ipcRenderer.send('audio:report', e),
    lip: (value) => ipcRenderer.send('audio:lip', value),
  },
  logs: {
    recent: () => invoke('logs:recent'),
    openFolder: () => invoke('logs:openFolder'),
  },
  app: {
    info: () => invoke('app:info'),
    openExternal: (url) => invoke('app:openExternal', url),
    role,
  },
}

contextBridge.exposeInMainWorld('amctk', api)
