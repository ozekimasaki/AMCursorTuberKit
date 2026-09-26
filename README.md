# AMCursorTuberKit

会話の内容と過去の記憶によって人格状態（七つの大罪）が少しずつ変わり、その変化が返答・声・表情・動きに表れるAI配信アバターのデスクトップアプリです。

- 操作画面（Control Window）と配信映像専用画面（Stage Window）を分けています
- 初期キャラクターは、月灯りのティーサロンから来た猫耳メイドの「キャットリン」です。画像なしで動く組み込みアバターで、表情に合わせて耳の角度やしっぽの振り方も変わります
- AI は Cursor SDK の Local Agent を使います。未設定でもデモ応答（キャットリンの口調）で一通り試せます
- Avatar / TTS / Memory / Stream Source はすべて差し替え可能な Provider / Adapter 構成です

計画書は [docs/](docs/) にあります（[実装計画書](docs/01_PRODUCT_IMPLEMENTATION_PLAN.md) / [実装技術計画書](docs/02_TECHNICAL_IMPLEMENTATION_PLAN.md)）。

## 動作環境

| 項目 | 内容 |
| --- | --- |
| OS | Windows 11（v0.1 の検証対象）。macOS / Linux 向けのビルド設定も用意済み（未検証） |
| 開発時 | Node.js 22.13 以上、pnpm 10 |
| 実行時 | Electron 44（Node 24 同梱。Cursor SDK の要件 Node 22.13+ を満たします） |
| 読み上げ | VOICEVOX（推奨）/ AivisSpeech / Irodori-TTS などのHTTPサーバー / OS標準音声 |

## はじめ方

```bash
pnpm install
pnpm dev
```

起動したら、ダッシュボードの「はじめにやること」に沿って進めます。

1. **声をつなぐ**：VOICEVOX を起動すると自動で接続されます（`http://127.0.0.1:50021`）
2. **AIをつなぐ（任意）**：「AI・性格」で Cursor SDK を選び、API Key を保存してモデルを読み込みます
3. **ステージを開く**：OBS の「ウィンドウキャプチャ」で `AMCursorTuberKit Stage` を取り込みます。背景を抜く場合はクロマキー背景にし、OBS のクロマキーフィルタを追加してください。音声は「アプリケーション音声キャプチャ」で取り込めます

### インストーラーの作成（Windows）

```bash
pnpm dist:win
```

`apps/desktop/release/AMCursorTuberKit-0.1.0-Setup.exe` が作成されます（約108MB。大半は Electron 本体です）。

## 主な機能

| 画面 | できること |
| --- | --- |
| ダッシュボード | ライブ会話、手入力（AIに話しかける／そのまま読ませる）、七つの大罪レーダー、表情つきアバタープレビュー、コメント待ちキュー、各機能の動作状況 |
| ステージ・出力 | 位置（ドラッグ）・大きさ（ホイール）、背景色／クロマキー（グリーン・ブルー・マゼンタ）／透明、字幕、HUD、比率（横HD・FHD・縦・正方形）、常に手前に表示 |
| アバター | 組み込み（キャットリン・4色）/ PNGTuber / MotionPNGTuber / PuruPuru / VRM / Live2D の切り替え、表情と口パクのテスト |
| ボイス | エンジン選択、話者、速さ・高さ・抑揚・音量、気分を声に反映 |
| AI・性格 | Cursor SDK 接続、モデル選択、Web検索のオン／オフ、呼び出し回数の上限、キャラクター設定（初期値に戻す）、七つの大罪の本来の値・戻る速さ・1回の最大変化量 |
| 記憶 | ローカル（SQLite）/ Cloudflare Agent Memory、視聴者ごとの記憶の確認・追加・削除 |
| 配信サービス | YouTube Live（Stable）/ Twitch（Stable）/ Kick（Beta）/ TikTok LIVE（Experimental）、コメントの選び方 |
| デバッグ | 動作状況の再チェック、内部状態の手動操作、テーマ、ログ・イベント |

## 処理の流れ

