import { useCallback, useEffect, useState } from 'react'
import { CircleAlertIcon, CircleCheckIcon, ExternalLinkIcon, PlayIcon, RefreshCwIcon, SquareIcon } from 'lucide-react'
import type { TTSHealth, TTSProviderId, TTSVoice } from '@amctk/shared'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api } from '@/lib/api'
import { useSettings } from '@/lib/store'
import { SettingSlider } from '../components/bits'

const PROVIDERS: { id: TTSProviderId; name: string; desc: string }[] = [
  { id: 'voicevox', name: 'VOICEVOX', desc: 'おすすめ・無料' },
  { id: 'aivis', name: 'AivisSpeech', desc: '感情豊かな声' },
  { id: 'irodori', name: 'Irodori-TTS', desc: 'HTTPサーバー接続' },
  { id: 'system', name: 'OS標準', desc: 'インストール不要' },
  { id: 'none', name: '音声なし', desc: '字幕だけ表示' },
]

export function VoicePage() {
  const [settings, update] = useSettings()
  const [health, setHealth] = useState<TTSHealth | null>(null)
  const [voices, setVoices] = useState<TTSVoice[]>([])
  const [checking, setChecking] = useState(false)
  const [preview, setPreview] = useState('こんにちは！今日も一緒に楽しもうね。')
  const provider = settings?.tts.provider ?? 'voicevox'

  const refresh = useCallback(async () => {
    setChecking(true)
    try {
      const h = await api.tts.health()
      setHealth(h)
      if (h.ok && (provider === 'voicevox' || provider === 'aivis')) setVoices(await api.tts.listVoices())
      else setVoices([])
    } catch (err) {
      setHealth({ ok: false, provider, message: String(err) })
    } finally {
      setChecking(false)
    }
  }, [provider])

  useEffect(() => {
    void refresh()
  }, [refresh, settings?.tts.voicevox.baseUrl, settings?.tts.aivis.baseUrl])

  if (!settings) return null
  const t = settings.tts
  const engine = provider === 'aivis' ? t.aivis : t.voicevox
  const isVoicevoxLike = provider === 'voicevox' || provider === 'aivis'
  const speakerId = String(engine.speakerId)
  const voiceItems = voices.map((v) => ({ value: v.id, label: `${v.name}（${v.style ?? ''}）` }))
  const systemVoices = typeof speechSynthesis !== 'undefined' ? speechSynthesis.getVoices().filter((v) => v.lang.startsWith('ja')) : []

  return (
    <div className="mx-auto grid max-w-5xl grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>読み上げエンジン</CardTitle>
          <CardDescription>アバターはエンジンを区別しないので、あとから切り替えても口パクはそのまま動きます</CardDescription>
        </CardHeader>
        <CardContent>
          <ToggleGroup
            value={[provider]}
            onValueChange={(v) => v[0] && update({ tts: { provider: v[0] as TTSProviderId } })}
            variant="outline"
            className="grid w-full grid-cols-2 gap-2 sm:grid-cols-5"
          >
            {PROVIDERS.map((p) => (
              <ToggleGroupItem key={p.id} value={p.id} className="h-auto flex-col whitespace-normal items-start gap-0.5 rounded-2xl px-3.5 py-3 text-left">
                <span className="text-sm font-extrabold">{p.name}</span>
                <span className="text-2xs font-medium opacity-75">{p.desc}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>接続</CardTitle>
          <CardDescription>
            {isVoicevoxLike ? 'エンジンを起動しておくと自動でつながります' : provider === 'irodori' ? '任意のHTTP TTSサーバーに {text} を送ります' : '追加の準備は不要です'}
          </CardDescription>
          <CardAction>
            <Button variant="ghost" size="icon-sm" aria-label="再確認" onClick={() => void refresh()} disabled={checking}>
              <RefreshCwIcon className={checking ? 'animate-spin' : ''} />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {health && provider !== 'none' && (
            <Alert variant={health.ok ? 'default' : 'destructive'} className={health.ok ? 'border-ok/40 bg-candy-mint-soft' : ''}>
              {health.ok ? <CircleCheckIcon className="text-ok" /> : <CircleAlertIcon />}
              <AlertTitle>{health.ok ? `つながっています${health.version ? `（v${health.version}）` : ''}` : 'つながっていません'}</AlertTitle>
              <AlertDescription>{health.ok ? (health.message ?? '読み上げできます') : `${health.message ?? ''} 字幕だけで配信は続けられます。`}</AlertDescription>
            </Alert>
          )}
          <FieldGroup>
            {isVoicevoxLike && (
              <>
                <Field>
                  <FieldLabel htmlFor="tts-url">エンジンのURL</FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id="tts-url"
                      value={engine.baseUrl}
                      onChange={(e) => update({ tts: { [provider]: { baseUrl: e.target.value } } })}
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        onClick={() =>
                          void api.app.openExternal(provider === 'aivis' ? 'https://aivis-project.com/' : 'https://voicevox.hiroshiba.jp/')
                        }
                      >
                        入手
                        <ExternalLinkIcon data-icon="inline-end" />
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                  <FieldDescription>VOICEVOX は 50021、AivisSpeech は 10101 番ポートが標準です</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel>声</FieldLabel>
                  {voices.length ? (
                    <Select
                      items={voiceItems}
                      value={speakerId}
                      onValueChange={(v) => v && update({ tts: { [provider]: { speakerId: Number(v) } } })}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {voiceItems.map((v) => (
                            <SelectItem key={v.value} value={v.value}>
                              {v.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      type="number"
                      value={engine.speakerId}
                      onChange={(e) => update({ tts: { [provider]: { speakerId: Number(e.target.value) } } })}
                    />
                  )}
                  <FieldDescription>エンジンにつながると一覧から選べます（話者IDを直接入力も可）</FieldDescription>
                </Field>
              </>
            )}
            {provider === 'irodori' && (
              <>
                <Field>
                  <FieldLabel htmlFor="iro-url">サーバーURL</FieldLabel>
                  <Input id="iro-url" value={t.irodori.baseUrl} onChange={(e) => update({ tts: { irodori: { baseUrl: e.target.value } } })} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="iro-path">パス</FieldLabel>
                  <Input id="iro-path" value={t.irodori.path} onChange={(e) => update({ tts: { irodori: { path: e.target.value } } })} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="iro-body">送信するJSON</FieldLabel>
                  <Textarea
                    id="iro-body"
                    className="font-mono text-xs"
                    value={t.irodori.bodyTemplate}
                    onChange={(e) => update({ tts: { irodori: { bodyTemplate: e.target.value } } })}
                  />
                  <FieldDescription>{'{text} {speed} {voice} が置き換わります。音声バイナリ、または {"audio": base64} を返すサーバーに対応します'}</FieldDescription>
                </Field>
              </>
            )}
            {provider === 'system' && (
              <Field>
                <FieldLabel>声</FieldLabel>
                <Select
                  items={[{ value: '', label: '自動（日本語）' }, ...systemVoices.map((v) => ({ value: v.name, label: v.name }))]}
                  value={t.system.voiceName}
                  onValueChange={(v) => update({ tts: { system: { voiceName: String(v ?? '') } } })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="">自動（日本語）</SelectItem>
                      {systemVoices.map((v) => (
                        <SelectItem key={v.name} value={v.name}>
                          {v.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>OS標準の音声は音声データを解析できないため、口パクは簡易的な動きになります</FieldDescription>
              </Field>
            )}
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>声の調子</CardTitle>
          <CardDescription>基本の値です。気分によってここから自動で少し変わります</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <FieldGroup>
            <SettingSlider label="はやさ" value={t.speed} min={0.5} max={2} step={0.01} format={(v) => `${v.toFixed(2)}x`} onChange={(v) => update({ tts: { speed: v } })} />
            <SettingSlider label="高さ" value={t.pitch} min={-0.15} max={0.15} step={0.005} format={(v) => (v >= 0 ? '+' : '') + v.toFixed(3)} onChange={(v) => update({ tts: { pitch: v } })} />
            <SettingSlider label="抑揚" value={t.intonation} min={0} max={2} step={0.01} format={(v) => v.toFixed(2)} onChange={(v) => update({ tts: { intonation: v } })} />
            <SettingSlider label="音量" value={t.volume} min={0} max={2} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => update({ tts: { volume: v } })} />
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="state-mod">気分を声に反映する</FieldLabel>
                <FieldDescription>憤怒が高いと早口で強め、怠惰が高いとゆっくり平坦に、など七つの大罪と表情に合わせて声色を変えます</FieldDescription>
              </FieldContent>
              <Switch id="state-mod" checked={t.stateModulation} onCheckedChange={(v) => update({ tts: { stateModulation: v } })} />
            </Field>
          </FieldGroup>
          <Field>
            <FieldLabel htmlFor="tts-preview">試しに読む</FieldLabel>
            <InputGroup>
              <InputGroupInput id="tts-preview" value={preview} onChange={(e) => setPreview(e.target.value)} />
              <InputGroupAddon align="inline-end">
                <InputGroupButton size="icon-xs" aria-label="止める" onClick={() => void api.tts.stop()}>
                  <SquareIcon />
                </InputGroupButton>
                <InputGroupButton variant="default" onClick={() => void api.tts.preview(preview)} disabled={!preview.trim()}>
                  <PlayIcon data-icon="inline-start" />
                  再生
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </Field>
        </CardContent>
      </Card>
    </div>
  )
}
