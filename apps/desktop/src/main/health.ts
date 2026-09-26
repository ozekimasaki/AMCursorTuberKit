import type { AppSettings, HealthItem, HealthReport } from '@amctk/shared'
import type { MemoryService } from './memory-service'
import type { Orchestrator } from './orchestrator'
import type { TTSService } from './tts-service'

export function nodeVersionOk(version = process.versions.node): boolean {
  const [major, minor] = version.split('.').map(Number)
  return major > 22 || (major === 22 && minor >= 13)
}

/** 起動時・設定変更時の依存サービス Health Check。1つの失敗が他を止めないよう個別に実行 */
export async function runHealthCheck(deps: {
  settings: AppSettings
  orchestrator: Orchestrator
  tts: TTSService
  memory: MemoryService
  storageOk: boolean
  stageOpen: boolean
}): Promise<HealthReport> {
  const settle = async (fn: () => Promise<HealthItem>, fallback: Omit<HealthItem, 'message'>): Promise<HealthItem> => {
    try {
      return await Promise.race([
        fn(),
        new Promise<HealthItem>((resolve) => setTimeout(() => resolve({ ...fallback, level: 'warn', message: 'タイムアウトしました' }), 6000)),
      ])
    } catch (err) {
      return { ...fallback, level: 'error', message: err instanceof Error ? err.message : String(err) }
    }
  }

  const items = await Promise.all([
    settle(
      async () => ({
        id: 'runtime',
        label: 'ランタイム',
        level: nodeVersionOk() ? 'ok' : 'error',
        message: `Node ${process.versions.node} / Electron ${process.versions.electron}${nodeVersionOk() ? '' : '（Node 22.13 以上が必要です）'}`,
      }),
      { id: 'runtime', label: 'ランタイム', level: 'error' },
    ),
    settle(async () => {
      const wantsCursor = deps.settings.agent.provider === 'cursor'
      const h = await deps.orchestrator.agentHealth()
      if (h.demo) {
        return {
          id: 'agent',
          label: 'AI (Cursor SDK)',
          level: wantsCursor ? 'warn' : 'ok',
          message: wantsCursor ? 'API Key かモデルが未設定のため、デモ応答で動いています' : 'デモ応答モード（Cursor SDK 未使用）',
        }
      }
      return { id: 'agent', label: 'AI (Cursor SDK)', level: h.ok ? 'ok' : 'error', message: h.message }
    }, { id: 'agent', label: 'AI (Cursor SDK)', level: 'error' }),
    settle(async () => {
      const h = await deps.tts.health()
      return {
        id: 'tts',
        label: '音声合成',
        level: h.ok ? (h.provider === 'none' ? 'off' : 'ok') : 'warn',
        message: h.ok ? `${labelOf(h.provider)}${h.version ? ` v${h.version}` : ''}${h.message ? ` ${h.message}` : ''}` : `${h.message ?? '接続できません'}（字幕のみで続行）`,
      }
    }, { id: 'tts', label: '音声合成', level: 'warn' }),
    settle(async () => {
      const h = await deps.memory.health()
      return { id: 'memory', label: '長期記憶', level: h.ok ? 'ok' : 'warn', message: h.message ?? h.provider }
    }, { id: 'memory', label: '長期記憶', level: 'warn' }),
    settle(
      async () => ({
        id: 'storage',
        label: 'ローカルDB',
        level: deps.storageOk ? 'ok' : 'error',
        message: deps.storageOk ? 'SQLite 正常' : 'SQLite を開けませんでした',
      }),
      { id: 'storage', label: 'ローカルDB', level: 'error' },
    ),
    settle(
      async () => ({
        id: 'stage',
        label: 'ステージ',
        level: deps.stageOpen ? 'ok' : 'off',
        message: deps.stageOpen ? '配信用ウィンドウを表示中' : '閉じています',
      }),
      { id: 'stage', label: 'ステージ', level: 'off' },
    ),
  ])
  return { checkedAt: Date.now(), items }
}

function labelOf(provider: string) {
  return (
    { voicevox: 'VOICEVOX', aivis: 'AivisSpeech', irodori: 'Irodori-TTS', system: 'OS標準音声', none: '音声なし' } as Record<string, string>
  )[provider] ?? provider
}