```text
配信コメント / 手入力
  → StreamSource Adapter（プラットフォームごとに独立）
  → 重複排除 → バッファ → ローカルでスコアリング → 1件だけ選ぶ（InteractionSelector）
  → 視聴者の記憶を思い出す（タイムアウト付き。失敗しても続行）
  → Cursor SDK Agent（返答 + 感情 + 七つの大罪の変化の「提案」）
  → 提案値を検証・Clampして状態へ反映（SevenSinsEngine）
  → 文ごとに区切って TTS へ（最初の1文から再生開始）
  → 音量ベースの口パク + 表情 → Avatar Adapter → Stage
  → 記憶へ保存（非同期）
```

- **コメント急増時**：50件のコメントが一度に届いても、LLM呼び出しは1回に抑え、スーパーチャットを優先して選ぶことをスモークテストで確認しています
- **七つの大罪**：各値 0〜100。会話で動き、半減期に従って本来の値へ戻ります。高い値は返答の傾向（プロンプト）、声色（速さ・抑揚）、表情、動き（跳ね方・まばたき・揺れ）に反映されます
- **Cursor SDK の権限**：Agent に渡すのは次のものだけです。シェル・ファイル操作は許可リストに入れず、`disallowedTools` でも明示的に外しています。`settingSources: []` でユーザー環境のMCP設定も読み込みません
  - Custom Tool：`get_character_state` / `get_viewer_context` / `propose_sin_delta` / `set_emotion`
  - Web検索（`webSearch`）・Webページ取得（`webFetch`）：「AI・性格」画面でオン／オフできます（既定はオン）。Webページや視聴者が貼ったURLに書かれた指示には従わないよう、プロンプトで指示しています

## 障害の切り分け（Failure Isolation）

| 落ちたもの | 挙動 |
| --- | --- |
| 記憶（Cloudflare） | ローカル記憶へ自動で切り替えて会話を続行（60秒後に再試行） |
| 読み上げ | 字幕だけで進行。数秒間は合成を試さず、毎文タイムアウトを待たない |
| アバター | 組み込みアバターで表示を続け、音声・AIはそのまま |
| 配信プラットフォーム | そのプラットフォームだけ再接続（指数バックオフ）。他は継続 |
| Cursor Agent | そのターンだけデモ応答で返し、配信を止めない |

## セキュリティ

- Cursor API Key・Cloudflare API Token・Twitch/YouTube/Kick の認証情報は Main Process の `SecretService` だけが保持し、OSの暗号化ストレージ（Windows: DPAPI）で暗号化して保存します。Renderer には「設定済みかどうか」だけを返します
- ログは構造化（JSON Lines）で、トークンらしき文字列は自動で伏せ字にします
- Renderer は `contextIsolation` + `sandbox` 有効。アバター素材はアプリのフォルダへコピーし、`amctk-asset://` 経由でのみ読み込みます（それ以外のパスは読めません）
- YouTube の API Key はURLではなくヘッダーで送ります

## 配信サービスの設定

| サービス | 必要なもの |
| --- | --- |
| YouTube Live | YouTube Data API v3 の API Key、配信URL（または動画ID / liveChatId）。`streamList` で受信し、使えない場合はポーリングへ自動で切り替えます |
| Twitch | Developer Console で「Public」クライアントとして登録した Client ID（Device Code Grant を有効化）、チャンネル名。「Twitchでログイン」でコードを入力します（Client Secret 不要） |
| Kick | [workers/stream-relay](workers/stream-relay) を Cloudflare にデプロイし、Kick の Webhook URL に `https://<worker>/webhook` を設定。アプリには Relay URL と Relay Secret を入力します |
| TikTok LIVE | TikFinity などのブリッジが流す WebSocket（既定 `ws://127.0.0.1:21213`）を受け取ります。公式な取得手段が明確でないため Experimental 扱いです |

Kick Relay のデプロイ:

```bash
cd workers/stream-relay
npx wrangler@4 secret put RELAY_SECRET
npx wrangler@4 deploy
```

Worker は Kick の公開鍵で署名（`Kick-Event-Signature`）を検証してから、認証済みのアプリだけに中継します。

## アバター素材の形式

