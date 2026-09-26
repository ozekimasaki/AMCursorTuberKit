export const STREAM_PLATFORMS = ['manual', 'youtube', 'twitch', 'kick', 'tiktok'] as const
export type StreamPlatform = (typeof STREAM_PLATFORMS)[number]

export type StreamEventKind =
  | 'chat'
  | 'superchat'
  | 'cheer'
  | 'subscribe'
  | 'gift'
  | 'follow'
  | 'raid'
  | 'system'

export interface StreamViewer {
  platform: StreamPlatform
  platformUserId: string
  displayName: string
  isModerator?: boolean
  isMember?: boolean
  isOwner?: boolean
}

export interface StreamEvent {
  /** プラットフォーム内で一意なID（重複排除に利用） */
  id: string
  platform: StreamPlatform
  kind: StreamEventKind
  viewer: StreamViewer
  text: string
  amount?: { value: number; currency: string; display?: string }
  receivedAt: number
}

export interface SelectedInteraction {
  id: string
  primary: StreamEvent
  /** 同時に拾った関連コメント（コンテキスト用、最大数件） */
  related: StreamEvent[]
  score: number
  reason: string
  selectedAt: number
}

export type StreamConnectionState = 'disabled' | 'disconnected' | 'connecting' | 'connected' | 'degraded' | 'error'

export interface StreamSourceHealth {
  platform: StreamPlatform
  state: StreamConnectionState
  message?: string
  /** 'stable' | 'beta' | 'experimental' */
  stability: 'stable' | 'beta' | 'experimental'
  lastEventAt?: number
  eventCount: number
}

export interface StreamSourceAdapter {
  readonly platform: StreamPlatform
  connect(): Promise<void>
  disconnect(): Promise<void>
  health(): StreamSourceHealth
  events(): AsyncIterable<StreamEvent>
}
