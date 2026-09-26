import { useRef } from 'react'
import { InfoIcon, MonitorPlayIcon, MoveIcon, RotateCcwIcon } from 'lucide-react'
import { CHROMA_PRESETS, SIN_KEYS, type ChromaPreset, type SevenSins } from '@amctk/shared'
import { AvatarView } from '@/avatar/AvatarView'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldSeparator } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api } from '@/lib/api'
import { useRuntime, useSettings } from '@/lib/store'
import { SettingSlider } from '../components/bits'

const NEUTRAL = Object.fromEntries(SIN_KEYS.map((k) => [k, 50])) as SevenSins
const NEUTRAL_EMOTION = { emotion: 'neutral' as const, intensity: 0.5 }
const SWATCHES = ['#fff4f8', '#fff9e6', '#eefaf5', '#f3efff', '#eaf5ff', '#ffffff', '#2b2233']
const SIZES = [
  { id: '1280x720', label: '1280×720', hint: '横 HD' },
  { id: '1920x1080', label: '1920×1080', hint: '横 FHD' },
  { id: '1080x1920', label: '1080×1920', hint: '縦（ショート）' },
  { id: '1080x1080', label: '1080×1080', hint: '正方形' },
]
const CHROMA_LABEL: Record<ChromaPreset, string> = { green: 'グリーン', blue: 'ブルー', magenta: 'マゼンタ' }

function StagePreview() {
  const [settings, update] = useSettings()
  const emotion = useRuntime((r) => r.emotion, NEUTRAL_EMOTION)
  const sins = useRuntime((r) => r.sins.current, NEUTRAL)
  const speaking = useRuntime((r) => r.speaking, false)
  const frame = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; sx: number; sy: number } | null>(null)
  if (!settings) return null
  const st = settings.stage
  const bg =
    st.background.mode === 'transparent'
      ? undefined
      : st.background.mode === 'chroma'
        ? CHROMA_PRESETS[st.background.chroma]
        : st.background.color

  const onPointerDown = (e: React.PointerEvent) => {
    if (drag.current) return
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, sx: st.x, sy: st.y }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    const el = frame.current
    if (!d || !el) return
    const r = el.getBoundingClientRect()
    const clamp = (v: number) => Math.max(-1, Math.min(1, Math.round(v * 100) / 100))
    update({ stage: { x: clamp(d.sx + ((e.clientX - d.x) / r.width) * 2), y: clamp(d.sy - ((e.clientY - d.y) / r.height) * 2) } })
  }
  const onPointerUp = () => (drag.current = null)
  const onWheel = (e: React.WheelEvent) => {
    const next = Math.max(0.1, Math.min(4, Math.round((st.scale - e.deltaY * 0.001) * 100) / 100))
    update({ stage: { scale: next } })
  }

  return (
    <div
      ref={frame}
      className="relative w-full overflow-hidden rounded-2xl border shadow-soft"
      style={{
        aspectRatio: `${st.width} / ${st.height}`,
        maxHeight: 'calc(100vh - 16rem)',
        background: bg ?? 'repeating-conic-gradient(var(--muted) 0% 25%, var(--card) 0% 50%) 50% / 22px 22px',
      }}
    >
      <div
        className="absolute inset-x-0 bottom-0 h-[92%] cursor-grab touch-none active:cursor-grabbing"
        style={{ transform: `translate(${st.x * 50}%, ${-st.y * 50}%) scale(${st.scale})`, transformOrigin: '50% 100%' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        <AvatarView avatar={settings.avatar} emotion={emotion.emotion} intensity={emotion.intensity} sins={sins} speaking={speaking} />
      </div>
      {st.subtitles && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[5%] flex justify-center px-[6%]">
          <div
            className="rounded-[1.4em] border-[0.14em] border-primary bg-card/95 px-[1.1em] py-[0.5em] font-extrabold shadow-soft"
            style={{ fontSize: `calc(${st.subtitleSize}px * 0.55)` }}
          >
            字幕はここに表示されます
          </div>
        </div>
      )}
      <div className="pointer-events-none absolute top-2 right-2 flex items-center gap-1 rounded-full bg-card/85 px-2 py-1 text-2xs font-bold text-muted-foreground">
        <MoveIcon className="size-3" /> ドラッグで移動・ホイールで拡大
      </div>
    </div>
  )
}