詳しくは [docs/AVATAR_FORMATS.md](docs/AVATAR_FORMATS.md) を参照してください。

- **PNGTuber**：待機（口閉じ）1枚があれば動きます。口開け・まばたき・表情ごとの画像は任意
- **MotionPNGTuber**：口なしループ動画（H.264 MP4）+ 口トラックJSON + 口スプライト（閉じ／半開き／開き）のフォルダ
- **PuruPuru**：`.purupuru`（zip）または `manifest.json`。manifest がなくてもファイル名から自動で組み立てます
- **VRM**：`.vrm` ファイル（VRM 0.x / 1.0）
- **Live2D**：`.model3.json` を含むフォルダ + Cubism Core（`live2dcubismcore.min.js`）。Cubism Core はライセンス上同梱できないため、公式の Cubism SDK for Web から取り出して読み込んでください

## 開発

```bash
pnpm test          # ユニットテスト（Vitest）
pnpm lint          # ESLint + @shadcn/lint（デザイントークン以外の色を禁止）
pnpm typecheck     # 全パッケージの型チェック
pnpm --filter @amctk/desktop preview:web   # ブラウザだけでUIを確認（モックAPI）
```

### スモークテスト（実アプリでの一連の動作確認）

環境変数を付けて起動すると、手入力 → Agent → 七つの大罪 → TTS → Stage の流れと、コメント50件の急増テストを自動で行い、全画面のスクリーンショットとログを保存して終了します。実データを汚さないよう、別の userData を指定してください。

```bash
cd apps/desktop
pnpm build
AMCTK_SMOKE=./smoke-out AMCTK_USER_DATA=./smoke-profile npx electron .
```

### 構成

```text
apps/desktop            Electron アプリ（main / preload / renderer: control・stage）
packages/shared         型・設定スキーマ（Zod）・IPC API 定義
packages/core           EventBus / SevenSinsEngine / InteractionSelector / SentenceSegmenter / メタ情報パーサー
packages/personality    状態 → プロンプト・声色・動きへの変換
packages/agent          Cursor SDK Agent（Custom Tool）/ デモ応答
packages/memory         ローカル記憶 / Cloudflare Agent Memory / フォールバック
packages/audio          TTS Provider（VOICEVOX互換・HTTP汎用・OS標準）/ 口パク解析
packages/stream-*       YouTube / Twitch / Kick / TikTok Adapter
packages/avatar-*       組み込み / PNG / MotionPNG / PuruPuru / VRM / Live2D Adapter
packages/ui             デザイントークン（tokens.css）
workers/stream-relay    Kick Webhook 中継（Cloudflare Worker + Durable Object）
```

UI は shadcn/ui（Base UI）+ Tailwind CSS v4。色・角丸・動きのカーブは [packages/ui/src/tokens.css](packages/ui/src/tokens.css) のトークンから使います。

### データの保存場所

`%APPDATA%\AMCursorTuberKit\` に、設定（`settings.json`）、暗号化済みの認証情報（`secrets.json`）、SQLite（`data/amctk.sqlite`）、アバター素材（`assets/`）、ログ（`logs/`）を保存します。Cursor SDK の Agent Store は、アプリ本体のDBとは分けて `cursor-agent-store/` に保存します（ホーム配下の既定の場所には依存しません）。

## v0.1 時点の制約

- VRM / Live2D / MotionPNGTuber は、実際のモデル・素材ファイルでの表示確認がまだです（読み込み処理と失敗時のフォールバックは確認済み）
- Cloudflare Agent Memory は private beta の HTTP API に合わせて実装しています。レスポンス形式が変わっても落ちないよう緩く解釈し、失敗時はローカル記憶を使います
- Cursor SDK の `systemPrompt` はサーバー側で利用が制限されているため、キャラクター設定は毎ターンのメッセージに含めています
- macOS / Linux 版はビルド設定のみで、動作は未検証です

## ライセンス

[MIT License](LICENSE)

同梱していない外部の素材・ソフトウェア（Live2D Cubism Core、VOICEVOX の音声、各アバターモデルなど）は、それぞれの利用規約に従ってください。
