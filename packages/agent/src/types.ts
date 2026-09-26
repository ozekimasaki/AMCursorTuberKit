import type {
  AvatarEmotion,
  MemoryContext,
  ModelOption,
  SelectedInteraction,
  SevenSins,
} from '@amctk/shared'

/** Custom Tool から参照・提案される値。Engine側で検証してから適用する */
export interface ToolBridge {
  getCharacterState(): unknown
  getViewerContext(viewerName?: string): Promise<unknown>
  proposeSinDelta(delta: unknown): void
  setEmotion(emotion: AvatarEmotion, intensity?: number): void
}

export interface AgentRunHandlers {
  onText(delta: string): void
  signal?: AbortSignal
  /** デモAgentなど、構造化された入力を使う実装向け */
  context?: TurnContext
}

export interface TurnContext {
  interaction: SelectedInteraction
  memory: MemoryContext | null
  sins: SevenSins
  characterName: string
  firstPerson: string
}

export interface AgentRunResult {
  text: string
  durationMs: number
}

export interface AgentHealth {
  ok: boolean
  message: string
}

export interface CharacterAgent {
  readonly id: 'cursor' | 'demo'
  health(): Promise<AgentHealth>
  run(prompt: string, handlers: AgentRunHandlers): Promise<AgentRunResult>
  listModels(): Promise<ModelOption[]>
  dispose(): Promise<void>
}
