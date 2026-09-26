# AGENTS.md

AMCursorTuberKit は、記憶と人格状態（七つの大罪）を持つ AI 配信アバターのデスクトップアプリです。Windows 11 が主な対象で、pnpm のモノレポ構成です。企画と設計の資料は [docs/00_PLAN_README.md](docs/00_PLAN_README.md) から辿れます。

## コマンド

```bash
pnpm install
pnpm dev                                    # 開発起動
pnpm typecheck                              # 全パッケージの型チェック
pnpm test                                   # ユニットテスト（Vitest）
pnpm lint                                   # ESLint（デスクトップ基盤の境界・デザイントークンのルールを含む）
pnpm build                                  # 本番ビルド
pnpm dist:win                               # Windows インストーラー
pnpm --filter @amctk/desktop preview:web    # 画面だけをブラウザで確認（モックAPI、http://localhost:5199/control.html）
```

スモークテスト（ビルド後に `apps/desktop` で実行。画面キャプチャとログを出力して自動で終了します）:

```bash
AMCTK_SMOKE=./smoke-out AMCTK_USER_DATA=./smoke-profile npx electron .
```

## 構成

```text
apps/desktop/src/main/
  index.ts              Electron 版のエントリ（createElectronHost を startApp に渡すだけ）
  app.ts                アプリ本体の起動と配線、IPC ハンドラ（基盤に依存しない）
  host/types.ts         DesktopHost：デスクトップ基盤に求める機能の一覧
  host/electron/        DesktopHost の Electron 実装（Electron の API はここだけ）
  host/stage-layout.ts  ステージのサイズ計算など、基盤に共通の処理
apps/desktop/src/preload/    Electron の IPC で通信の取り決めを実装し、window.amctk を渡す
apps/desktop/src/renderer/   画面。window.amctk だけを使う（ブラウザでも動く）
packages/shared/src/bridge.ts   Renderer ↔ Main の通信の取り決め（チャンネル名と createAmctkApi）
packages/*                   基盤に依存しないロジック（stream-*, core, agent, memory, avatar-* など）
workers/stream-relay         Kick 公式 Webhook の中継（Kick を公式APIで使う場合のみ）
```

## デスクトップ基盤の境界

将来 Electron から別の基盤（Electrobun など）へ移れるよう、基盤への依存を1か所に閉じ込めています。次のルールを守ってください。

- `electron` を import してよいのは `apps/desktop/src/main/host/electron/` と `apps/desktop/src/preload/` だけです。`Electron.*` の型も同じ扱いです。違反すると ESLint（`no-restricted-imports` / `no-restricted-syntax`）がエラーにします。
- Main のほかのコードは、`host/types.ts` の `DesktopHost` を通して基盤の機能を使います。
- 基盤の新しい機能が必要になったら、次の順に作業します。
  1. `host/types.ts` にメソッドを追加する
  2. `host/electron/` に実装する
  3. 下の「基盤に求める機能」の表に追記する
- Renderer ↔ Main の通信を増やすときは、`packages/shared/src/bridge.ts` の `INVOKE` / `SEND` / `PUSH` と `createAmctkApi` に追加します。そのうえで `app.ts` の `api` にハンドラを書きます。`api` は `Record<InvokeKey, Handler>` なので、書き忘れると型エラーになります。preload は変更しません。
- Renderer は `window.amctk` 以外の方法で Main に触れません。Node や Electron の API も使いません。`preview:web` でブラウザ表示できる状態を保ってください。
- `packages/*` は基盤に依存させません。通信には標準の `fetch` / `WebSocket` を使います。基盤の機能が必要な場合は関数として受け取ります（例: `createKickChatroomResolver(fetch)`、`KickPusherOptions.resolveChatroomId`）。
- 純粋な計算（ステージのサイズなど）は `host/electron/` に書きません。`host/stage-layout.ts` のような基盤共通のファイルに置き、テストを付けます。

### 基盤に求める機能（DesktopHost）

| 機能 | 用途 | Electron での実装 |
| --- | --- | --- |
| `windows` | 操作画面とステージの管理。ステージは透明・枠なし・影なし・縦横比固定・常に手前（設定）・背面でも描画を止めない・音声の自動再生可。音声の送り先の切り替え、スモークテスト用の画面キャプチャも含む | `BrowserWindow`（host/electron/windows.ts） |
| `ipc` | Renderer からの呼び出しと一方向メッセージ（送信元ウィンドウの識別つき） | `ipcMain` |
| `dialogs` | 素材の取り込み（ファイル／フォルダの選択、拡張子の絞り込み） | `dialog.showOpenDialog` |
| `shell` | 外部URL（https のみ）とログフォルダを開く | `shell` |
| `secrets` | APIキーなどの暗号化（Windows: DPAPI / macOS: Keychain / Linux: libsecret） | `safeStorage` |
| `browserFetch` | Cloudflare に保護された API の取得（Kick のチャットルームID） | `session.fromPartition('persist:web').fetch` |
| `serveAssets` | `amctk-asset://` の配信。img / video / fetch / script / GLTFLoader から読めること（CORS 許可、ストリーム配信） | `protocol.handle` + `net.fetch` |
| ライフサイクル | 二重起動の防止と既存ウィンドウの前面表示、終了前の後片付け、データフォルダ（userData）の決定 | `app.requestSingleInstanceLock` ほか |
| preload | `window.amctk` を画面より先に注入する（`BridgeTransport` の実装） | `contextBridge` + `ipcRenderer` |

### 基盤ではなく Node の実行環境に依存しているもの

移行先の実行環境（Bun、Cottontail など）でも、次のものが動く必要があります。

