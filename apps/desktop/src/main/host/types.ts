import type { AppEvent, AppSettings, AudioCommand, StageSettings } from '@amctk/shared'
import type { Logger } from '../logger'

/*
 * デスクトップ基盤（Electron など）に求める機能の一覧。
 * main のほかのコードはここにある型だけを使い、基盤の API を直接呼ばない。
 * 基盤を変えるときは host/<基盤名>/ にこのインターフェースの実装を作る（AGENTS.md「デスクトップ基盤の境界」）。
 */

/** どのウィンドウ（Renderer）からの呼び出しかを表す。中身は基盤ごとに異なる */
export interface RendererRef {
  readonly __brand: 'RendererRef'
}

export interface IpcHost {
  /** Renderer からの呼び出し（応答あり）。戻り値（Promise可）が Renderer へ返る */
  handle(channel: string, fn: (from: RendererRef, ...args: unknown[]) => unknown): void
  /** Renderer からの一方向メッセージ。同じチャンネルに複数登録できる */
  on(channel: string, fn: (from: RendererRef, ...args: unknown[]) => void): void
}

/** 操作画面（Control）と配信映像用のステージ（Stage）の2ウィンドウ */
export interface WindowHost {
  readonly stageOpen: boolean
  onStageChange?: (open: boolean) => void
  /** 音声を再生するウィンドウが変わったとき */
  onAudioHostChange?: () => void
  onControlClosed?: () => void
  /** 操作画面を開く。既にあれば前面に出す */
  showControl(): void
  /**
   * ステージを開く。透明・枠なし・影なし・縦横比固定・常に手前（設定）・音声の自動再生可・
   * 背面でも描画を止めない、が必要。OBS はタイトル「AMCursorTuberKit Stage」で選ぶ
   */
  openStage(stage: StageSettings): void
  closeStage(): void
  /** 開いているステージへ比率・常に手前の設定を反映する */
  applyStage(stage: StageSettings): void
  /** Renderer が音声を受け取れる状態になった */
  markReady(from: RendererRef): void
  broadcast(event: AppEvent, except?: RendererRef): void
  sendSettings(settings: AppSettings): void
  /** 音声ホスト（ステージが開いていればステージ、なければ操作画面）へ送る。送れなければ false */
  sendAudio(cmd: AudioCommand): boolean
  stopAudioEverywhere(): void
  /** スモークテスト用: ウィンドウの画面を PNG で保存する */
  capture(which: 'control' | 'stage', file: string): Promise<void>
  /** スモークテスト用: 操作画面のページ（#hash）を切り替える */
  showControlPage(page: string): Promise<void>
}

export interface OpenDialogOptions {
  title?: string
  /** true ならフォルダを選ぶ */
  directory?: boolean
  filters?: { name: string; extensions: string[] }[]
}

export interface DialogHost {
  /** ファイル／フォルダを選ぶ。owner は呼び出し元のウィンドウ。キャンセル時は null */
  open(owner: RendererRef | null, options: OpenDialogOptions): Promise<string[] | null>
}

/** OS の暗号化ストレージ（Windows: DPAPI / macOS: Keychain / Linux: libsecret） */
export interface SecretCipher {
  readonly available: boolean
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

export interface ShellHost {
  /** 既定のブラウザで開く（https のみ渡すこと） */
  openExternal(url: string): Promise<void>
  /** ファイルマネージャーでフォルダを開く */
  openPath(path: string): Promise<void>
}

export interface HostInfo {
  /** 表示用の基盤名とバージョン（例: Electron 44.4.5） */
  label: string
  appVersion: string
  chrome: string
}

export interface DesktopHost {
  readonly info: HostInfo
  readonly ipc: IpcHost
  readonly windows: WindowHost
  readonly dialogs: DialogHost
  readonly shell: ShellHost
  readonly secrets: SecretCipher
  /**
   * ブラウザエンジン（Chromium）の通信処理で fetch する。
   * bot対策（Cloudflare）で Node の fetch が弾かれる相手に使う。例: Kick のチャンネル情報
   */
  browserFetch(url: string, init?: RequestInit): Promise<Response>
  /**
   * amctk-asset:// の配信を始める。resolve は URL を配信してよいファイルのパスへ変換する（不可なら null）。
   * img / video / fetch / script / GLTFLoader から読めること（CORS 許可・ストリーム配信）
   */
  serveAssets(resolve: (url: string) => string | null): void
  /** 起動中のアプリをもう一度起動しようとしたとき */
  onSecondInstance(cb: () => void): void
  /** 終了直前。非同期の後片付けは待たない */
  onBeforeQuit(cb: () => void): void
  quit(): void
}

/** 起動の準備（ready の前に必要な処理）を済ませた状態 */
export interface HostBoot {
  /** 設定・ログ・DB を置くフォルダ */
  readonly userData: string
  /** 基盤の起動を待って DesktopHost を返す */
  ready(logger: Logger): Promise<DesktopHost>
}
