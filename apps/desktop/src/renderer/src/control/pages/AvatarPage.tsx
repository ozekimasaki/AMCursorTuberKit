import { useRef, useState } from 'react'
import { ExternalLinkIcon, FolderOpenIcon, ImagePlusIcon, MicIcon, PackageOpenIcon, Trash2Icon, TriangleAlertIcon } from 'lucide-react'
import { toast } from 'sonner'
import { AVATAR_EMOTIONS, EMOTION_META, SIN_KEYS, type AssetImportKind, type AvatarEmotion, type AvatarKind, type ImportedAsset, type SevenSins } from '@amctk/shared'
import { AvatarView } from '@/avatar/AvatarView'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api, isPreview } from '@/lib/api'
import { lipBus } from '@/lib/lip'
import { useRuntime, useSettings } from '@/lib/store'
import { cn } from '@/lib/utils'
import { SettingSlider } from '../components/bits'

const KINDS: { id: AvatarKind; name: string; desc: string; emoji: string }[] = [
  { id: 'builtin', name: '組み込み', desc: '猫耳メイド・画像不要', emoji: '🐱' },
  { id: 'png', name: 'PNGTuber', desc: '口閉じ/口開けの画像', emoji: '🖼️' },
  { id: 'motion-png', name: 'MotionPNG', desc: 'ループ動画＋口トラック', emoji: '🎞️' },
  { id: 'purupuru', name: 'PuruPuru', desc: '髪揺れ・表情PNG', emoji: '🍡' },
  { id: 'vrm', name: 'VRM', desc: '3Dモデル', emoji: '🧸' },
  { id: 'live2d', name: 'Live2D', desc: 'Cubism モデル', emoji: '✨' },
]

const PALETTES = [
  { id: 'cocoa', name: 'ココア', color: '#5a3a2c' },
  { id: 'strawberry', name: 'いちご', color: '#f5a3bf' },
  { id: 'mint', name: 'ミント', color: '#92d8bf' },
  { id: 'lemon', name: 'レモン', color: '#f6cf6a' },
  { id: 'grape', name: 'ぶどう', color: '#c2aef6' },
] as const

const PNG_SLOTS = [
  { slot: 'idle', label: '待機（口閉じ）', required: true },
  { slot: 'talk', label: '話し中（口開け）' },
  { slot: 'idleBlink', label: 'まばたき（口閉じ）' },
  { slot: 'talkBlink', label: 'まばたき（口開け）' },
]

const NEUTRAL = Object.fromEntries(SIN_KEYS.map((k) => [k, 50])) as SevenSins
const NEUTRAL_EMOTION = { emotion: 'neutral' as const, intensity: 0.5 }

