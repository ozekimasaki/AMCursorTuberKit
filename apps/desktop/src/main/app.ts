import { join } from 'node:path'
import { EventBus } from '@amctk/core'
import {
  INVOKE,
  isSecretKey,
  SEND,
  STREAM_PLATFORMS,
  type AppEvent,
  type AppInfo,
  type AppSettings,
  type AssetImportKind,
  type DeepPartial,
  type HealthReport,
  type InvokeKey,
  type RuntimeSnapshot,
  type SinDelta,
  type StreamPlatform,
  type TTSProviderId,
} from '@amctk/shared'
import { createKickChatroomResolver } from '@amctk/stream-kick'
import { AssetService } from './asset-service'
import { nodeVersionOk, runHealthCheck } from './health'
import type { HostBoot, RendererRef } from './host/types'
import { Logger } from './logger'
import { MemoryService } from './memory-service'
import { Orchestrator } from './orchestrator'
import { runSmoke } from './smoke'
import { SecretService } from './secret-service'
import { SettingsService } from './settings-service'
import { Storage } from './storage'
import { StreamSourceService } from './stream-service'
import { TTSService } from './tts-service'

/** Renderer からの呼び出しを処理する関数。引数は Renderer から届く値なので、各ハンドラで検証する */
type Handler = (from: RendererRef, ...args: never[]) => unknown

/**
 * アプリ本体の起動と配線。デスクトップ基盤には DesktopHost 経由でだけ触れる（Electron の API を直接使わない）。
 */
