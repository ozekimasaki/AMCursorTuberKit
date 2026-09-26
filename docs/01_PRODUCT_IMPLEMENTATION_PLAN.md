# AMCursorTuberKit 実装計画書

## 1. プロジェクト概要

### プロジェクト名

**AMCursorTuberKit**

### 製品コンセプト

会話の内容と過去の記憶によって人格状態が少しずつ変動し、その変化が返答、声、表情、モーションに現れるAI配信アバターツール。

キャラクターは以下の4層で捉える。

```text
Memory      過去に何があったか
Personality 元々どんな性格か
State       今どんな状態か
Expression  それをどう見せるか
```

## 2. 最優先ゴール

v0.1では「機能数」よりも、以下のループが安定して回ることを優先する。

```text
Input
 ↓
Recall
 ↓
Conversation
 ↓
Seven Sins Update
 ↓
TTS
 ↓
LipSync / Emotion
 ↓
Avatar
 ↓
Remember
```

## 3. 対象ユーザー

- AI VTuber / AI配信キャラクターを作りたい個人開発者
- AIエージェントを配信へ接続したい開発者
- Live2D / VRM / PNGキャラクターを使ってAI配信を試したいユーザー
- LLMの内部状態を可視化してキャラクター性を作りたいユーザー

## 4. v0.1 機能スコープ

### 4.1 Desktop Application

- Windows 11をPrimary Targetとする
- Control WindowとStage Windowを分離
- 設定の永続化
- 起動時の依存サービスHealth Check
- エラー時に他機能を巻き込まないFailure Isolation

### 4.2 Control Window

主な画面:

- Dashboard
- Avatar
- Voice
- AI / Personality
- Stream Sources
- Memory
- Stage / Output
- Debug

### 4.3 Stage Window

Stageは配信映像専用。

対応:

- Avatar表示
- X / Y位置調整
- Scale調整
- 背景色変更
- 透明背景
- Green / Blue / Magenta等クロマキープリセット
- HUD ON/OFF
- 字幕ON/OFF
- 設定即時反映

Control UIはStageに表示しない。

## 5. Avatar対応

| Avatar | v0.1 | 方針 |
|---|---:|---|
| PNGTuber | 必須 | 最初のVertical Slice |
| VRM | 必須 | Three.js + @pixiv/three-vrm |
| Live2D | 必須 | Cubism SDK for Web |
| MotionPNGTuber | 必須 | 生成済み動画/口トラックを利用 |
| PuruPuru PNGTuber | 必須 | `.purupuru`互換を段階実装 |

### 5.1 MotionPNGTuber

MotionPNGTuberは「ループ動画 + 口スプライト」によって、通常のPNGTuberよりリッチな髪・衣装の動きを表現する方式として扱う。

AMCursorTuberKitは原則として重い前処理を内蔵せず、以下の生成済みアセットを読む方向を優先する。

- mouthless H.264 MP4
- mouth track JSON
- mouth sprites

### 5.2 PuruPuru PNGTuber

PuruPuru方式は以下を特徴とする。

- 表情PNG
- 前髪
- 後ろ髪
- 口パク
- 瞬き
- 顔向き
- 髪揺れ
- PNGアイテム

`.purupuru` は画像と設定を含むポータブルパッケージとして扱う。

## 6. Voice対応

### Primary

VOICEVOX

### Secondary

- AivisSpeech
- Irodori-TTS

TTSはProvider Interfaceで抽象化し、Avatar側はTTS製品名を知らない設計にする。

## 7. Stream Source対応

| Platform | 既定の取得経路（APIキー不要） | 公式APIの取得経路（設定で切替） |
|---|---|---|
| YouTube | Beta: Web版と同じ InnerTube（youtubei.js）。チャンネル指定で配信中の枠を自動検出 | Stable: YouTube Live Streaming API `streamList` |
| Twitch | Stable: 匿名IRC（@twurple/chat）。フォロー通知は取れない | Stable: EventSub WebSocket |
| Kick | Beta: Web版と同じ Pusher WebSocket。チャットルームIDは Electron の通信処理で取得 | Beta: Official Webhook + Cloud Relay |
| TikTok | Experimental: Provider差し替え式。公式対応可能性を継続調査 | — |

YouTube / Kick の既定経路は各サービスの Web 版が内部で使う仕組みのため、仕様変更で止まる可能性がある。止まった場合は利用者が公式APIへ手動で切り替える（自動切替はしない）。
TikTokは一般開発者向けLIVEコメント読取経路が明確でないため、Stable扱いにしない。

## 8. コメント選択

配信コメントをすべてCursor SDKへ送らない。

```text
Stream Events
 ↓
Deduplicate
 ↓
Buffer
 ↓
Local Priority Scoring
 ↓
Interaction Selector
 ↓
Selected Context Only
 ↓
Cursor SDK
```

これによりコスト、レイテンシ、人格の過剰変動を抑える。

## 9. Seven Sins

内部パラメーター:

- Pride / 傲慢
- Greed / 強欲
- Lust / 色欲
- Envy / 嫉妬
- Gluttony / 暴食
- Wrath / 憤怒
- Sloth / 怠惰

各値は0〜100。

各キャラクターは以下を持つ。

```text
baseline = 本来の性格
current  = 現在の状態
```

会話で変動し、時間経過でbaselineへ戻る。

## 10. 長期記憶

Cloudflare Agent Memoryを第一候補とするが、private beta依存でアプリ全体が動かなくなることは避ける。

```text
MemoryProvider
 ├ CloudflareAgentMemoryProvider
 └ LocalMemoryProvider
```

厳密な数値状態はMemoryへ保存せず、ローカルState Storeへ保存する。

Agent Memoryへ保存する対象:

- Viewerの好み
- 過去の出来事
- 関係性に関わるイベント
- 継続中の話題
- キャラクターが覚えておくべき高シグナル会話

## 11. v0.1 非対象

初期版では以下を必須にしない。

- Full Body Tracking
- 高精度WebCam Face Tracking
- OSC / VMC
- 複数キャラクター同時会話
- 自動動画編集
- クラウドGPU必須機能
- TTSモデル学習
- TikTok連携のStable保証
- 全コメントをLLMへ送る処理
- マルチ配信プラットフォームへの自動投稿

## 12. プロダクト上の成功条件

- 配信開始までの設定が短い
- Avatar形式を変更してもAI側を変更しなくてよい
- Voiceを変更してもLipSyncが壊れない
- 配信コメント急増時もLLM呼び出しが暴走しない
- Memoryが落ちても会話が継続する
- HUDを完全に消した配信映像を出せる
- キャラクターの人格変化が「数値だけ」でなく言動に現れる