async function importAsset(kind: AssetImportKind, options?: { assetId?: string; slot?: string }): Promise<ImportedAsset | null> {
  if (isPreview) {
    toast('ブラウザプレビューでは読み込めません。アプリ版で試してください')
    return null
  }
  try {
    return await api.assets.import(kind, options)
  } catch (err) {
    toast.error(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    return null
  }
}

function assetImg(assetId: string | undefined, file: string | undefined) {
  return assetId && file ? `amctk-asset://${assetId}/${encodeURIComponent(file)}` : undefined
}

function PngSettings() {
  const [settings, update] = useSettings()
  if (!settings) return null
  const png = settings.avatar.png
  const pick = async (slot: string) => {
    const r = await importAsset('png-slot', { assetId: png.assetId, slot })
    if (r) update({ avatar: { png: { assetId: r.assetId, slots: { [slot]: r.detected[slot] } } } })
  }
  const clear = (slot: string) => update({ avatar: { png: { slots: { [slot]: '' } } } })
  const row = (slot: string, label: string, required?: boolean) => {
    const file = png.slots[slot]
    return (
      <Item key={slot} size="sm" variant="outline" className="rounded-xl">
        <ItemMedia variant="image" className="size-11 rounded-lg bg-muted">
          {file ? <img src={assetImg(png.assetId, file)} alt="" className="object-contain" /> : <ImagePlusIcon className="text-muted-foreground" />}
        </ItemMedia>
        <ItemContent className="gap-0">
          <ItemTitle className="text-xs">
            {label}
            {required && <Badge variant="secondary">必須</Badge>}
          </ItemTitle>
          <ItemDescription className="text-2xs">{file ?? '未設定'}</ItemDescription>
        </ItemContent>
        <ItemActions>
          {file && (
            <Button variant="ghost" size="icon-xs" aria-label="外す" onClick={() => clear(slot)}>
              <Trash2Icon />
            </Button>
          )}
          <Button variant="outline" size="xs" onClick={() => void pick(slot)}>
            選ぶ
          </Button>
        </ItemActions>
      </Item>
    )
  }
  return (
    <FieldGroup>
      <ItemGroup className="gap-1.5">{PNG_SLOTS.map((s) => row(s.slot, s.label, s.required))}</ItemGroup>
      <Collapsible>
        <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="self-start" />}>表情ごとの画像（任意）</CollapsibleTrigger>
        <CollapsibleContent>
          <ItemGroup className="mt-2 gap-1.5">
            {AVATAR_EMOTIONS.filter((e) => e !== 'neutral').flatMap((e) => [
              row(`${e}.idle`, `${EMOTION_META[e].emoji} ${EMOTION_META[e].ja}（口閉じ）`),
              row(`${e}.talk`, `${EMOTION_META[e].emoji} ${EMOTION_META[e].ja}（口開け）`),
            ])}
          </ItemGroup>
        </CollapsibleContent>
      </Collapsible>
      <SettingSlider label="話すときの跳ね" value={png.bounce} min={0} max={2} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => update({ avatar: { png: { bounce: v } } })} />
    </FieldGroup>
  )
}

