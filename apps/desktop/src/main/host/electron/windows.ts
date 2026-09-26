import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserWindow, screen, shell, type WebContents } from 'electron'
import { PUSH, type AppEvent, type AppSettings, type AudioCommand, type StageSettings } from '@amctk/shared'
import type { ScopedLogger } from '../../logger'
import { initialStageSize, resizeForRatio } from '../stage-layout'
import type { RendererRef, WindowHost } from '../types'

const isDev = !!process.env.ELECTRON_RENDERER_URL

export const rendererRef = (wc: WebContents) => wc as unknown as RendererRef
export const webContentsOf = (ref: RendererRef) => ref as unknown as WebContents

function pageUrl(win: BrowserWindow, page: 'control' | 'stage') {
  if (isDev) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/${page}.html`)
  else void win.loadFile(join(__dirname, `../renderer/${page}.html`))
}

function hardenWebContents(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(process.env.ELECTRON_RENDERER_URL ?? 'file://')) e.preventDefault()
  })
}

/**
 * Control Window（操作画面）と Stage Window（配信映像専用）を分けて管理する（WindowHost の Electron 実装）。
 */
export class ElectronWindows implements WindowHost {
  private control: BrowserWindow | null = null
  private stage: BrowserWindow | null = null
  private stageReady = false
  private controlReady = false
  onStageChange?: (open: boolean) => void
  onAudioHostChange?: () => void
  onControlClosed?: () => void

  constructor(
    private log: ScopedLogger,
    private icon?: string,
  ) {}

  showControl() {
    if (this.control && !this.control.isDestroyed()) {
      this.control.show()
      this.control.focus()
      return
    }
    const win = new BrowserWindow({
      width: 1320,
      height: 860,
      minWidth: 980,
      minHeight: 640,
      title: 'AMCursorTuberKit',
      backgroundColor: '#fff7fb',
      show: false,
      icon: this.icon,
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    })
    hardenWebContents(win)
    win.once('ready-to-show', () => win.show())
    win.on('closed', () => {
      this.control = null
      this.controlReady = false
      this.onControlClosed?.()
    })
    win.webContents.on('did-start-loading', () => (this.controlReady = false))
    pageUrl(win, 'control')
    this.control = win
  }

  openStage(stage: StageSettings) {
    if (this.stage && !this.stage.isDestroyed()) {
      this.stage.show()
      this.stage.focus()
      return
    }
    const size = initialStageSize(stage, screen.getPrimaryDisplay().workAreaSize)
    const win = new BrowserWindow({
      ...size,
      useContentSize: true,
      title: 'AMCursorTuberKit Stage',
      // 透明背景に切り替えられるよう、常に透明ウィンドウで作ってCSSで背景を塗る
      transparent: true,
      frame: false,
      hasShadow: false,
      backgroundColor: '#00000000',
      alwaysOnTop: stage.alwaysOnTop,
      icon: this.icon,
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required',
      },
    })
    win.setAspectRatio(stage.width / stage.height)
    hardenWebContents(win)
    win.on('closed', () => {
      this.stage = null
      this.stageReady = false
      this.onStageChange?.(false)
      this.onAudioHostChange?.()
    })
    win.webContents.on('did-start-loading', () => (this.stageReady = false))
    pageUrl(win, 'stage')
    this.stage = win
    this.onStageChange?.(true)
    this.log.info('stage opened')
  }

  closeStage() {
    this.stage?.close()
  }

  applyStage(stage: StageSettings) {
    const win = this.stage
    if (!win || win.isDestroyed()) return
    win.setAlwaysOnTop(stage.alwaysOnTop)
    const [width, height] = win.getContentSize()
    const next = resizeForRatio({ width, height }, stage)
    if (next) {
      win.setAspectRatio(0)
      win.setContentSize(next.width, next.height)
    }
    win.setAspectRatio(stage.width / stage.height)
  }

  markReady(from: RendererRef) {
    const sender = webContentsOf(from)
    if (this.stage && sender === this.stage.webContents) this.stageReady = true
    if (this.control && sender === this.control.webContents) this.controlReady = true
    this.onAudioHostChange?.()
  }

  get stageOpen() {
    return !!this.stage && !this.stage.isDestroyed()
  }

  /** 音声を再生するウィンドウ。Stageが開いていればStage、なければControl */
  private get audioHost(): WebContents | null {
    if (this.stage && !this.stage.isDestroyed() && this.stageReady) return this.stage.webContents
    if (this.control && !this.control.isDestroyed() && this.controlReady) return this.control.webContents
    return null
  }

  private get open(): BrowserWindow[] {
    return [this.control, this.stage].filter((w): w is BrowserWindow => !!w && !w.isDestroyed())
  }

  broadcast(event: AppEvent, except?: RendererRef) {
    const skip = except ? webContentsOf(except) : undefined
    for (const win of this.open) if (win.webContents !== skip) win.webContents.send(PUSH.event, event)
  }

  sendSettings(settings: AppSettings) {
    for (const win of this.open) win.webContents.send(PUSH.settings, settings)
  }

  sendAudio(cmd: AudioCommand): boolean {
    const host = this.audioHost
    if (!host) return false
    host.send(PUSH.audio, cmd)
    return true
  }

  /** 音声ホストが切り替わったときに、古いホストの再生を止める */
  stopAudioEverywhere() {
    for (const win of this.open) win.webContents.send(PUSH.audio, { type: 'stop' } satisfies AudioCommand)
  }

  async capture(which: 'control' | 'stage', file: string) {
    const win = which === 'control' ? this.control : this.stage
    if (!win || win.isDestroyed()) return
    const img = await win.webContents.capturePage()
    await writeFile(file, img.toPNG())
  }

  async showControlPage(page: string) {
    if (!/^[a-z-]+$/.test(page)) throw new Error(`invalid page: ${page}`)
    await this.control?.webContents.executeJavaScript(`location.hash = '#${page}'`)
  }
}
