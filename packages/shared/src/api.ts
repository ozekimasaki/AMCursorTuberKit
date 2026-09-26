import type { AppSettings, DeepPartial, TTSProviderId } from './settings'
import type { SecretKey, SecretStatus } from './secrets'
import type { AppEvent, AudioCommand, HealthReport, LogEntry, RuntimeSnapshot } from './runtime'
import type { ExplicitMemoryInput, MemoryHealth, MemoryItem, TTSHealth, TTSVoice } from './providers'
import type { StreamPlatform } from './stream'
import type { SinDelta } from './sins'

export type Unsubscribe = () => void

export type AssetImportKind = 'png-slot' | 'motion-png' | 'purupuru' | 'vrm' | 'live2d' | 'live2d-core'

export interface ImportedAsset {
  assetId: string
  files: string[]
  /** 推定された役割 -> ファイル名 */
  detected: Record<string, string>
}

export interface ViewerSummary {
  viewerKey: string
  displayName: string
  platform: StreamPlatform
  interactions: number
  lastSeenAt: number
  memoryCount: number
}

export interface TwitchDeviceLogin {
  userCode: string
  verificationUri: string
  expiresIn: number
}

export interface ModelOption {
  id: string
  name: string
}

export interface AppInfo {
  version: string
  /** デスクトップ基盤の名前とバージョン（例: Electron 44.4.5） */
  host: string
  node: string
  chrome: string
  platform: string
  userData: string
  nodeOk: boolean
}

export interface AmctkApi {
  settings: {
    get(): Promise<AppSettings>
    update(patch: DeepPartial<AppSettings>): Promise<AppSettings>
    reset(section?: keyof AppSettings): Promise<AppSettings>
    onChange(cb: (s: AppSettings) => void): Unsubscribe
  }
  secrets: {
    status(): Promise<SecretStatus>
    set(key: SecretKey, value: string): Promise<SecretStatus>
    clear(key: SecretKey): Promise<SecretStatus>
    encryptionAvailable(): Promise<boolean>
  }
  runtime: {
    snapshot(): Promise<RuntimeSnapshot>
    onEvent(cb: (e: AppEvent) => void): Unsubscribe
    healthCheck(): Promise<HealthReport>
  }
  agent: {
    submit(input: { text: string; viewerName?: string; direct?: boolean }): Promise<void>
    cancel(): Promise<void>
    listModels(): Promise<ModelOption[]>
    test(): Promise<{ ok: boolean; message: string }>
    resetSins(): Promise<void>
    nudgeSins(delta: SinDelta): Promise<void>
    clearConversation(): Promise<void>
  }
  tts: {
    listVoices(provider?: TTSProviderId): Promise<TTSVoice[]>
    health(provider?: TTSProviderId): Promise<TTSHealth>
    preview(text: string): Promise<void>
    stop(): Promise<void>
  }
  stream: {
    connect(platform: StreamPlatform): Promise<void>
    disconnect(platform: StreamPlatform): Promise<void>
    injectTest(count: number): Promise<void>
    clearQueue(): Promise<void>
    twitchDeviceLogin(): Promise<TwitchDeviceLogin>
  }
  memory: {
    health(): Promise<MemoryHealth>
    list(viewerKey?: string): Promise<MemoryItem[]>
    viewers(): Promise<ViewerSummary[]>
    remember(input: ExplicitMemoryInput & { viewerKey?: string }): Promise<void>
    forget(id: string): Promise<void>
  }
  stage: {
    open(): Promise<void>
    close(): Promise<void>
  }
  assets: {
    import(kind: AssetImportKind, options?: { assetId?: string; slot?: string }): Promise<ImportedAsset | null>
  }
  audio: {
    onCommand(cb: (cmd: AudioCommand) => void): Unsubscribe
    report(e: { type: 'started' | 'ended' | 'error'; id: string; message?: string }): void
    lip(value: number): void
  }
  logs: {
    recent(): Promise<LogEntry[]>
    openFolder(): Promise<void>
  }
  app: {
    info(): Promise<AppInfo>
    openExternal(url: string): Promise<void>
    role: 'control' | 'stage'
  }
}