export async function startApp(boot: HostBoot) {
  const userData = boot.userData
  const logger = new Logger(join(userData, 'logs'))
  const log = logger.scope('app')

  process.on('uncaughtException', (err) => log.error('uncaught exception', { error: err.stack ?? String(err) }))
  process.on('unhandledRejection', (err) => log.error('unhandled rejection', { error: String(err) }))

  const host = await boot.ready(logger)
  const windows = host.windows

  const settings = new SettingsService(userData, logger.scope('app'))
  const secrets = new SecretService(userData, host.secrets, logger.scope('app'))
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

  const assets = new AssetService(userData, host.dialogs, logger.scope('avatar'))
  host.serveAssets((url) => assets.resolveUrl(url))

  const bus = new EventBus((err, event) => log.error('event handler error', { type: event.type, error: String(err) }))
  const tts: TTSService = new TTSService(
    settings.get().tts,
    windows,
    storage,
    logger.scope('tts'),
    () => orchestrator.sins.values,
  )
  const memory = new MemoryService(() => settings.get(), secrets, storage, logger.scope('memory'))
  const orchestrator: Orchestrator = new Orchestrator(
    bus,
    () => settings.get(),
    secrets,
    storage,
    memory,
    tts,
    logger.scope('agent'),
    userData,
  )
  const streams = new StreamSourceService(() => settings.get(), secrets, logger, {
    resolveKickChatroomId: createKickChatroomResolver((url, init) => host.browserFetch(url, init)),
  })

  let health: HealthReport = { checkedAt: 0, items: [] }
  let healthTimer: ReturnType<typeof setTimeout> | undefined
  const checkHealth = async () => {
    health = await runHealthCheck({
      hostLabel: host.info.label,
      settings: settings.get(),
      orchestrator,
      tts,
      memory,
      storageOk,
      stageOpen: windows.stageOpen,
    })
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
  // 操作画面を閉じたらステージも閉じてアプリを終了する
  windows.onControlClosed = () => windows.closeStage()

  settings.onChange((s, prev) => {
    windows.sendSettings(s)
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
    if (JSON.stringify(s.stream) !== JSON.stringify(prev.stream)) streams.handleSettingsChange(s.stream, prev.stream)
  })

  /* ---------------- IPC（チャンネルは @amctk/shared の INVOKE / SEND） ---------------- */

  const platformOf = (p: unknown): StreamPlatform => {
    if (typeof p !== 'string' || !(STREAM_PLATFORMS as readonly string[]).includes(p))
      throw new Error('invalid platform')
    return p as StreamPlatform
  }

  // INVOKE の全チャンネルに対応するハンドラ。1つでも欠けると型エラーになる
  const api: Record<InvokeKey, Handler> = {
    settingsGet: () => settings.get(),
    settingsUpdate: (_from, patch: DeepPartial<AppSettings>) => settings.update(patch ?? {}),
    settingsReset: (_from, section?: keyof AppSettings) => settings.reset(section),

    secretsStatus: () => secrets.status(),
    secretsEncryptionAvailable: () => secrets.encryptionAvailable,
    secretsSet: async (_from, key: unknown, value: unknown) => {
      if (!isSecretKey(key) || typeof value !== 'string') throw new Error('invalid secret')
      await secrets.set(key, value)
      if (key === 'cloudflareApiToken') memory.rebuild()
      orchestrator.configure(settings.get())
      scheduleHealth()
      return secrets.status()
    },
    secretsClear: async (_from, key: unknown) => {
      if (!isSecretKey(key)) throw new Error('invalid secret')
      await secrets.clear(key)
      orchestrator.configure(settings.get())
      scheduleHealth()
      return secrets.status()
    },

    runtimeSnapshot: (): RuntimeSnapshot => ({
      ...orchestrator.snapshotParts(),
      speaking: tts.speaking,
      ttsQueue: tts.length,
      health,
      streams: streams.health(),
      stageOpen: windows.stageOpen,
    }),
    runtimeHealthCheck: () => checkHealth(),

    agentSubmit: (_from, input: { text: string; viewerName?: string; direct?: boolean }) =>
      orchestrator.submitManual(
        String(input?.text ?? '').slice(0, 1000),
        input?.viewerName?.slice(0, 40),
        !!input?.direct,
      ),
    agentCancel: () => orchestrator.cancel(),
    agentListModels: () => orchestrator.listModels(),
    agentTest: () => orchestrator.testAgent(),
    agentResetSins: () => orchestrator.resetSins(),
    agentNudgeSins: (_from, delta: SinDelta) => orchestrator.nudgeSins(delta ?? {}),
    agentClearConversation: () => orchestrator.clearConversation(),

    ttsListVoices: (_from, provider?: TTSProviderId) => tts.listVoices(provider),
    ttsHealth: (_from, provider?: TTSProviderId) => tts.health(provider),
    ttsPreview: (_from, text: string) => {
      tts.stop()
      tts.enqueue(String(text).slice(0, 200), 'happy')
    },
    ttsStop: () => tts.stop(),

    streamConnect: async (_from, p: unknown) => {
      const platform = platformOf(p)
      if (platform !== 'manual')
        settings.update({ stream: { [platform]: { enabled: true } } } as DeepPartial<AppSettings>)
      await streams.connect(platform)
    },
    streamDisconnect: async (_from, p: unknown) => {
      const platform = platformOf(p)
      if (platform !== 'manual')
        settings.update({ stream: { [platform]: { enabled: false } } } as DeepPartial<AppSettings>)
      await streams.disconnect(platform)
    },
    streamInjectTest: (_from, count: number) => {
      for (const ev of StreamSourceService.testEvents(Math.max(1, Math.min(200, Number(count) || 10))))
        orchestrator.pushStreamEvent(ev)
    },
    streamClearQueue: () => orchestrator.clearQueue(),
    streamTwitchDeviceLogin: () =>
      streams.twitchDeviceLogin((ok, message) => {
        logger.log(ok ? 'info' : 'warn', 'stream.twitch', message)
        windows.broadcast({
          type: 'LOG',
          payload: {
            at: Date.now(),
            level: ok ? 'info' : 'warn',
            category: 'stream.twitch',
            message,
            data: { toast: true },
          },
        })
      }),

    memoryHealth: () => memory.health(),
    memoryList: (_from, viewerKey?: string) => memory.list(viewerKey),
    memoryViewers: () => storage.viewers(),
    memoryRemember: (_from, input: { viewerKey?: string; kind: 'note'; content: string }) =>
      memory.remember({
        viewerKey: input.viewerKey,
        kind: input.kind ?? 'note',
        content: String(input.content ?? '').slice(0, 400),
      }),
    memoryForget: (_from, id: string) => memory.forget(String(id)),

    stageOpen: () => windows.openStage(settings.get().stage),
    stageClose: () => windows.closeStage(),

    assetsImport: (from, kind: AssetImportKind, options?: { assetId?: string; slot?: string }) =>
      assets.import(from, kind, options),

    logsRecent: () => logger.recent(),
    logsOpenFolder: () => host.shell.openPath(logger.directory),

    appInfo: (): AppInfo => ({
      version: host.info.appVersion,
      host: host.info.label,
      node: process.versions.node,
      chrome: host.info.chrome,
      platform: `${process.platform} ${process.arch}`,
      userData,
      nodeOk: nodeVersionOk(),
    }),
    appOpenExternal: (_from, url: string) => {
      if (typeof url === 'string' && /^https:\/\//.test(url)) return host.shell.openExternal(url)
    },
  }

  for (const key of Object.keys(api) as InvokeKey[]) {
    const channel = INVOKE[key]
    const fn = api[key]
    host.ipc.handle(channel, async (from, ...args) => {
      try {
        return await fn(from, ...(args as never[]))
      } catch (err) {
        log.warn(`ipc ${channel} failed`, { error: err instanceof Error ? err.message : String(err) })
        throw err
      }
    })
  }

  host.ipc.on(SEND.audioReport, (_from, report) =>
    tts.report(report as { type: 'started' | 'ended' | 'error'; id: string; message?: string }),
  )
  host.ipc.on(SEND.audioLip, (from, value) => {
    windows.broadcast({ type: 'LIPSYNC_FRAME', payload: { value: Number(value) || 0, at: Date.now() } }, from)
  })
  host.ipc.on(SEND.rendererReady, (from) => windows.markReady(from))

  /* ---------------- 起動 ---------------- */

  windows.showControl()
  orchestrator.start()
  void checkHealth()
  void streams.connectEnabled()
  log.info('app started', { version: host.info.appVersion, node: process.versions.node, host: host.info.label })

  if (process.env.AMCTK_SMOKE) {
    void runSmoke(process.env.AMCTK_SMOKE, {
      host,
      orchestrator,
      bus,
      openStage: () => windows.openStage(settings.get().stage),
    })
  }

  host.onSecondInstance(() => windows.showControl())
  host.onBeforeQuit(() => {
    orchestrator.stop()
    void streams.disconnectAll()
    void settings.flush()
  })
}
