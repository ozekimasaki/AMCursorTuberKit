import { join } from 'node:path'
import { BrowserWindow, shell, screen } from 'electron'
import type { AppEvent, AudioCommand, StageSettings } from '@amctk/shared'
import type { ScopedLogger } from './logger'

const isDev = !!process.env.ELECTRON_RENDERER_URL

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
 * Control Window（操作画面）と Stage Window（配信映像専用）を分けて管理する。
 */
export class WindowManager {
  control: BrowserWindow | null = null
  stage: BrowserWindow | null = null
  private stageReady = false
  private controlReady = false
  onStageChange?: (open: boolean) => void
  onAudioHostChange?: () => void

  constructor(private log: ScopedLogger, private icon?: string) {}

  createControl() {
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
        additionalArguments: ['--amctk-role=control'],
        backgroundThrottling: false,
      },
    })
    hardenWebContents(win)
    win.once('ready-to-show', () => win.show())
    win.on('closed', () => {
      this.control = null
      this.controlReady = false
    })
    win.webContents.on('did-start-loading', () => (this.controlReady = false))
    pageUrl(win, 'control')
    this.control = win
    return win
  }

  openStage(stage: StageSettings) {
    if (this.stage && !this.stage.isDestroyed()) {
      this.stage.show()
      this.stage.focus()
      return this.stage
    }
    const display = screen.getPrimaryDisplay().workAreaSize
    const scale = Math.min(1, (display.width * 0.6) / stage.width, (display.height * 0.7) / stage.height)
    const win = new BrowserWindow({
      width: Math.round(stage.width * scale),
      height: Math.round(stage.height * scale),
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
        additionalArguments: ['--amctk-role=stage'],
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
    return win
  }

  closeStage() {
    this.stage?.close()
  }

  applyStage(stage: StageSettings) {
    const win = this.stage
    if (!win || win.isDestroyed()) return
    win.setAlwaysOnTop(stage.alwaysOnTop)
    const ratio = stage.width / stage.height
    const [w, h] = win.getContentSize()
    if (Math.abs(w / h - ratio) > 0.01) {
      // 比率が変わったら、今の面積に近い大きさで作り直す
      const area = w * h
      const height = Math.round(Math.sqrt(area / ratio))
      win.setAspectRatio(0)
      win.setContentSize(Math.round(height * ratio), height)
    }
    win.setAspectRatio(ratio)
  }

  markReady(sender: Electron.WebContents) {
    if (this.stage && sender === this.stage.webContents) this.stageReady = true
    if (this.control && sender === this.control.webContents) this.controlReady = true
    this.onAudioHostChange?.()
  }

  get stageOpen() {
    return !!this.stage && !this.stage.isDestroyed()
  }

  /** 音声を再生するウィンドウ。Stageが開いていればStage、なければControl */
  get audioHost(): Electron.WebContents | null {
    if (this.stage && !this.stage.isDestroyed() && this.stageReady) return this.stage.webContents
    if (this.control && !this.control.isDestroyed() && this.controlReady) return this.control.webContents
    return null
  }

  broadcast(event: AppEvent, except?: Electron.WebContents) {
    for (const win of [this.control, this.stage]) {
      if (!win || win.isDestroyed()) continue
      if (except && win.webContents === except) continue
      win.webContents.send('amctk:event', event)
    }
  }

  sendAudio(cmd: AudioCommand): boolean {
    const host = this.audioHost
    if (!host) return false
    host.send('amctk:audio', cmd)
    return true
  }

  /** 音声ホストが切り替わったときに、古いホストの再生を止める */
  stopAudioEverywhere() {
    for (const win of [this.control, this.stage]) {
      if (win && !win.isDestroyed()) win.webContents.send('amctk:audio', { type: 'stop' } satisfies AudioCommand)
    }
  }
}