function FileRoleSelect({ label, value, files, onChange }: { label: string; value?: string; files: string[]; onChange: (v: string) => void }) {
  const items = [{ value: '', label: '（なし）' }, ...files.map((f) => ({ value: f, label: f }))]
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      {files.length ? (
        <Select items={items} value={value ?? ''} onValueChange={(v) => onChange(String(v ?? ''))}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {items.map((i) => (
                <SelectItem key={i.value || 'none'} value={i.value}>
                  {i.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      ) : (
        <Input value={value ?? ''} readOnly placeholder="フォルダを読み込むと選べます" />
      )}
    </Field>
  )
}

function MotionPngSettings() {
  const [settings, update] = useSettings()
  const [files, setFiles] = useState<string[]>([])
  if (!settings) return null
  const m = settings.avatar.motionPng
  const load = async () => {
    const r = await importAsset('motion-png')
    if (!r) return
    setFiles(r.files)
    update({ avatar: { motionPng: { assetId: r.assetId, video: r.detected.video, track: r.detected.track, mouthClosed: r.detected.mouthClosed, mouthHalf: r.detected.mouthHalf, mouthOpen: r.detected.mouthOpen } } })
    toast.success('MotionPNGTuber の素材を読み込みました')
  }
  const set = (key: string) => (v: string) => update({ avatar: { motionPng: { [key]: v } } })
  const media = files.filter((f) => /\.(mp4|webm|mov)$/i.test(f))
  const json = files.filter((f) => /\.json$/i.test(f))
  const imgs = files.filter((f) => /\.(png|webp|gif|jpe?g)$/i.test(f))
  return (
    <FieldGroup>
      <Button variant="secondary" className="self-start" onClick={() => void load()}>
        <FolderOpenIcon data-icon="inline-start" />
        素材フォルダを読み込む
      </Button>
      <FieldDescription>口なしループ動画（H.264 MP4）・口トラックJSON・口スプライト（closed / half / open）が入ったフォルダを選びます。ファイル名から自動で割り当てます。</FieldDescription>
      <FileRoleSelect label="ループ動画" value={m.video} files={media} onChange={set('video')} />
      <FileRoleSelect label="口トラック" value={m.track} files={json} onChange={set('track')} />
      <div className="grid grid-cols-3 gap-2">
        <FileRoleSelect label="口・閉じ" value={m.mouthClosed} files={imgs} onChange={set('mouthClosed')} />
        <FileRoleSelect label="口・半開き" value={m.mouthHalf} files={imgs} onChange={set('mouthHalf')} />
        <FileRoleSelect label="口・開き" value={m.mouthOpen} files={imgs} onChange={set('mouthOpen')} />
      </div>
    </FieldGroup>
  )
}

function PuruPuruSettings() {
  const [settings, update] = useSettings()
  if (!settings) return null
  const p = settings.avatar.purupuru
  const load = async () => {
    const r = await importAsset('purupuru')
    if (!r) return
    update({ avatar: { purupuru: { assetId: r.assetId, manifest: r.detected.manifest ?? 'manifest.json' } } })
    toast.success('PuruPuru パッケージを読み込みました')
  }
  return (
    <FieldGroup>
      <Button variant="secondary" className="self-start" onClick={() => void load()}>
        <PackageOpenIcon data-icon="inline-start" />
        .purupuru を読み込む
      </Button>
      <FieldDescription>
        .purupuru（zip）または manifest.json を選びます。manifest がない場合は back_hair / front_hair / body / face_happy / eyes_open / mouth_open などのファイル名から自動で組み立てます。
      </FieldDescription>
      {p.assetId && (
        <Item size="sm" variant="muted" className="rounded-xl">
          <ItemContent>
            <ItemTitle className="text-xs">読み込み済み</ItemTitle>
            <ItemDescription className="text-2xs">{p.manifest}</ItemDescription>
          </ItemContent>
        </Item>
      )}
    </FieldGroup>
  )
}

function VrmSettings() {
  const [settings, update] = useSettings()
  if (!settings) return null
  const v = settings.avatar.vrm
  const load = async () => {
    const r = await importAsset('vrm')
    if (r) update({ avatar: { vrm: { assetId: r.assetId, file: r.detected.vrm } } })
  }
  return (
    <FieldGroup>
      <Button variant="secondary" className="self-start" onClick={() => void load()}>
        <FolderOpenIcon data-icon="inline-start" />
        .vrm を読み込む
      </Button>
      {v.file && <FieldDescription>読み込み済み: {v.file}</FieldDescription>}
      <SettingSlider label="カメラの距離" value={v.cameraDistance} min={0.4} max={5} step={0.05} format={(n) => `${n.toFixed(2)}m`} onChange={(n) => update({ avatar: { vrm: { cameraDistance: n } } })} />
      <SettingSlider label="カメラの高さ" value={v.cameraHeight} min={0.2} max={2} step={0.01} format={(n) => `${n.toFixed(2)}m`} onChange={(n) => update({ avatar: { vrm: { cameraHeight: n } } })} />
    </FieldGroup>
  )
}

function Live2DSettings() {
  const [settings, update] = useSettings()
  const [expressions, setExpressions] = useState<string[]>([])
  if (!settings) return null
  const l = settings.avatar.live2d
  const loadCore = async () => {
    const r = await importAsset('live2d-core')
    if (r) update({ avatar: { live2d: { coreAssetId: r.assetId, coreFile: r.detected.core } } })
  }
  const loadModel = async () => {
    const r = await importAsset('live2d')
    if (!r) return
    const exprs = Object.keys(r.detected).filter((k) => k.startsWith('expr:')).map((k) => r.detected[k])
    setExpressions(exprs)
    update({ avatar: { live2d: { assetId: r.assetId, modelFile: r.detected.model } } })
    toast.success(`Live2D モデルを読み込みました${exprs.length ? `（表情 ${exprs.length}個）` : ''}`)
  }
  const exprItems = [{ value: '', label: '（なし）' }, ...expressions.map((e) => ({ value: e, label: e }))]
  return (
    <FieldGroup>
      <Alert>
        <TriangleAlertIcon />
        <AlertTitle>Cubism Core はご自身で入手してください</AlertTitle>
        <AlertDescription>
          ライセンス上アプリに同梱できないため、Live2D公式の「Cubism SDK for Web」から live2dcubismcore.min.js を取り出して読み込みます。
          <button type="button" className="font-bold text-primary hover:underline" onClick={() => void api.app.openExternal('https://www.live2d.com/sdk/download/web/')}>
            ダウンロードページ <ExternalLinkIcon className="inline size-3" />
          </button>
        </AlertDescription>
      </Alert>
      <div className="flex flex-wrap gap-2">
        <Button variant={l.coreFile ? 'outline' : 'secondary'} onClick={() => void loadCore()}>
          1. Cubism Core を選ぶ{l.coreFile ? '（済）' : ''}
        </Button>
        <Button variant={l.modelFile ? 'outline' : 'secondary'} onClick={() => void loadModel()}>
          2. モデルフォルダを選ぶ{l.modelFile ? '（済）' : ''}
        </Button>
      </div>
      {l.modelFile && <FieldDescription>モデル: {l.modelFile}</FieldDescription>}
      <Field>
        <FieldLabel htmlFor="l2d-mouth">口パクのパラメーターID</FieldLabel>
        <Input id="l2d-mouth" value={l.mouthParam} onChange={(e) => update({ avatar: { live2d: { mouthParam: e.target.value } } })} />
      </Field>
      <Collapsible>
        <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="self-start" />}>感情と表情(Expression)の対応</CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {AVATAR_EMOTIONS.filter((e) => e !== 'neutral').map((e) => (
              <Field key={e}>
                <FieldLabel className="text-xs">
                  {EMOTION_META[e].emoji} {EMOTION_META[e].ja}
                </FieldLabel>
                {expressions.length ? (
                  <Select items={exprItems} value={l.expressionMap[e] ?? ''} onValueChange={(v) => update({ avatar: { live2d: { expressionMap: { [e]: String(v ?? '') } } } })}>
                    <SelectTrigger size="sm" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {exprItems.map((i) => (
                          <SelectItem key={i.value || 'none'} value={i.value}>
                            {i.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input className="h-7 text-xs" value={l.expressionMap[e] ?? ''} placeholder="Expression名" onChange={(ev) => update({ avatar: { live2d: { expressionMap: { [e]: ev.target.value } } } })} />
                )}
              </Field>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </FieldGroup>
  )
}

export function AvatarPage() {
  const [settings, update] = useSettings()
  const runtimeEmotion = useRuntime((r) => r.emotion, NEUTRAL_EMOTION)
  const sins = useRuntime((r) => r.sins.current, NEUTRAL)
  const speaking = useRuntime((r) => r.speaking, false)
  const [preview, setPreview] = useState<AvatarEmotion | null>(null)
  const [error, setError] = useState<string | null>(null)
  const lipTimer = useRef<ReturnType<typeof setInterval>>(undefined)
  if (!settings) return null
  const a = settings.avatar
  const emotion = preview ?? runtimeEmotion.emotion

  const lipTest = () => {
    clearInterval(lipTimer.current)
    const start = performance.now()
    lipTimer.current = setInterval(() => {
      const t = (performance.now() - start) / 1000
      lipBus.set(t > 2.4 ? 0 : Math.max(0, Math.sin(t * 14) * 0.5 + 0.45 + Math.sin(t * 5) * 0.2))
      if (t > 2.4) clearInterval(lipTimer.current)
    }, 30)
  }

  return (
    <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>アバターの形式</CardTitle>
          <CardDescription>形式を変えても、AIや声の設定はそのまま使えます</CardDescription>
        </CardHeader>
        <CardContent>
          <ToggleGroup
            value={[a.kind]}
            onValueChange={(v) => v[0] && update({ avatar: { kind: v[0] as AvatarKind } })}
            variant="outline"
            className="grid w-full grid-cols-3 gap-2 md:grid-cols-6"
          >
            {KINDS.map((k) => (
              <ToggleGroupItem key={k.id} value={k.id} className="h-auto flex-col whitespace-normal gap-1 rounded-2xl px-2 py-3">
                <span className="text-2xl leading-none">{k.emoji}</span>
                <span className="text-sm font-extrabold">{k.name}</span>
                <span className="text-2xs font-medium opacity-70">{k.desc}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </CardContent>
      </Card>

      <Card className="gap-0 overflow-hidden py-0">
        <div className="relative aspect-square bg-gradient-to-b from-candy-sky-soft via-card to-candy-pink-soft">
          <div className="absolute inset-x-8 top-6 bottom-0">
            <AvatarView avatar={a} emotion={emotion} intensity={0.8} sins={sins} speaking={speaking} onError={setError} />
          </div>
        </div>
        <div className="flex flex-col gap-3 border-t p-4">
          {error && (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertTitle>読み込めませんでした（仮のアバターを表示中）</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-muted-foreground">表情のテスト</span>
            <Button variant="outline" size="sm" onClick={lipTest}>
              <MicIcon data-icon="inline-start" />
              口パクテスト
            </Button>
          </div>
          <ToggleGroup
            value={preview ? [preview] : []}
            onValueChange={(v) => setPreview((v[0] as AvatarEmotion) ?? null)}
            size="sm"
            variant="outline"
            className="flex w-full flex-wrap gap-1"
          >
            {AVATAR_EMOTIONS.map((e) => (
              <ToggleGroupItem key={e} value={e} className="gap-1 rounded-full px-2.5 text-xs">
                {EMOTION_META[e].emoji} {EMOTION_META[e].ja}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-2xs text-muted-foreground">選ばないときは、いまの配信中の表情が表示されます</p>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{KINDS.find((k) => k.id === a.kind)?.name} の設定</CardTitle>
          <CardDescription>素材はアプリのフォルダにコピーして使うので、元のファイルを動かしても大丈夫です</CardDescription>
        </CardHeader>
        <CardContent>
          {a.kind === 'builtin' && (
            <FieldGroup>
              <Field>
                <FieldLabel>髪とリボンの色</FieldLabel>
                <ToggleGroup
                  value={[a.builtin.palette]}
                  onValueChange={(v) => v[0] && update({ avatar: { builtin: { palette: v[0] as (typeof PALETTES)[number]['id'] } } })}
                  variant="outline"
                  className="grid w-full grid-cols-5 gap-2"
                >
                  {PALETTES.map((p) => (
                    <ToggleGroupItem key={p.id} value={p.id} className="h-auto flex-col whitespace-normal gap-1.5 rounded-2xl py-3">
                      <span className={cn('size-7 rounded-full shadow-inner')} style={{ background: p.color }} />
                      <span className="text-xs font-bold">{p.name}</span>
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Field>
              <FieldDescription>組み込みアバター「キャットリン」は、表情と七つの大罪の状態に合わせて、耳の角度・しっぽの振り方・まばたき・揺れ方が変わります。</FieldDescription>
            </FieldGroup>
          )}
          {a.kind === 'png' && <PngSettings />}
          {a.kind === 'motion-png' && <MotionPngSettings />}
          {a.kind === 'purupuru' && <PuruPuruSettings />}
          {a.kind === 'vrm' && <VrmSettings />}
          {a.kind === 'live2d' && <Live2DSettings />}
        </CardContent>
      </Card>
    </div>
  )
}
