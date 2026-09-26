import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { EventBus } from '@amctk/core'
import {
  isSecretKey,
  STREAM_PLATFORMS,
  type AppEvent,
  type AppSettings,
  type AssetImportKind,
  type DeepPartial,
  type HealthReport,
  type RuntimeSnapshot,
  type SinDelta,
  type StreamPlatform,
  type TTSProviderId,
} from '@amctk/shared'
import { AssetService, registerAssetScheme } from './asset-service'
import { nodeVersionOk, runHealthCheck } from './health'
import { Logger } from './logger'
import { MemoryService } from './memory-service'
import { Orchestrator } from './orchestrator'
import { runSmoke } from './smoke'
import { SecretService } from './secret-service'
import { SettingsService } from './settings-service'
import { Storage } from './storage'
import { StreamSourceService } from './stream-service'
import { TTSService } from './tts-service'
import { WindowManager } from './windows'

registerAssetScheme()

/**
 * パッケージ版では Cursor SDK のネイティブ補助バイナリ（rg / tree-sitter）が app.asar.unpacked にあるため、
 * SDK の探索に頼らず場所を明示する。
 */
function configureCursorSdkPaths() {
  if (!app.isPackaged) return
  const base = join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@cursor', `sdk-${process.platform}-${process.arch}`)
  if (!existsSync(base)) return
  const rg = join(base, 'bin', process.platform === 'win32' ? 'rg.exe' : 'rg')
  if (!process.env.CURSOR_RIPGREP_PATH && existsSync(rg)) process.env.CURSOR_RIPGREP_PATH = rg
  const vendor = join(base, 'vendor')
  if (!process.env.CURSOR_TREE_SITTER_VENDOR_DIR && existsSync(vendor)) process.env.CURSOR_TREE_SITTER_VENDOR_DIR = vendor
}
configureCursorSdkPaths()

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

// スモークテストでは実データを汚さないよう別フォルダを使う
if (process.env.AMCTK_USER_DATA) app.setPath('userData', process.env.AMCTK_USER_DATA)
const userData = app.getPath('userData')
const logger = new Logger(join(userData, 'logs'))
const log = logger.scope('app')

process.on('uncaughtException', (err) => log.error('uncaught exception', { error: err.stack ?? String(err) }))
process.on('unhandledRejection', (err) => log.error('unhandled rejection', { error: String(err) }))

