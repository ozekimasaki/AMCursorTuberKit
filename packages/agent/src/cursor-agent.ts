import type { ModelOption } from '@amctk/shared'
import { createCharacterTools, type CustomToolDef } from './tools'
import type { AgentHealth, AgentRunHandlers, AgentRunResult, CharacterAgent, ToolBridge } from './types'

type SdkModule = typeof import('@cursor/sdk')
type SdkAgent = Awaited<ReturnType<SdkModule['Agent']['create']>>
type LocalAgentStore = import('@cursor/sdk').LocalAgentStore
type Log = (level: 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown>) => void

export interface CursorAgentOptions {
  apiKey: string
  modelId: string
  /** Local Agent の作業ディレクトリ。アプリ専用の空ディレクトリを渡す */
  workspaceDir: string
  /** SDK の Local Agent Store を置くフォルダ（アプリ専用。アプリ本体のDBとは分ける） */
  storeDir: string
  rotateAfterTurns: number
  /** Web検索・Webページ取得を許可する */
  webTools: boolean
  bridge: ToolBridge
  log?: Log
}

/**
 * Agent に渡す組み込みツールの許可リスト。
 * - `mcp`：AMCursorTuberKit の Custom Tool（customTools）を使うために必要
 * - `webSearch` / `webFetch`：設定でオンのときだけ許可
 * シェル・ファイル操作は許可リストに入れない。
 * settingSources: [] でユーザー環境の MCP 設定やルールも読み込ませない。
 */
export function allowedBuiltinTools(options: { web: boolean }): string[] {
  return options.web ? ['mcp', 'webSearch', 'webFetch'] : ['mcp']
}

/** 許可リストの設定ミスがあっても使えないよう、明示的に外すツール */
export const DENIED_BUILTIN_TOOLS = ['shell', 'edit', 'delete', 'read', 'grep', 'glob', 'ls', 'task', 'applyAgentDiff', 'semSearch'] as const

let sdkPromise: Promise<SdkModule> | null = null
function loadSdk(): Promise<SdkModule> {
  sdkPromise ??= import('@cursor/sdk')
  return sdkPromise
}

const storeCache = new Map<string, Promise<LocalAgentStore>>()

/**
 * SDK の Agent Store をアプリ専用のフォルダに開く。
 * 既定の保存先（ホーム配下）はフォルダが無い環境で開けないことがあるため、場所を明示する。
 * SQLite が使えない場合は JSONL ストアで続行する。
 */
function openStore(stateRoot: string, workspaceRef: string, log?: Log): Promise<LocalAgentStore> {
  let p = storeCache.get(stateRoot)
  if (!p) {
    p = (async (): Promise<LocalAgentStore> => {
      try {
        const { SqliteLocalAgentStore } = await import('@cursor/sdk/sqlite')
        return await SqliteLocalAgentStore.open({ workspaceRef, stateRoot })
      } catch (err) {
        log?.('warn', 'sqlite agent store unavailable, using jsonl store', { error: describeError(err) })
        const sdk = await loadSdk()
        return new sdk.JsonlLocalAgentStore(`${stateRoot}-jsonl`)
      }
    })()
    p.catch(() => storeCache.delete(stateRoot))
    storeCache.set(stateRoot, p)
  }
  return p
}

export class CursorCharacterAgent implements CharacterAgent {
  readonly id = 'cursor' as const
  private agent: SdkAgent | null = null
  private agentId: string | null = null
  private turns = 0
  private tools: Record<string, CustomToolDef>

  constructor(private options: CursorAgentOptions) {
    this.tools = createCharacterTools(options.bridge)
  }

  async health(): Promise<AgentHealth> {
    if (!this.options.apiKey) return { ok: false, message: 'Cursor API Key が未設定です' }
    if (!this.options.modelId) return { ok: false, message: 'モデルが未選択です' }
    try {
      const sdk = await loadSdk()
      const me = await sdk.Cursor.me({ apiKey: this.options.apiKey })
      return { ok: true, message: `接続OK（${me.apiKeyName}）` }
    } catch (err) {
      return { ok: false, message: describeError(err) }
    }
  }

  async listModels(): Promise<ModelOption[]> {
    if (!this.options.apiKey) return []
    const sdk = await loadSdk()
    const models = await sdk.Cursor.models.list({ apiKey: this.options.apiKey })
    return models.map((m) => ({ id: m.id, name: m.displayName || m.id }))
  }

  private agentOptions(store: LocalAgentStore) {
    return {
      apiKey: this.options.apiKey,
      model: { id: this.options.modelId },
      name: 'AMCursorTuberKit Character',
      // tools / disallowedTools / customTools は保存されないので、resume 時にも毎回渡す
      tools: allowedBuiltinTools({ web: this.options.webTools }),
      disallowedTools: [...DENIED_BUILTIN_TOOLS],
      local: {
        cwd: this.options.workspaceDir,
        settingSources: [],
        store,
        customTools: this.tools as never,
        enableAgentRetries: true,
      },
    }
  }

  private async ensureAgent(): Promise<SdkAgent> {
    const sdk = await loadSdk()
    const store = await openStore(this.options.storeDir, this.options.workspaceDir, this.options.log)
    if (this.agent && this.turns >= this.options.rotateAfterTurns) {
      this.options.log?.('info', 'rotate agent to keep context small', { turns: this.turns })
      this.agent.close()
      this.agent = null
      this.agentId = null
      this.turns = 0
    }
    if (this.agent) return this.agent
    if (this.agentId) {
      try {
        this.agent = await sdk.Agent.resume(this.agentId, this.agentOptions(store))
        return this.agent
      } catch (err) {
        this.options.log?.('warn', 'resume failed, creating new agent', { error: describeError(err) })
        this.agentId = null
      }
    }
    this.agent = await sdk.Agent.create(this.agentOptions(store))
    this.agentId = this.agent.agentId
    this.turns = 0
    return this.agent
  }

  async run(prompt: string, handlers: AgentRunHandlers): Promise<AgentRunResult> {
    const started = Date.now()
    const agent = await this.ensureAgent()
    let streamed = ''
    const run = await agent.send(prompt, {
      onDelta: ({ update }) => {
        if (update.type === 'text-delta' && update.text) {
          streamed += update.text
          handlers.onText(update.text)
        }
      },
      local: { customTools: this.tools as never },
    })
    const onAbort = () => void run.cancel().catch(() => undefined)
    handlers.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const result = await run.wait()
      this.turns++
      if (result.status === 'error') {
        // 状態が壊れている可能性があるので次回は作り直す
        this.agent?.close()
        this.agent = null
        throw new Error(result.error?.message ?? 'Agent run failed')
      }
      if (result.status === 'cancelled') throw new DOMException('cancelled', 'AbortError')
      let text = streamed
      if (!text && result.result) {
        text = result.result
        handlers.onText(text)
      }
      return { text, durationMs: Date.now() - started }
    } finally {
      handlers.signal?.removeEventListener('abort', onAbort)
    }
  }

  async dispose() {
    try {
      this.agent?.close()
    } catch {
      /* noop */
    }
    this.agent = null
  }
}

export function describeError(err: unknown): string {
  if (err instanceof Error) {
    const name = err.name && err.name !== 'Error' ? `${err.name}: ` : ''
    return `${name}${err.message}`.slice(0, 300)
  }
  return String(err).slice(0, 300)
}
