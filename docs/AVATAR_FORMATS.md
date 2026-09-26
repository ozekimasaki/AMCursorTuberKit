# アバター素材の形式

素材は読み込み時に `%APPDATA%\AMCursorTuberKit\assets\<assetId>\` へコピーされ、`amctk-asset://<assetId>/<file>` で参照されます。元のファイルを移動・削除しても表示は変わりません。

## PNGTuber

「アバター」画面のスロットごとに画像を選びます。

| スロット | 用途 | 必須 |
| --- | --- | --- |
| `idle` | 待機（口閉じ） | ○ |
| `talk` | 話し中（口開け） | |
| `idleBlink` / `talkBlink` | まばたき中 | |
| `<emotion>.idle` / `<emotion>.talk` | 表情ごとの差し替え（happy / angry / sad / surprised / relaxed / smug / shy / sleepy） | |

口開けの画像がない場合は、話すときに跳ねる動きだけで表現します。

## MotionPNGTuber

次のファイルが入ったフォルダを選ぶと、ファイル名から役割を自動で割り当てます（画面で変更も可能）。

- ループ動画：口を消したループ動画（H.264 MP4 推奨）
- 口トラックJSON：ファイル名に `track` / `mouth` / `lip` を含むもの
- 口スプライト：`closed` / `half` / `open` を含むPNG

口トラックJSONは次のいずれの形でも読み込めます。

```json
{ "fps": 30, "frames": [{ "x": 410, "y": 620, "w": 120, "h": 60, "rot": 0 }] }
```

```json
{ "fps": 30, "frames": [{ "cx": 470, "cy": 650, "w": 120, "h": 60, "angle": -2 }] }
```

```json
{ "fps": 30, "track": [[410, 620, 120, 60]] }
```

- `quad`（4点）形式、`visible: false` のフレーム（口を描かない）にも対応します
- 座標がすべて 0〜1 の場合は、動画サイズに対する比率として扱います
- `width` / `height` が動画サイズと違う場合は自動で拡大縮小します

## PuruPuru（`.purupuru`）

`.purupuru` は画像と `manifest.json` を含む zip です。フォルダ内の `manifest.json` を直接選ぶこともできます。

```json
{
  "format": "purupuru",
  "version": 1,
  "size": [1000, 1000],
  "layers": { "backHair": "back_hair.png", "body": "body.png", "frontHair": "front_hair.png" },
  "expressions": {
    "neutral": "face.png",
    "happy": "face_happy.png",
    "angry": { "face": "face_angry.png", "eyes": "eyes_angry.png" }
  },
  "eyes": { "open": "eyes_open.png", "closed": "eyes_closed.png" },
  "mouth": { "closed": "mouth_closed.png", "half": "mouth_half.png", "open": "mouth_open.png" },
  "items": [{ "src": "ribbon.png", "attach": "head", "sway": 0.6, "front": true }],
  "pivot": { "hair": [500, 180] },
  "physics": { "hair": 1, "parallax": 1 }
}
```

- すべての画像は同じキャンバスサイズ（`size`）で書き出してください
- 描画順：後ろ髪 → 後ろアイテム → 体 → 顔（表情）→ 目 → 口 → 前髪 → 前アイテム
- 顔向き：ときどき左右を見る動きを、レイヤーごとの視差で表現します（`physics.parallax`）
- 髪揺れ：頭の動きの速さをバネに入力して揺らします（`physics.hair`、支点は `pivot.hair`）
- manifest がない zip / フォルダは、`back_hair` / `front_hair` / `body` / `face_<emotion>` / `eyes_open` / `eyes_closed` / `mouth_open` / `mouth_closed` / `item*` というファイル名から自動で manifest を作ります

## VRM

`.vrm` を1つ選びます。表情は VRM 標準のプリセット（happy / angry / sad / surprised / relaxed / blink / aa）を使います。

| アプリの感情 | VRM の表情 |
| --- | --- |
| happy / angry / sad / surprised / relaxed | 同名のプリセット |
| smug | happy 0.45 + relaxed 0.35 |
| shy | happy 0.5 + relaxed 0.2 |
| sleepy | relaxed 0.7 + blink 0.35 |

口パクは `aa`、まばたきは `blink` を使います。カメラの距離・高さは画面で調整できます。

## Live2D

1. Live2D 公式の「Cubism SDK for Web」から `live2dcubismcore.min.js` を取り出して読み込みます（ライセンス上アプリに同梱できません）
2. `.model3.json` を含むモデルフォルダを読み込みます
3. 必要なら、感情ごとに使う Expression を割り当てます（モデルの Expressions 一覧から選べます）

口パクは既定で `ParamMouthOpenY` を使います。モデルに合わせて画面で変更できます。
