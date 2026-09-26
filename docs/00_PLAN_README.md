# AMCursorTuberKit 計画書

> Cursor SDK + Cloudflare Agent Memory + 7つの大罪パラメーターを中核にした、記憶と人格状態を持つ配信アバターツール。

## 目的

AMCursorTuberKit は、単純な「LLM + TTS + アバター表示」ではなく、会話の積み重ねによって内部状態が変化し、その状態が返答・声・表情・モーションへ反映される配信アバター基盤を目指す。

基本思想は以下。

- ローカルファースト
- 高価な専用GPUを必須にしない
- Avatar / TTS / Memory / Stream Source をProvider/Adapter方式で交換可能にする
- 配信画面と操作画面を分離する
- 7つの大罪を「ゲーム的な内部人格ステート」として保持する
- 長期記憶と厳密な現在値を分離する
- YouTube / Twitch / Kick / TikTok のコメントを共通イベントへ正規化する
- Cursor SDKには必要最小限のCustom Toolだけを公開する
- UIは shadcn/ui + Tailwind CSS v4 を基本とし、@shadcn/lint でデザインシステムを守る

## v0.1 対応予定

### Avatar

- VRM
- Live2D Cubism
- PNGTuber
- MotionPNGTuber互換
- PuruPuru PNGTuber互換

### Voice

- VOICEVOX: Primary
- AivisSpeech: Secondary
- Irodori-TTS: Optional

### Stream Source

- YouTube Live: Web（InnerTube / youtubei.js、既定）/ Official（Data API）
- Twitch: Web（匿名IRC / @twurple/chat、既定）/ Official（EventSub）
- Kick: Web（Pusher、既定）/ Official Webhook + Cloud Relay
- TikTok LIVE: Experimental

### Stage

- X/Y位置調整
- サイズ調整
- 背景色変更
- 透明背景
- クロマキー用プリセット
- HUD表示/非表示
- 設定保存

## ドキュメント

1. [実装計画書](docs/01_PRODUCT_IMPLEMENTATION_PLAN.md)
2. [実装技術計画書](docs/02_TECHNICAL_IMPLEMENTATION_PLAN.md)
3. [アーキテクチャ・データフロー](docs/03_ARCHITECTURE_AND_DATAFLOW.md)
4. [アバターシステム計画](docs/04_AVATAR_SYSTEM.md)
5. [配信コメント連携計画](docs/05_STREAMING_CHAT_INTEGRATION.md)
6. [人格・記憶システム計画](docs/06_PERSONALITY_AND_MEMORY.md)
7. [TTS・音声計画](docs/07_TTS_AND_AUDIO.md)
8. [UI・デザインシステム計画](docs/08_UI_DESIGN_SYSTEM.md)
9. [ロードマップ・テスト計画](docs/09_ROADMAP_AND_TEST_PLAN.md)
10. [セキュリティ・ライセンス・運用](docs/10_SECURITY_LICENSE_AND_OPERATIONS.md)
11. [参照資料](docs/11_REFERENCES.md)

## v0.1 の完成定義

以下の一連の流れが、実際の配信運用で成立すること。

```text
配信コメント / 手入力
        ↓
StreamSource Adapter
        ↓
Comment Buffer / Selector
        ↓
Viewer Memory Recall
        ↓
Seven Sins State
        ↓
Cursor SDK Agent
        ↓
返答 + Sin Delta + Emotion
        ↓
TTS Provider
        ↓
Audio / LipSync
        ↓
Avatar Adapter
        ↓
Stage Window
        ↓
Memory Ingest
```

最初のVertical Sliceでは `手入力 → Cursor SDK → Seven Sins → VOICEVOX → PNGTuber → Stage` を最優先で完成させる。