async function main() {
  await app.whenReady()
  app.setAppUserModelId('jp.amcursortuberkit.app')

  const settings = new SettingsService(userData, logger.scope('app'))
  const secrets = new SecretService(userData, logger.scope('app'))
  let storageOk = true
  let storage: Storage
  try {
    storage = new Storage(join(userData, 'data'), logger.scope('storage'))
  } catch (err) {
    storageOk = false
    log.error('failed to open sqlite, using in-memory database', { error: String(err) })
    storage = new Storage(join(userData, 'data-fallback-' + Date.now()), logger.scope('storage'))
  }
  storage.prune()

  const assets = new AssetService(userData, logger.scope('avatar'))
  assets.handleProtocol()

  const bus = new EventBus((err, event) => log.error('event handler error', { type: event.type, error: String(err) }))
  const iconPath = join(__dirname, '../../build/icon.png')
  const windows = new WindowManager(logger.scope('stage'), existsSync(iconPath) ? iconPath : undefined)
  const tts: TTSService = new TTSService(settings.get().tts, windows, storage, logger.scope('tts'), () => orchestrator.sins.values)
  const memory = new MemoryService(() => settings.get(), secrets, storage, logger.scope('memory'))
  const orchestrator: Orchestrator = new Orchestrator(bus, () => settings.get(), secrets, storage, memory, tts, logger.scope('agent'), userData)
  const streams = new StreamSourceService(() => settings.get(), secrets, logger)

  let health: HealthReport = { checkedAt: 0, items: [] }
  let healthTimer: ReturnType<typeof setTimeout> | undefined
  const checkHealth = async () => {
    health = await runHealthCheck({ settings: settings.get(), orchestrator, tts, memory, storageOk, stageOpen: windows.stageOpen })
    bus.emit({ type: 'HEALTH_CHANGED', payload: health })
    return health
  }
  const scheduleHealth = (ms = 800) => {
    if (healthTimer) clearTimeout(healthTimer)
    healthTimer = setTimeout(() => void checkHealth(), ms)
  }

  // Event Bus → 全ウィンドウへ
  bus.onAny((e: AppEvent) => windows.broadcast(e))
  logger.onEntry((entry) => {
    if (entry.level !== 'debug') windows.broadcast({ type: 'LOG', payload: entry })
  })

  streams.onEvent = (e) => orchestrator.pushStreamEvent(e)
  streams.onHealth = (h) => bus.emit({ type: 'STREAM_HEALTH', payload: h })
  tts.onFailure = () => scheduleHealth(200)
  windows.onStageChange = (open) => {
    bus.emit({ type: 'STAGE_STATE', payload: { open } })
    scheduleHealth(100)
  }
  windows.onAudioHostChange = () => {
    // 再生先が変わったら古い方を止める（二重再生防止）
    windows.stopAudioEverywhere()
    tts.interruptCurrent()
  }

  settings.onChange((s, prev) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('amctk:settings', s)
    orchestrator.configure(s)
    if (JSON.stringify(s.tts) !== JSON.stringify(prev.tts)) {
      tts.configure(s.tts)
      scheduleHealth()
    }
    if (JSON.stringify(s.memory) !== JSON.stringify(prev.memory)) {
      memory.rebuild()
      scheduleHealth()
    }
    if (JSON.stringify(s.agent) !== JSON.stringify(prev.agent)) scheduleHealth()
    if (JSON.stringify(s.stage) !== JSON.stringify(prev.stage)) windows.applyStage(s.stage)
  })

  /* ---------------- IPC ---------------- */

  const handle = <A extends unknown[], R>(channel: string, fn: (e: Electron.IpcMainInvokeEvent, ...args: A) => R | Promise<R>) =>
    ipcMain.handle(channel, async (e, ...args) => {
      try {
        return await fn(e, ...(args as A))
      } catch (err) {
        log.warn(`ipc ${channel} failed`, { error: err instanceof Error ? err.message : String(err) })
        throw err
      }
    })

  handle('settings:get', () => settings.get())
  handle('settings:update', (_e, patch: DeepPartial<AppSettings>) => settings.update(patch ?? {}))
  handle('settings:reset', (_e, section?: keyof AppSettings) => settings.reset(section))

  handle('secrets:status', () => secrets.status())
  handle('secrets:encryptionAvailable', () => secrets.encryptionAvailable)
  handle('secrets:set', async (_e, key: unknown, value: unknown) => {
    if (!isSecretKey(key) || typeof value !== 'string') throw new Error('invalid secret')
    await secrets.set(key, value)
    if (key === 'cloudflareApiToken') memory.rebuild()
    orchestrator.configure(settings.get())
    scheduleHealth()
    return secrets.status()
  })
  handle('secrets:clear', async (_e, key: unknown) => {
    if (!isSecretKey(key)) throw new Error('invalid secret')
    await secrets.clear(key)
    orchestrator.configure(settings.get())
    scheduleHealth()
    return secrets.status()
  })

  handle('runtime:snapshot', (): RuntimeSnapshot => {
    const parts = orchestrator.snapshotParts()
    return {
      ...parts,
      speaking: tts.speaking,
      ttsQueue: tts.length,
      health,
      streams: streams.health(),
      stageOpen: windows.stageOpen,
    }
  })
  handle('runtime:healthCheck', () => checkHealth())

  handle('agent:submit', (_e, input: { text: string; viewerName?: string; direct?: boolean }) =>
    orchestrator.submitManual(String(input?.text ?? '').slice(0, 1000), input?.viewerName?.slice(0, 40), !!input?.direct),
  )
  handle('agent:cancel', () => orchestrator.cancel())
  handle('agent:listModels', () => orchestrator.listModels())
  handle('agent:test', () => orchestrator.testAgent())
  handle('agent:resetSins', () => orchestrator.resetSins())
  handle('agent:nudgeSins', (_e, delta: SinDelta) => orchestrator.nudgeSins(delta ?? {}))
  handle('agent:clearConversation', () => orchestrator.clearConversation())

  handle('tts:listVoices', (_e, provider?: TTSProviderId) => tts.listVoices(provider))
  handle('tts:health', (_e, provider?: TTSProviderId) => tts.health(provider))
  handle('tts:preview', (_e, text: string) => {
    tts.stop()
    tts.enqueue(String(text).slice(0, 200), 'happy')
  })
  handle('tts:stop', () => tts.stop())

  const platformOf = (p: unknown): StreamPlatform => {
    if (typeof p !== 'string' || !(STREAM_PLATFORMS as readonly string[]).includes(p)) throw new Error('invalid platform')
    return p as StreamPlatform
  }
  handle('stream:connect', async (_e, p: unknown) => {
    const platform = platformOf(p)
    if (platform !== 'manual') settings.update({ stream: { [platform]: { enabled: true } } } as DeepPartial<AppSettings>)
    await streams.connect(platform)
  })
  handle('stream:disconnect', async (_e, p: unknown) => {
    const platform = platformOf(p)
    if (platform !== 'manual') settings.update({ stream: { [platform]: { enabled: false } } } as DeepPartial<AppSettings>)
    await streams.disconnect(platform)
  })
  handle('stream:injectTest', (_e, count: number) => {
    for (const ev of StreamSourceService.testEvents(Math.max(1, Math.min(200, Number(count) || 10)))) orchestrator.pushStreamEvent(ev)
  })
  handle('stream:clearQueue', () => orchestrator.clearQueue())
  handle('stream:twitchDeviceLogin', () =>
    streams.twitchDeviceLogin((ok, message) => {
      logger.log(ok ? 'info' : 'warn', 'stream.twitch', message)
      windows.broadcast({ type: 'LOG', payload: { at: Date.now(), level: ok ? 'info' : 'warn', category: 'stream.twitch', message, data: { toast: true } } })
    }),
  )

  handle('memory:health', () => memory.health())
  handle('memory:list', (_e, viewerKey?: string) => memory.list(viewerKey))
  handle('memory:viewers', () => storage.viewers())
  handle('memory:remember', (_e, input: { viewerKey?: string; kind: 'note'; content: string }) =>
    memory.remember({ viewerKey: input.viewerKey, kind: input.kind ?? 'note', content: String(input.content ?? '').slice(0, 400) }),
  )
  handle('memory:forget', (_e, id: string) => memory.forget(String(id)))

  handle('stage:open', () => {
    windows.openStage(settings.get().stage)
  })
  handle('stage:close', () => windows.closeStage())

  handle('assets:import', (e, kind: AssetImportKind, options?: { assetId?: string; slot?: string }) =>
    assets.import(BrowserWindow.fromWebContents(e.sender), kind, options),
  )

  handle('logs:recent', () => logger.recent())
  handle('logs:openFolder', () => shell.openPath(logger.directory))

  handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    platform: `${process.platform} ${process.arch}`,
    userData,
    nodeOk: nodeVersionOk(),
  }))
  handle('app:openExternal', (_e, url: string) => {
    if (typeof url === 'string' && /^https:\/\//.test(url)) return shell.openExternal(url)
  })

  ipcMain.on('audio:report', (_e, report: { type: 'started' | 'ended' | 'error'; id: string; message?: string }) => tts.report(report))
  ipcMain.on('audio:lip', (e, value: number) => {
    windows.broadcast({ type: 'LIPSYNC_FRAME', payload: { value: Number(value) || 0, at: Date.now() } }, e.sender)
  })
  ipcMain.on('renderer:ready', (e) => windows.markReady(e.sender))

  /* ---------------- 起動 ---------------- */

  windows.createControl()
  orchestrator.start()
  void checkHealth()
  void streams.connectEnabled()
  log.info('app started', { version: app.getVersion(), node: process.versions.node, electron: process.versions.electron })

  if (process.env.AMCTK_SMOKE) {
    void runSmoke(process.env.AMCTK_SMOKE, { windows, orchestrator, bus, openStage: () => windows.openStage(settings.get().stage) })
  }

  app.on('second-instance', () => {
    windows.control?.show()
    windows.control?.focus()
  })
  app.on('activate', () => {
    if (!windows.control) windows.createControl()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', () => {
    orchestrator.stop()
    void streams.disconnectAll()
    void settings.flush()
  })

  // Controlを閉じたらステージも閉じてアプリを終了する
  windows.control?.on('closed', () => {
    windows.closeStage()
  })
}

void main()
