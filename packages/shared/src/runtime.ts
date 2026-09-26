import type { AvatarEmotion, EmotionState } from './emotion'
import type { SevenSins, SinDelta } from './sins'
import type { SelectedInteraction, StreamEvent, StreamPlatform, StreamSourceHealth } from './stream'

export type HealthLevel = 'ok' | 'warn' | 'error' | 'off'

export interface HealthItem {
  id: 'runtime' | 'agent' | 'tts' | 'memory' | 'storage' | 'stage'
  label: string
  level: HealthLevel
  message: string
}

export interface HealthReport {
  checkedAt: number
  items: HealthItem[]
}

export type AgentPhase = 'idle' | 'recalling' | 'thinking' | 'speaking' | 'error'

export interface AgentStatus {
  phase: AgentPhase
  provider: 'cursor' | 'demo'
  message?: string
  turns: number
  callsLastMinute: number
}

export interface ConversationEntry {
  id: string
  role: 'viewer' | 'character' | 'system'
  text: string
  viewerName?: string
  platform?: StreamPlatform
  at: number
  emotion?: AvatarEmotion
  sinDelta?: SinDelta
  streaming?: boolean
  /** 返答の元になった SelectedInteraction */
  interactionId?: string
}

export interface SinStateSnapshot {
  current: SevenSins
  baseline: SevenSins
  updatedAt: number
}

export interface Utterance {
  id: string
  text: string
  emotion: AvatarEmotion
}

export interface RuntimeSnapshot {
  sins: SinStateSnapshot
  emotion: EmotionState
  speaking: boolean
  utterance?: Utterance
  ttsQueue: number
  agent: AgentStatus
  health: HealthReport
  streams: StreamSourceHealth[]
  conversation: ConversationEntry[]
  pending: StreamEvent[]
  stageOpen: boolean
}

export interface LipSyncFrame {
  value: number
  at: number
}

export interface TTSPlaybackInfo {
  id: string
  text: string
  emotion: AvatarEmotion
}

export interface AgentTextDelta {
  entryId: string
  text: string
}

export interface AgentResult {
  entryId: string
  text: string
  emotion: AvatarEmotion
  sinDelta: SinDelta
  durationMs: number
  provider: 'cursor' | 'demo'
}

export interface MemoryUpdateInfo {
  viewerKey?: string
  count: number
}

export interface LogEntry {
  at: number
  level: 'debug' | 'info' | 'warn' | 'error'
  category: string
  message: string
  data?: Record<string, unknown>
}

export type AppEvent =
  | { type: 'STREAM_EVENT'; payload: StreamEvent }
  | { type: 'INTERACTION_SELECTED'; payload: SelectedInteraction }
  | { type: 'AGENT_DELTA'; payload: AgentTextDelta }
  | { type: 'AGENT_COMPLETE'; payload: AgentResult }
  | { type: 'AGENT_STATUS'; payload: AgentStatus }
  | { type: 'SIN_STATE_CHANGED'; payload: SinStateSnapshot }
  | { type: 'EMOTION_CHANGED'; payload: EmotionState }
  | { type: 'TTS_STARTED'; payload: TTSPlaybackInfo }
  | { type: 'TTS_ENDED'; payload: TTSPlaybackInfo }
  | { type: 'TTS_QUEUE'; payload: { length: number } }
  | { type: 'LIPSYNC_FRAME'; payload: LipSyncFrame }
  | { type: 'MEMORY_UPDATED'; payload: MemoryUpdateInfo }
  | { type: 'CONVERSATION_APPENDED'; payload: ConversationEntry }
  | { type: 'CONVERSATION_UPDATED'; payload: ConversationEntry }
  | { type: 'PENDING_CHANGED'; payload: StreamEvent[] }
  | { type: 'STREAM_HEALTH'; payload: StreamSourceHealth[] }
  | { type: 'HEALTH_CHANGED'; payload: HealthReport }
  | { type: 'STAGE_STATE'; payload: { open: boolean } }
  | { type: 'LOG'; payload: LogEntry }

export type AppEventType = AppEvent['type']
export type AppEventOf<T extends AppEventType> = Extract<AppEvent, { type: T }>

/** Main → 音声再生ウィンドウへの命令 */
export type AudioCommand =
  | {
      type: 'play'
      id: string
      text: string
      emotion: AvatarEmotion
      audio?: Uint8Array
      mimeType?: string
      /** system TTS 用 */
      speech?: { rate: number; pitch: number; volume: number; voiceName?: string }
    }
  | { type: 'stop' }
