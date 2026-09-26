import { startApp } from './app'
import { createElectronHost } from './host/electron'

// Electron 版のエントリ。アプリ本体（startApp）は基盤に依存せず、DesktopHost 経由で Electron を使う
void startApp(createElectronHost())
