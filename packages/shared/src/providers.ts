import type { AvatarEmotion } from './emotion'
import type { SevenSins } from './sins'
import type { StreamViewer } from './stream'

/* ---------------- TTS ---------------- */

export interface TTSHealth {
  ok: boolean
  provider: string
  version?: string
  message?: string
}

export interface TTSVoice {
  id: string
  name: string
  style?: string
}

export interface TTSRequest {
  text: string
  voiceId?: string
  speed?: number
  pitch?: number
  intonation?: number
  volume?: number
  emotion?: AvatarEmotion
}

export interface TTSAudioResult {
  /** 音声バイナリ。system TTSの場合は空 */
  audio: Uint8Array
  mimeType: string
}

export interface TTSAudioChunk {
  audio: Uint8Array
  mimeType: string
  final: boolean
}

export interface TTSProvider {
  readonly id: string
  health(): Promise<TTSHealth>
  listVoices(): Promise<TTSVoice[]>
  synthesize(request: TTSRequest): Promise<TTSAudioResult>
  synthesizeStream?(request: TTSRequest): AsyncIterable<TTSAudioChunk>
}

/* ---------------- Memory ---------------- */

export interface MemoryHealth {
  ok: boolean
  provider: string
  message?: string
}

export interface MemoryItem {
  id: string
  viewerKey?: string
  viewerName?: string
  kind: 'fact' | 'event' | 'preference' | 'relationship' | 'topic' | 'note'
  content: string
  createdAt: number
  score?: number
}

export interface RecallInput {
  viewer?: StreamViewer
  query: string
  limit?: number
}

export interface MemoryContext {
  items: MemoryItem[]
  /** プロバイダ側で要約済みのテキストがあれば */
  summary?: string
}

export interface MemoryIngestInput {
  viewer?: StreamViewer
  sessionId: string
  messages: { role: 'user' | 'assistant'; content: string; timestamp: number }[]
}

export interface ExplicitMemoryInput {
  viewer?: StreamViewer
  kind: MemoryItem['kind']
  content: string
}

export interface MemoryProvider {
  readonly id: string
  health(): Promise<MemoryHealth>
  recall(input: RecallInput): Promise<MemoryContext>
  ingest(input: MemoryIngestInput): Promise<void>
  remember?(input: ExplicitMemoryInput): Promise<void>
  list?(viewerKey?: string, limit?: number): Promise<MemoryItem[]>
  forget?(id: string): Promise<void>
}

/* ---------------- Avatar ---------------- */

export interface AvatarTransform {
  x: number
  y: number
  scale: number
}

export interface AvatarSource {
  kind: string
  /** amctk-asset:// のベースURL */
  baseUrl?: string
  files: Record<string, string>
  options?: Record<string, unknown>
}

export interface AvatarMotion {
  bounce: number
  sway: number
  blinkPerMinute: number
  breath: number
}

export interface AvatarFrameContext {
  sins: SevenSins
  speaking: boolean
  motion: AvatarMotion
}

export interface AvatarAdapter {
  readonly kind: string
  load(source: AvatarSource): Promise<void>
  setTransform(transform: AvatarTransform): void
  setExpression(emotion: AvatarEmotion, intensity?: number): void
  setLip(value: number): void
  setContext?(ctx: AvatarFrameContext): void
  update(deltaMs: number): void
  resize(width: number, height: number): void
  dispose(): Promise<void>
}
