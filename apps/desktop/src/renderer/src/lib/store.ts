import { useCallback, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import {
  mergeDeep,
  type AppEvent,
  type AppSettings,
  type DeepPartial,
  type LogEntry,
  type RuntimeSnapshot,
  type SecretStatus,
} from '@amctk/shared'
import { api } from './api'
import { lipBus } from './lip'

export interface ClientState {
  runtime: RuntimeSnapshot | null
  settings: AppSettings | null
  secrets: SecretStatus | null
  logs: LogEntry[]
  events: { at: number; type: string; summary: string }[]
}

let state: ClientState = { runtime: null, settings: null, secrets: null, logs: [], events: [] }
const listeners = new Set<() => void>()

function set(next: Partial<ClientState>) {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

function patchRuntime(fn: (r: RuntimeSnapshot) => Partial<RuntimeSnapshot>) {
  if (!state.runtime) return
  set({ runtime: { ...state.runtime, ...fn(state.runtime) } })
}

function summarize(e: AppEvent): string {
  switch (e.type) {
    case 'STREAM_EVENT':
      return `${e.payload.platform} ${e.payload.viewer.displayName}: ${e.payload.text.slice(0, 40)}`
    case 'INTERACTION_SELECTED':
      return `${e.payload.primary.viewer.displayName} (${e.payload.reason})`
    case 'AGENT_COMPLETE':
      return `${e.payload.provider} ${e.payload.durationMs}ms ${JSON.stringify(e.payload.sinDelta)}`
    case 'EMOTION_CHANGED':
      return `${e.payload.emotion} ${e.payload.intensity.toFixed(2)}`
    case 'TTS_STARTED':
    case 'TTS_ENDED':
      return e.payload.text.slice(0, 40)
    case 'AGENT_STATUS':
      return `${e.payload.phase}${e.payload.message ? ` ${e.payload.message}` : ''}`
    default:
      return ''
  }
}

function onEvent(e: AppEvent) {
  if (e.type === 'LIPSYNC_FRAME') {
    lipBus.set(e.payload.value)
    return
  }
  if (e.type !== 'AGENT_DELTA' && e.type !== 'LOG') {
    const events = [...state.events, { at: Date.now(), type: e.type, summary: summarize(e) }]
    if (events.length > 200) events.shift()
    state = { ...state, events }
  }
  switch (e.type) {
    case 'SIN_STATE_CHANGED':
      return patchRuntime(() => ({ sins: e.payload }))
    case 'EMOTION_CHANGED':
      return patchRuntime(() => ({ emotion: e.payload }))
    case 'AGENT_STATUS':
      return patchRuntime(() => ({ agent: e.payload }))
    case 'CONVERSATION_APPENDED':
      return patchRuntime((r) => ({ conversation: [...r.conversation, e.payload].slice(-150) }))
    case 'CONVERSATION_UPDATED':
      return patchRuntime((r) => ({ conversation: r.conversation.map((c) => (c.id === e.payload.id ? e.payload : c)) }))
    case 'AGENT_DELTA':
      return patchRuntime((r) => ({
        conversation: r.conversation.map((c) => (c.id === e.payload.entryId ? { ...c, text: c.text + e.payload.text } : c)),
      }))
    case 'PENDING_CHANGED':
      return patchRuntime(() => ({ pending: e.payload }))
    case 'STREAM_HEALTH':
      return patchRuntime(() => ({ streams: e.payload }))
    case 'HEALTH_CHANGED':
      return patchRuntime(() => ({ health: e.payload }))
    case 'STAGE_STATE':
      return patchRuntime(() => ({ stageOpen: e.payload.open }))
    case 'TTS_STARTED':
      return patchRuntime(() => ({ speaking: true, utterance: e.payload }))
    case 'TTS_ENDED':
      return patchRuntime((r) => (r.utterance?.id === e.payload.id ? { speaking: false } : {}))
    case 'TTS_QUEUE':
      return patchRuntime(() => ({ ttsQueue: e.payload.length }))
    case 'LOG': {
      const logs = [...state.logs, e.payload].slice(-400)
      set({ logs })
      if (e.payload.data?.toast && api.app.role === 'control') {
        if (e.payload.level === 'info') toast.success(e.payload.message)
        else toast.error(e.payload.message)
      }
      return
    }
    default:
      listeners.forEach((l) => l())
  }
}

let started = false
export function startStore() {
  if (started) return
  started = true
  api.runtime.onEvent(onEvent)
  api.settings.onChange((settings) => set({ settings }))
  void Promise.all([api.runtime.snapshot(), api.settings.get(), api.secrets.status(), api.logs.recent()]).then(
    ([runtime, settings, secrets, logs]) => set({ runtime, settings, secrets, logs }),
  )
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useStore<T>(selector: (s: ClientState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state))
}

export function getState() {
  return state
}

/** 設定の取得と更新。更新は即座に画面へ反映し、Mainで検証された値で上書きする */
export function useSettings(): [AppSettings | null, (patch: DeepPartial<AppSettings>) => void] {
  const settings = useStore((s) => s.settings)
  const update = useCallback((patch: DeepPartial<AppSettings>) => {
    if (state.settings) set({ settings: mergeDeep(state.settings, patch) })
    void api.settings
      .update(patch)
      .then((s) => set({ settings: s }))
      .catch((err) => toast.error(`設定を保存できませんでした: ${err instanceof Error ? err.message : err}`))
  }, [])
  return [settings, update]
}

export function setSecrets(secrets: SecretStatus) {
  set({ secrets })
}

export function useRuntime<T>(selector: (r: RuntimeSnapshot) => T, fallback: T): T {
  return useStore((s) => (s.runtime ? selector(s.runtime) : fallback))
}
