import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, safeStorage, session, shell, type OpenDialogOptions } from 'electron'
import type { Logger } from '../../logger'
import type { DesktopHost, HostBoot, IpcHost } from '../types'
import { registerAssetScheme, serveAssets } from './assets'
import { configureCursorSdkPaths } from './cursor-sdk'
import { ElectronWindows, rendererRef, webContentsOf } from './windows'

/**
 * DesktopHost の Electron 実装。Electron の API はこのフォルダと preload だけで使う（ESLint で強制）。
 * ready より前に必要な処理（独自スキームの登録・二重起動の防止・データフォルダの決定）はここで済ませる。
 */
export function createElectronHost(): HostBoot {
  registerAssetScheme()
  configureCursorSdkPaths()
  if (!app.requestSingleInstanceLock()) app.quit()
  // スモークテストでは実データを汚さないよう別フォルダを使う
  if (process.env.AMCTK_USER_DATA) app.setPath('userData', process.env.AMCTK_USER_DATA)

  return {
    userData: app.getPath('userData'),
    async ready(logger: Logger): Promise<DesktopHost> {
      await app.whenReady()
      app.setAppUserModelId('jp.amcursortuberkit.app')

      const iconPath = join(__dirname, '../../build/icon.png')
      const windows = new ElectronWindows(logger.scope('stage'), existsSync(iconPath) ? iconPath : undefined)
      app.on('activate', () => windows.showControl())
      app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') app.quit()
      })

      const ipc: IpcHost = {
        handle: (channel, fn) => ipcMain.handle(channel, (e, ...args) => fn(rendererRef(e.sender), ...args)),
        on: (channel, fn) => ipcMain.on(channel, (e, ...args) => fn(rendererRef(e.sender), ...args)),
      }
      // Cloudflare の Cookie などを次回以降も使えるよう、Web 取得用のセッションはディスクに残す
      const web = session.fromPartition('persist:web')
      const assetLog = logger.scope('avatar')

      return {
        info: {
          label: `Electron ${process.versions.electron}`,
          appVersion: app.getVersion(),
          chrome: process.versions.chrome,
        },
        ipc,
        windows,
        dialogs: {
          async open(owner, o) {
            const win = owner ? BrowserWindow.fromWebContents(webContentsOf(owner)) : null
            const opts: OpenDialogOptions = {
              title: o.title,
              properties: [o.directory ? 'openDirectory' : 'openFile'],
              filters: o.filters,
            }
            const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
            return res.canceled || !res.filePaths.length ? null : res.filePaths
          },
        },
        shell: {
          openExternal: (url) => shell.openExternal(url),
          openPath: async (path) => {
            await shell.openPath(path)
          },
        },
        secrets: {
          get available() {
            return safeStorage.isEncryptionAvailable()
          },
          encrypt: (plain) => safeStorage.encryptString(plain),
          decrypt: (data) => safeStorage.decryptString(data),
        },
        browserFetch: (url, init) => web.fetch(url, init),
        serveAssets: (resolve) => serveAssets(resolve, assetLog),
        onSecondInstance: (cb) => app.on('second-instance', cb),
        onBeforeQuit: (cb) => app.on('before-quit', cb),
        quit: () => app.quit(),
      }
    },
  }
}
