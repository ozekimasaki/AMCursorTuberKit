import type { ModelOption } from '@amctk/shared'
import { createCharacterTools, type CustomToolDef } from './tools'
import type { AgentHealth, AgentRunHandlers, AgentRunResult, CharacterAgent, ToolBridge } from './types'

type SdkModule = typeof import('@cursor/sdk')
type SdkAgent = Awaited<ReturnType<SdkModule['Agent']['create']>>

export interface CursorAgentOptions {
  apiKey: string
  modelId: string
  /** Local Agent の作業ディレクトリ。アプリ専用の空ディレクトリを渡す */
  workspaceDir: string
  rotateAfterTurns: number
  bridge: ToolBridge
  log?: (level: 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown>) => void
}

/**
 * 公開してよいのは AMCursorTuberKit の Custom Tool のみ。
 * `tools: ['mcp']` で built-in の shell / read / edit / web 系をすべて外し、
 * MCPファミリーのうち customTools だけが使える状態にする。
 * settingSources: [] でユーザー環境の MCP 設定やルールを読み込ませない。
 */
const ALLOWED_TOOLS = ['mcp'] as const

let sdkPromise: Promise<SdkModule> | null = null
function loadSdk(): Promise<SdkModule> {
  sdkPromise ??= import('@cursor/sdk')
  return sdkPromise
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

  private agentOptions() {
    return {
      apiKey: this.options.apiKey,
      model: { id: this.options.modelId },
      name: 'AMCursorTuberKit Character',
      tools: [...ALLOWED_TOOLS],
      local: {
        cwd: this.options.workspaceDir,
        settingSources: [],
        // resume 時にも毎回 customTools を再適用する
        customTools: this.tools as never,
        enableAgentRetries: true,
      },
    }
  }

  private async ensureAgent(): Promise<SdkAgent> {
    const sdk = await loadSdk()
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
        this.agent = await sdk.Agent.resume(this.agentId, this.agentOptions())
        return this.agent
      } catch (err) {
        this.options.log?.('warn', 'resume failed, creating new agent', { error: describeError(err) })
        this.agentId = null
      }
    }
    this.agent = await sdk.Agent.create(this.agentOptions())
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