- `node:sqlite` の `DatabaseSync`（apps/desktop/src/main/storage.ts）
- `node:fs` / `node:path`（設定・秘密情報・素材・ログの保存）
- `@cursor/sdk`：Node 22.13 以上、`child_process`、N-API アドオン（tree-sitter）、同梱バイナリ（rg / cursorsandbox）

また、`secrets.json` の `enc:` の値は Electron の safeStorage の形式です。基盤を変えると復号できないため、移行時は再入力か変換処理が必要です。

## Electrobun の再検討（2026-09-26 に見送り）

[Electrobun](https://github.com/blackboardsh/electrobun) への移行は見送りました。理由は2つあります。

- 2026-08 の v2 で、実行環境が Bun から Cottontail（0.x）に切り替わったばかりで安定していない
- Windows で、このアプリに必要な機能がそろっていない

次の条件がそろった時点で再検討します。

| # | 条件 | このアプリで必要な理由 | 2026-09-26 時点の状況 |
| --- | --- | --- | --- |
| 1 | WebView2 で音声の自動再生を許可できる | 読み上げ音声を操作なしで鳴らす（Electron では `autoplayPolicy`） | ブラウザの起動フラグ（`chromiumFlags`）は CEF にしか渡せない（[build configuration](https://framework.blackboard.sh/electrobun/apis/cli/build-configuration/)、[WebView2 のフラグ](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags)） |
| 2 | 単一インスタンスロック | 二重起動の防止 | 機能なし（[#465](https://github.com/blackboardsh/electrobun/issues/465)） |
| 3 | ブラウザエンジンの通信処理で fetch できる。または非表示の webview から結果を受け取れる | Kick のチャットルームID取得（Cloudflare 対策） | Electron の `net.fetch` に相当する機能はない |
| 4 | OS の暗号化ストレージを使う API | APIキーなどの保存 | 文書化された API はない |
| 5 | Windows のコード署名と、インストール先の選択やショートカット作成ができるインストーラー | 配布 | 署名は標準のビルド手順に含まれない。インストーラーは ZIP の中の Setup.exe（[code signing](https://framework.blackboard.sh/electrobun/guides/code-signing/)） |
| 6 | 実行環境が安定版になり、`@cursor/sdk` と `node:sqlite` が動く | AI エージェントと DB | Cottontail は 0.x。安定版 2.0.1 は既定の実行環境でビルドが失敗する（[#557](https://github.com/blackboardsh/electrobun/issues/557)） |
| 7 | 日本語を含むパス（ユーザー名）で安定して動く | 日本の利用者 | v2 で修正されたばかり（[#505](https://github.com/blackboardsh/electrobun/issues/505)、[#335](https://github.com/blackboardsh/electrobun/issues/335)） |
| 8 | ステージを OBS のウィンドウキャプチャで取り込め、音声をアプリケーション音声キャプチャで拾える | 配信への出力 | 未検証。WebView2 では音が別プロセス（msedgewebview2.exe）から出る見込み |

再検討は次の手順で進めます。

1. 上の表を最新の状況に更新する。条件がそろっていなければ見送りを続ける。
2. 別ブランチで、`apps/desktop/src/main/host/electrobun/` に `DesktopHost` を、webview 側に `BridgeTransport` を実装する。`app.ts` と `packages/*` は変更しない想定です。
3. 次の3点を確認する。
   - スモークテスト相当の一連の動作
   - 配信コメントの受信（YouTube / Twitch / Kick）
   - OBS での映像と音声の取り込み
4. 秘密情報の移行、インストーラー、自動更新を用意してから切り替える。

## 配信コメントの取得

- **取得方法の切り替え:** YouTube / Twitch / Kick は、設定 `stream.<platform>.source` で取得方法を選びます。`web` は APIキー不要の方法（既定）、`api` は公式APIです。公式APIの実装は、`web` が止まったときの代わりとして残してあります。自動では切り替えません。
- **`web` が止まったときの確認先:** `web` は各サービスの Web 版が内部で使っている仕組みなので、予告なく止まることがあります。止まったら次を確認します。
  - YouTube: `youtubei.js` を更新する（packages/stream-youtube）。仕様変更の手がかりは、ログの `youtube parser error` です。
  - Kick: `packages/stream-kick/src/pusher.ts` の `PUSHER_URL`（接続キー）とイベント名を、kick.com の Web 版と照らし合わせる。
  - Twitch: 匿名 IRC（@twurple/chat）で受信しています。フォロー通知は取れません。
- **Kick のチャンネル情報:** `kick.com/api/v2/channels/{slug}` は、Node の fetch だと Cloudflare に 403 で弾かれます。必ず `DesktopHost.browserFetch` を使ってください。
- **視聴者ID:** 視聴者の記憶は `platform:platformUserId` で引きます。取得方法が違っても、同じ ID を入れてください（YouTube はチャンネルID「UC…」、Twitch と Kick は数値のユーザーID）。

## 書き方の決まり

- **言語:** コメントと UI の文言は日本語で書きます。テスト名も日本語です。
- **テスト:** Vitest を使います。入力データはテストの中に直接書き、`toMatchObject` の部分一致で確認します。
- **秘密情報:** APIキーやトークンは、Main の `SecretService` だけが持ちます。Renderer には「設定済みかどうか」だけを返します。
- **色:** 画面の色は `packages/ui/src/tokens.css` のトークンを使います（ESLint の shadcn ルールで確認されます）。
- **整形:** 新しいファイルは Prettier（.prettierrc.json）で整形します。既存のファイルには Prettier を適用していない箇所があるので、一括整形はせず、周りの書き方に合わせます。
