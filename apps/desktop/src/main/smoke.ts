import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, ipcMain, type BrowserWindow } from 'electron'
import type { EventBus } from '@amctk/core'
import type { Orchestrator } from './orchestrator'
import type { WindowManager } from './windows'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function capture(win: BrowserWindow | null, file: string) {
  if (!win || win.isDestroyed()) return
  const img = await win.webContents.capturePage()
  await writeFile(file, img.toPNG())
}

/**
 * AMCTK_SMOKE=<出力フォルダ> で起動すると、
 * 手入力 → Agent → Seven Sins → TTS → Stage の一連の流れを自動で動かしてスクリーンショットを保存し、終了する。
 * CIやリリース前の動作確認用（通常起動では何もしない）。
 */
export async function runSmoke(dir: string, deps: { windows: WindowManager; orchestrator: Orchestrator; bus: EventBus; openStage: () => void }) {
  await mkdir(dir, { recursive: true })
  const log: string[] = []
  const note = (m: string) => log.push(`${new Date().toISOString()} ${m}`)
  const stats = { started: 0, ended: 0, reports: {} as Record<string, number>, lipMax: 0, lipFrames: 0 }
  deps.bus.on('TTS_STARTED', () => stats.started++)
  deps.bus.on('TTS_ENDED', () => stats.ended++)
  ipcMain.on('audio:report', (_e, r: { type: string }) => (stats.reports[r.type] = (stats.reports[r.type] ?? 0) + 1))
  ipcMain.on('audio:lip', (_e, v: number) => {
    stats.lipFrames++
    stats.lipMax = Math.max(stats.lipMax, Number(v) || 0)
  })
  try {
    await wait(4000)
    await capture(deps.windows.control, join(dir, '01-dashboard.png'))
    note('dashboard captured')
    deps.openStage()
    await wait(3500)
    deps.orchestrator.submitManual('こんばんは！紅茶は好き？', 'スモークテスト')
    note('manual input submitted')
    await wait(2500)
    await capture(deps.windows.stage, join(dir, '02-stage-speaking.png'))
    await capture(deps.windows.control, join(dir, '03-dashboard-reply.png'))
    await wait(5000)
    const snap = deps.orchestrator.snapshotParts()
    note(`conversation=${snap.conversation.length} phase=${snap.agent.phase} emotion=${snap.emotion.emotion}`)
    note(`sins=${JSON.stringify(snap.sins.current)}`)
    const last = snap.conversation.filter((c) => c.role === 'character').pop()
    note(`tts started=${stats.started} ended=${stats.ended} reports=${JSON.stringify(stats.reports)} lipFrames=${stats.lipFrames} lipMax=${stats.lipMax.toFixed(2)}`)
    note(`last reply=${last?.text ?? '(none)'} delta=${JSON.stringify(last?.sinDelta ?? {})}`)
    await capture(deps.windows.control, join(dir, '04-dashboard-after.png'))

    // コメント急増時もLLM呼び出しが暴走しないか
    const before = deps.orchestrator.snapshotParts().agent.turns
    deps.orchestrator.selector.clear()
    for (let i = 0; i < 50; i++) {
      deps.orchestrator.pushStreamEvent({
        id: `smoke-${i}`,
        platform: 'youtube',
        kind: i === 7 ? 'superchat' : 'chat',
        text: i === 7 ? '応援してます！' : `コメント${i % 5}`,
        amount: i === 7 ? { value: 1000, currency: 'JPY', display: '¥1,000' } : undefined,
        receivedAt: Date.now(),
        viewer: { platform: 'youtube', platformUserId: `u${i % 9}`, displayName: `視聴者${i % 9}` },
      })
    }
    await wait(6000)
    const after = deps.orchestrator.snapshotParts()
    note(`burst: 50 events -> turns ${after.agent.turns - before}, pending ${after.pending.length}, callsLastMinute ${after.agent.callsLastMinute}`)
    note(`burst first pick: ${after.conversation.filter((c) => c.role === 'viewer').slice(-2).map((c) => c.text).join(' | ')}`)

    const pages = ['stage', 'avatar', 'voice', 'ai', 'memory', 'streams', 'debug', 'dashboard']
    for (const [i, p] of pages.entries()) {
      await deps.windows.control?.webContents.executeJavaScript(`location.hash = '#${p}'`)
      await wait(900)
      await capture(deps.windows.control, join(dir, `1${i}-${p}.png`))
    }
    note('pages captured')
  } catch (err) {
    note(`error ${err instanceof Error ? err.stack : String(err)}`)
  } finally {
    await writeFile(join(dir, 'smoke.log'), log.join('\n'), 'utf8')
    app.quit()
  }
}
