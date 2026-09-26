# AMCursorTuberKit 実装技術計画書

## 1. 技術原則

```text
Local First
Provider Oriented
Failure Isolated
Streaming First
Low Cost
Agent Safe
```

## 2. Application Stack

### Desktop

- Electron
- React
- TypeScript
- Vite / electron-vite系構成
- Node.js 22.13+相当を必須条件としてRuntime Check

Cursor SDKのLocal Runtime要件に合わせる。

### UI

- shadcn/ui
- Tailwind CSS v4
- CSS VariablesによるTheme Token
- @shadcn/lint
- ESLint v9系を基本
- Prettier

### Validation

- Zod

### Testing

- Vitest
- Playwright / Electron E2E

### Package Manager

- pnpm workspace

## 3. Monorepo構成

```text
AMCursorTuberKit/
├ apps/
│  └ desktop/
│
├ workers/
│  └ stream-relay/        # Kick webhook relay等。必要時のみdeploy
│
├ packages/
│  ├ core/
│  ├ agent/
│  ├ personality/
│  ├ memory/
│  ├ stream-core/
│  ├ stream-youtube/
│  ├ stream-twitch/
│  ├ stream-kick/
│  ├ stream-tiktok/
│  ├ audio/
│  ├ avatar-core/
│  ├ avatar-png/
│  ├ avatar-motion-png/
│  ├ avatar-purupuru/
│  ├ avatar-vrm/
│  ├ avatar-live2d/
│  ├ ui/
│  └ shared/
│
└ docs/
```

## 4. Electron Process境界

```text
Main Process
├ AgentService
├ MemoryService
├ StreamSourceService
├ SecretService
├ SettingsService
└ IPC Router

Renderer: Control Window
├ React
├ shadcn/ui
└ User Interaction

Renderer: Stage Window
├ Avatar Renderer
├ Background
├ Subtitle
└ Optional HUD
```

Stage RendererはControl UIの依存を極力持たない。

## 5. Canonical State

状態を3種類に分離する。

### Persistent Config

- Avatar選択
- Stage Transform
- TTS設定
- Stream Source設定
- Personality baseline

### Runtime State

- Seven Sins current
- Current emotion
- TTS queue
- Current speaking state
- Connected platforms

### Long-Term Memory

- Viewer memories
- Events
- Preferences
- Relationship-relevant context

## 6. Storage

### Settings

JSONまたは軽量Key-Value Store。

### Runtime / Event Log

SQLite。

Cursor SDK自身のLocal Agent Storeとはアプリデータを論理的に分離する。

### Tables案

```text
characters
character_state
sin_delta_events
viewer_identities
viewer_links
stream_events
selected_interactions
conversations
tts_history
app_settings
```

Memory本文はMemoryProvider側へ委譲可能。

## 7. Provider Interface

### Avatar

```ts
interface AvatarAdapter {
  load(source: AvatarSource): Promise<void>
  setTransform(transform: AvatarTransform): void
  setExpression(emotion: AvatarEmotion, intensity?: number): void
  setLip(value: number): void
  update(deltaMs: number): void
  resize(width: number, height: number): void
  dispose(): Promise<void>
}
```

### TTS

```ts
interface TTSProvider {
  health(): Promise<TTSHealth>
  listVoices(): Promise<TTSVoice[]>
  synthesize(request: TTSRequest): Promise<TTSAudioResult>
  synthesizeStream?(request: TTSRequest): AsyncIterable<TTSAudioChunk>
}
```

### Memory

```ts
interface MemoryProvider {
  health(): Promise<MemoryHealth>
  recall(input: RecallInput): Promise<MemoryContext>
  ingest(input: MemoryIngestInput): Promise<void>
  remember?(input: ExplicitMemoryInput): Promise<void>
}
```

### Stream Source

```ts
interface StreamSourceAdapter {
  platform: StreamPlatform
  connect(config: StreamSourceConfig): Promise<void>
  disconnect(): Promise<void>
  health(): StreamSourceHealth
  events(): AsyncIterable<StreamEvent>
}
```

## 8. Cursor SDK Agent

Local Agentを使用する。

重要な安全方針:

- Shellを公開しない
- File edit/writeを公開しない
- 一般Web Toolを公開しない
- AMCursorTuberKit用Custom Toolだけを利用
- Tool設定はresume時も再適用

想定Custom Tools:

```text
get_character_state
get_viewer_context
propose_sin_delta
set_emotion
```

`propose_sin_delta` はLLMが直接Stateを書き換えるのではなく、提案値を返すだけにする。

Engine側でValidation/Clamp後に適用する。

## 9. Agent Output Pipeline

```text
SelectedInteraction
 + ViewerMemory
 + CharacterState
 + RecentContext
        ↓
Cursor Agent
        ↓
Streaming Text
 + Proposed Sin Delta
 + Emotion
        ↓
Sentence Segmenter
        ↓
TTS Queue
```

## 10. Event Bus

主要イベント例:

```ts
type AppEvent =
  | { type: 'STREAM_EVENT'; payload: StreamEvent }
  | { type: 'INTERACTION_SELECTED'; payload: SelectedInteraction }
  | { type: 'AGENT_DELTA'; payload: AgentTextDelta }
  | { type: 'AGENT_COMPLETE'; payload: AgentResult }
  | { type: 'SIN_STATE_CHANGED'; payload: SevenSinsState }
  | { type: 'EMOTION_CHANGED'; payload: AvatarEmotion }
  | { type: 'TTS_STARTED'; payload: TTSPlaybackInfo }
  | { type: 'TTS_ENDED'; payload: TTSPlaybackInfo }
  | { type: 'LIPSYNC_FRAME'; payload: LipSyncFrame }
  | { type: 'MEMORY_UPDATED'; payload: MemoryUpdateInfo }
```

## 11. Security Boundary

Rendererに以下を直接渡さない。

- Cursor API Key
- Cloudflare API Token
- Twitch Refresh Token
- YouTube OAuth Refresh Token
- Kick OAuth Token

Electron Main側のSecretServiceが保持する。

OS暗号化ストレージを利用し、ログへTokenを出さない。

## 12. Failure Isolation

以下は独立して落ちるようにする。

```text
Memory Failure     -> Memoryなしで会話続行
TTS Failure        -> Text表示のみ
Avatar Failure     -> Audio/AIは継続
Platform Failure   -> 他Platformは継続
Cloud Relay Failure-> KickのみDegraded
```

## 13. Logging

構造化ログを採用。

```text
app
agent
memory
stream.youtube
stream.twitch
stream.kick
stream.tiktok
tts
avatar
stage
```

個人情報・Token・全文Memoryの常時ログは避ける。
