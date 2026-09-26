import { useState } from 'react'
import { ExternalLinkIcon, PlugZapIcon, RefreshCwIcon, RotateCcwIcon, ShieldCheckIcon } from 'lucide-react'
import { toast } from 'sonner'
import { SIN_KEYS, SIN_META, type ModelOption } from '@amctk/shared'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldSeparator } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api } from '@/lib/api'
import { useSettings, useStore } from '@/lib/store'
import { SecretField } from '../components/SecretField'
import { SettingSlider } from '../components/bits'

function ConnectionCard() {
  const [settings, update] = useSettings()
  const hasKey = useStore((s) => s.secrets?.cursorApiKey ?? false)
  const [models, setModels] = useState<ModelOption[]>([])
  const [loading, setLoading] = useState(false)
  const [testing, setTesting] = useState(false)
  if (!settings) return null
  const a = settings.agent

  const loadModels = async () => {
    setLoading(true)
    try {
      const list = await api.agent.listModels()
      setModels(list)
      if (!list.length) toast('モデルが見つかりませんでした。API Key を確認してください')
      else if (!a.modelId) update({ agent: { modelId: list[0].id } })
    } catch (err) {
      toast.error(`モデル一覧を取得できませんでした: ${err instanceof Error ? err.message : err}`)
    } finally {
      setLoading(false)
    }
  }

  const test = async () => {
    setTesting(true)
    const r = await api.agent.test().catch((e) => ({ ok: false, message: String(e) }))
    setTesting(false)
    if (r.ok) toast.success(r.message)
    else toast.error(r.message)
  }

  const items = (models.length ? models : a.modelId ? [{ id: a.modelId, name: a.modelId }] : []).map((m) => ({ value: m.id, label: m.name }))

  return (
    <Card>
      <CardHeader>
        <CardTitle>AIの接続</CardTitle>
        <CardDescription>Cursor SDK の Local Agent で返事を作ります</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <ToggleGroup
          value={[a.provider]}
          onValueChange={(v) => v[0] && update({ agent: { provider: v[0] as 'cursor' | 'demo' } })}
          variant="outline"
          className="grid w-full grid-cols-2 gap-2"
        >
          <ToggleGroupItem value="cursor" className="h-auto flex-col whitespace-normal items-start gap-0.5 rounded-2xl px-3.5 py-3 text-left">
            <span className="text-sm font-extrabold">Cursor SDK</span>
            <span className="text-2xs font-medium opacity-75">本番用・LLMで会話</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="demo" className="h-auto flex-col whitespace-normal items-start gap-0.5 rounded-2xl px-3.5 py-3 text-left">
            <span className="text-sm font-extrabold">デモ応答</span>
            <span className="text-2xs font-medium opacity-75">キーワードに反応するだけ・無料</span>
          </ToggleGroupItem>
        </ToggleGroup>

        {a.provider === 'cursor' && (
          <FieldGroup>
            <SecretField
              secret="cursorApiKey"
              description={
                <>
                  Cursor の Dashboard → Integrations で発行できます。
                  <button type="button" className="font-bold text-primary underline-offset-2 hover:underline" onClick={() => void api.app.openExternal('https://cursor.com/dashboard?tab=integrations')}>
                    開く <ExternalLinkIcon className="inline size-3" />
                  </button>
                </>
              }
            />
            <Field>
              <FieldLabel>モデル</FieldLabel>
              <div className="flex gap-2">
                <Select items={items} value={a.modelId || null} onValueChange={(v) => v && update({ agent: { modelId: String(v) } })}>
                  <SelectTrigger className="min-w-0 flex-1">
                    <SelectValue placeholder="一覧を読み込んで選んでください" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {items.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <Button variant="outline" onClick={() => void loadModels()} disabled={!hasKey || loading}>
                  {loading ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}
                  読み込む
                </Button>
              </div>
              <FieldDescription>応答が速く安価なモデルほど配信向きです</FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="web-tools">Web検索を使う</FieldLabel>
                <FieldDescription>
                  最近の話題や分からないことを、Web検索・Webページの取得で調べてから答えます。調べる分だけ返事は遅くなります
                </FieldDescription>
              </FieldContent>
              <Switch id="web-tools" checked={a.webTools} onCheckedChange={(v) => update({ agent: { webTools: v } })} />
            </Field>
            <Button variant="secondary" className="self-start" onClick={() => void test()} disabled={!hasKey || testing}>
              {testing ? <Spinner data-icon="inline-start" /> : <PlugZapIcon data-icon="inline-start" />}
              接続テスト
            </Button>
            <Alert className="border-candy-grape/30 bg-candy-grape-soft">
              <ShieldCheckIcon />
              <AlertTitle>シェル・ファイル操作は使わせません</AlertTitle>
              <AlertDescription>
                Agentが使えるのは、キャラクター状態の取得、感情と状態変化の「提案」{a.webTools ? '、Web検索・Webページの取得' : ''}だけです。状態の変化はアプリ側で範囲を検証してから反映します。
                {a.webTools && ' Webページや視聴者が貼ったURLに書かれた指示には従わないよう指示しています。'}
              </AlertDescription>
            </Alert>
          </FieldGroup>
        )}

        <FieldSeparator />
        <FieldGroup>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="auto-reply">配信コメントに自動で返事する</FieldLabel>
              <FieldDescription>オフにすると、手入力にだけ返事します</FieldDescription>
            </FieldContent>
            <Switch id="auto-reply" checked={a.autoReply} onCheckedChange={(v) => update({ agent: { autoReply: v } })} />
          </Field>
          <SettingSlider
            label="返事の最短間隔"
            value={a.minIntervalMs}
            min={0}
            max={30000}
            step={500}
            format={(v) => `${(v / 1000).toFixed(1)}秒`}
            onChange={(v) => update({ agent: { minIntervalMs: v } })}
          />
          <SettingSlider
            label="1分あたりの最大呼び出し数"
            description="コメントが急に増えてもLLM呼び出しが増えすぎないようにする上限です"
            value={a.maxCallsPerMinute}
            min={1}
            max={30}
            onChange={(v) => update({ agent: { maxCallsPerMinute: v } })}
          />
        </FieldGroup>
      </CardContent>
    </Card>
  )
}

function ResetCharacterButton() {
  const [open, setOpen] = useState(false)
  const reset = async () => {
    await api.settings.reset('character')
    setOpen(false)
    toast.success('キャラクター設定を初期値（キャットリン）に戻しました')
  }
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>
        <RotateCcwIcon data-icon="inline-start" />
        初期値に戻す
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>キャラクター設定を初期値に戻しますか？</AlertDialogTitle>
          <AlertDialogDescription>
            名前・人物像・話し方・七つの大罪の本来の値が、初期キャラクター「キャットリン」の内容に置き換わります。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>やめる</AlertDialogCancel>
          <AlertDialogAction onClick={() => void reset()}>戻す</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function CharacterCard() {
  const [settings, update] = useSettings()
  if (!settings) return null
  const c = settings.character
  return (
    <Card>
      <CardHeader>
        <CardTitle>キャラクター</CardTitle>
        <CardDescription>性格の土台です。ここに書いた内容をもとに返事をします</CardDescription>
        <CardAction>
          <ResetCharacterButton />
        </CardAction>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="c-name">名前</FieldLabel>
              <Input id="c-name" value={c.name} onChange={(e) => update({ character: { name: e.target.value } })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="c-first">一人称</FieldLabel>
              <Input id="c-first" value={c.firstPerson} onChange={(e) => update({ character: { firstPerson: e.target.value } })} />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="c-persona">人物像</FieldLabel>
            <Textarea id="c-persona" rows={6} value={c.persona} onChange={(e) => update({ character: { persona: e.target.value } })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="c-style">話し方</FieldLabel>
            <Textarea id="c-style" rows={7} value={c.speakingStyle} onChange={(e) => update({ character: { speakingStyle: e.target.value } })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="c-ng">触れない話題</FieldLabel>
            <Input id="c-ng" value={c.ngTopics} onChange={(e) => update({ character: { ngTopics: e.target.value } })} />
          </Field>
        </FieldGroup>
      </CardContent>
    </Card>
  )
}

function BaselineCard() {
  const [settings, update] = useSettings()
  if (!settings) return null
  const c = settings.character
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>七つの大罪（本来の性格）</CardTitle>
        <CardDescription>会話で上下し、時間がたつとこの値に戻ります。高い・低い値ほど言動や声、表情に出やすくなります</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={() => update({ character: { baseline: Object.fromEntries(SIN_KEYS.map((k) => [k, 50])) } })}>
            すべて50にする
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2">
          {SIN_KEYS.map((k) => (
            <SettingSlider
              key={k}
              label={
                <span className="flex items-center gap-2">
                  <span className="size-2.5 rounded-full" style={{ background: `var(--sin-${k})` }} />
                  {SIN_META[k].ja}
                  <span className="text-xs font-medium text-muted-foreground">{SIN_META[k].en}・{SIN_META[k].hint}</span>
                </span>
              }
              description={c.baseline[k] >= 65 ? SIN_META[k].highTrait : c.baseline[k] <= 25 ? SIN_META[k].lowTrait : undefined}
              value={c.baseline[k]}
              min={0}
              max={100}
              accent={`var(--sin-${k})`}
              onChange={(v) => update({ character: { baseline: { [k]: v } } })}
            />
          ))}
        </div>
        <FieldSeparator />
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2">
          <SettingSlider
            label="戻る速さ（半減期）"
            description="本来の値との差が半分になるまでの時間"
            value={c.decayHalfLifeSec}
            min={10}
            max={1800}
            step={10}
            format={(v) => (v >= 60 ? `${Math.round(v / 6) / 10}分` : `${v}秒`)}
            onChange={(v) => update({ character: { decayHalfLifeSec: v } })}
          />
          <SettingSlider
            label="1回の会話で動ける最大量"
            description="AIの提案値はこの範囲に切り詰めてから反映します"
            value={c.maxDeltaPerTurn}
            min={1}
            max={30}
            onChange={(v) => update({ character: { maxDeltaPerTurn: v } })}
          />
        </div>
      </CardContent>
    </Card>
  )
}

export function AiPage() {
  return (
    <div className="enter-stagger mx-auto grid max-w-5xl grid-cols-1 gap-4 lg:grid-cols-2">
      <ConnectionCard />
      <CharacterCard />
      <BaselineCard />
    </div>
  )
}