export function StagePage() {
  const [settings, update] = useSettings()
  const open = useRuntime((r) => r.stageOpen, false)
  if (!settings) return null
  const st = settings.stage
  const sizeId = `${st.width}x${st.height}`

  return (
    <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <StagePreview />
        <Alert className="border-candy-sky/40 bg-candy-sky-soft">
          <InfoIcon />
          <AlertTitle>OBSへの取り込み方</AlertTitle>
          <AlertDescription>
            「ウィンドウキャプチャ」で「AMCursorTuberKit Stage」を選びます。背景を抜く場合はクロマキー背景にして、OBSのフィルタ「クロマキー」を追加してください。音声は「アプリケーション音声キャプチャ」で取り込めます。
          </AlertDescription>
        </Alert>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>ステージの設定</CardTitle>
          <CardDescription>変更はステージへすぐ反映されます</CardDescription>
          <CardAction>
            <Button onClick={() => void (open ? api.stage.close() : api.stage.open())} variant={open ? 'outline' : 'default'} size="sm">
              <MonitorPlayIcon data-icon="inline-start" />
              {open ? '閉じる' : '開く'}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <SettingSlider label="横の位置" value={st.x} min={-1} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}`} onChange={(v) => update({ stage: { x: v } })} />
            <SettingSlider label="縦の位置" value={st.y} min={-1} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}`} onChange={(v) => update({ stage: { y: v } })} />
            <SettingSlider label="大きさ" value={st.scale} min={0.1} max={4} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => update({ stage: { scale: v } })} />
            <Button variant="ghost" size="sm" className="self-start" onClick={() => update({ stage: { x: 0, y: 0, scale: 1 } })}>
              <RotateCcwIcon data-icon="inline-start" />
              位置と大きさを戻す
            </Button>
            <FieldSeparator />
            <Field>
              <FieldLabel>背景</FieldLabel>
              <ToggleGroup
                value={[st.background.mode]}
                onValueChange={(v) => v[0] && update({ stage: { background: { mode: v[0] as 'color' | 'transparent' | 'chroma' } } })}
                variant="outline"
                className="grid w-full grid-cols-3 gap-2"
              >
                <ToggleGroupItem value="color" className="font-bold">カラー</ToggleGroupItem>
                <ToggleGroupItem value="chroma" className="font-bold">クロマキー</ToggleGroupItem>
                <ToggleGroupItem value="transparent" className="font-bold">透明</ToggleGroupItem>
              </ToggleGroup>
            </Field>
            {st.background.mode === 'color' && (
              <Field>
                <FieldLabel>背景色</FieldLabel>
                <div className="flex flex-wrap items-center gap-2">
                  {SWATCHES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={c}
                      onClick={() => update({ stage: { background: { color: c } } })}
                      className="press size-8 rounded-full border-2 shadow-sm data-[on=true]:ring-3 data-[on=true]:ring-ring"
                      data-on={st.background.color.toLowerCase() === c}
                      style={{ background: c }}
                    />
                  ))}
                  <Input
                    type="color"
                    aria-label="カスタム色"
                    className="h-8 w-12 cursor-pointer rounded-full p-1"
                    value={st.background.color}
                    onChange={(e) => update({ stage: { background: { color: e.target.value } } })}
                  />
                </div>
              </Field>
            )}
            {st.background.mode === 'chroma' && (
              <Field>
                <FieldLabel>クロマキー色</FieldLabel>
                <ToggleGroup
                  value={[st.background.chroma]}
                  onValueChange={(v) => v[0] && update({ stage: { background: { chroma: v[0] as ChromaPreset } } })}
                  variant="outline"
                  className="grid w-full grid-cols-3 gap-2"
                >
                  {(Object.keys(CHROMA_PRESETS) as ChromaPreset[]).map((k) => (
                    <ToggleGroupItem key={k} value={k} className="gap-2 font-bold">
                      <span className="size-3.5 rounded-full" style={{ background: CHROMA_PRESETS[k] }} />
                      {CHROMA_LABEL[k]}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Field>
            )}
            {st.background.mode === 'transparent' && (
              <FieldDescription>透明背景はOBSの「ゲームキャプチャ（透過を許可）」など、透過に対応した取り込み方法で使えます。</FieldDescription>
            )}
            <FieldSeparator />
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="st-sub">字幕を表示</FieldLabel>
                <FieldDescription>読み上げ中の文を吹き出しで表示します</FieldDescription>
              </FieldContent>
              <Switch id="st-sub" checked={st.subtitles} onCheckedChange={(v) => update({ stage: { subtitles: v } })} />
            </Field>
            {st.subtitles && (
              <SettingSlider label="字幕の大きさ" value={st.subtitleSize} min={12} max={96} format={(v) => `${v}px`} onChange={(v) => update({ stage: { subtitleSize: v } })} />
            )}
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="st-hud">HUD を表示</FieldLabel>
                <FieldDescription>感情と七つの大罪をステージに重ねて表示します（配信に映ります）</FieldDescription>
              </FieldContent>
              <Switch id="st-hud" checked={st.hud} onCheckedChange={(v) => update({ stage: { hud: v } })} />
            </Field>
            <FieldSeparator />
            <Field>
              <FieldLabel>ステージの比率</FieldLabel>
              <ToggleGroup
                value={[sizeId]}
                onValueChange={(v) => {
                  const [w, h] = String(v[0] ?? '').split('x').map(Number)
                  if (w && h) update({ stage: { width: w, height: h } })
                }}
                variant="outline"
                className="grid w-full grid-cols-2 gap-2"
              >
                {SIZES.map((s) => (
                  <ToggleGroupItem key={s.id} value={s.id} className="h-auto flex-col whitespace-normal gap-0 py-2">
                    <span className="text-xs font-extrabold tabular-nums">{s.label}</span>
                    <span className="text-2xs opacity-70">{s.hint}</span>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Field>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="st-top">常に手前に表示</FieldLabel>
              </FieldContent>
              <Switch id="st-top" checked={st.alwaysOnTop} onCheckedChange={(v) => update({ stage: { alwaysOnTop: v } })} />
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>
    </div>
  )
}
