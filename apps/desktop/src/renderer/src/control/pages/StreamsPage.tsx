import { useState, type ReactNode } from 'react'
import { CopyIcon, ExternalLinkIcon, FlaskConicalIcon, LogInIcon, PlugIcon, UnplugIcon } from 'lucide-react'
import { toast } from 'sonner'
import type { StreamPlatform, StreamSourceHealth, TwitchDeviceLogin } from '@amctk/shared'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { useRuntime, useSettings, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { SettingSlider, StatusDot } from '../components/bits'
import { SecretField } from '../components/SecretField'

const NO_STREAMS: StreamSourceHealth[] = []
const STATE_LABEL: Record<StreamSourceHealth['state'], string> = {
  disabled: 'オフ',
  disconnected: '未接続',
  connecting: '接続中…',
  connected: '接続中',
  degraded: '再接続待ち',
  error: 'エラー',
}
const STABILITY: Record<StreamSourceHealth['stability'], { label: string; className: string }> = {
  stable: { label: 'Stable', className: 'bg-candy-mint-soft text-ok' },
  beta: { label: 'Beta', className: 'bg-candy-lemon-soft text-warn' },
  experimental: { label: 'Experimental', className: 'bg-candy-peach-soft text-candy-peach' },
}

function PlatformCard({
  platform,
  title,
  description,
  children,
}: {
  platform: Exclude<StreamPlatform, 'manual'>
  title: string
  description: string
  children: ReactNode
}) {
  const health = useRuntime((r) => r.streams, NO_STREAMS).find((h) => h.platform === platform)
  const [busy, setBusy] = useState(false)
  const state = health?.state ?? 'disabled'
  const active = state === 'connected' || state === 'connecting' || state === 'degraded'
  const level = state === 'connected' ? 'ok' : state === 'error' ? 'error' : state === 'degraded' || state === 'connecting' ? 'warn' : 'off'

  const toggle = async () => {
    setBusy(true)
    try {
      if (active) await api.stream.disconnect(platform)
      else await api.stream.connect(platform)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className={cn('transition-shadow duration-200', state === 'connected' && 'ring-2 ring-ok/40')}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {title}
          {health && (
            <Badge variant="secondary" className={cn('border-transparent font-bold', STABILITY[health.stability].className)}>
              {STABILITY[health.stability].label}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <Button size="sm" variant={active ? 'outline' : 'default'} onClick={() => void toggle()} disabled={busy}>
            {active ? <UnplugIcon data-icon="inline-start" /> : <PlugIcon data-icon="inline-start" />}
            {active ? '切断' : '接続'}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-xs font-bold">
          <StatusDot level={level} pulse={state === 'connecting'} />
          <span>{STATE_LABEL[state]}</span>
          {health?.message && <span className="truncate font-medium text-muted-foreground">{health.message}</span>}
          <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">{health?.eventCount ?? 0}件</span>
        </div>
        <FieldGroup>{children}</FieldGroup>
      </CardContent>
    </Card>
  )
}

function TwitchLogin() {
  const hasToken = useStore((s) => s.secrets?.twitchAccessToken ?? false)
  const [login, setLogin] = useState<TwitchDeviceLogin | null>(null)
  const start = async () => {
    try {
      const l = await api.stream.twitchDeviceLogin()
      setLogin(l)
      void api.app.openExternal(l.verificationUri)
    } catch (err) {
      toast.error(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    }
  }
  return (
    <>
      <Field>
        <FieldLabel>ログイン</FieldLabel>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => void start()}>
            <LogInIcon data-icon="inline-start" />
            {hasToken ? 'ログインし直す' : 'Twitchでログイン'}
          </Button>
          {hasToken && <Badge className="border-transparent bg-candy-mint-soft font-bold text-ok">ログイン済み</Badge>}
        </div>
        <FieldDescription>Device Code 方式なので、Client Secret は不要です（必要な権限: user:read:chat）</FieldDescription>
      </Field>
      <Dialog open={!!login} onOpenChange={(o) => !o && setLogin(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Twitchでコードを入力してください</DialogTitle>
            <DialogDescription>ブラウザで開いたページに、次のコードを入力して許可します。完了すると自動で閉じても大丈夫です。</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center gap-3 rounded-2xl bg-candy-grape-soft py-6">
            <span className="font-mono text-3xl font-extrabold tracking-[0.2em]">{login?.userCode}</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="コピー"
              onClick={() => void navigator.clipboard.writeText(login?.userCode ?? '').then(() => toast.success('コピーしました'))}
            >
              <CopyIcon />
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => login && void api.app.openExternal(login.verificationUri)}>
              <ExternalLinkIcon data-icon="inline-start" />
              ページを開く
            </Button>
            <Button onClick={() => setLogin(null)}>閉じる</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function StreamsPage() {
  const [settings, update] = useSettings()
  if (!settings) return null
  const s = settings.stream
  const sel = s.selector
  return (
    <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 lg:grid-cols-2">
      <PlatformCard platform="youtube" title="YouTube Live" description="Live Streaming API（streamList → 使えない場合はポーリング）">
        <SecretField secret="youtubeApiKey" description="Google Cloud Console で YouTube Data API v3 を有効にして発行します。" />
        <Field>
          <FieldLabel htmlFor="yt-target">配信URL または 動画ID</FieldLabel>
          <Input
            id="yt-target"
            placeholder="https://www.youtube.com/watch?v=..."
            value={s.youtube.target}
            onChange={(e) => update({ stream: { youtube: { target: e.target.value } } })}
          />
          <FieldDescription>配信が始まってから接続してください。liveChatId を直接入れることもできます</FieldDescription>
        </Field>
      </PlatformCard>

      <PlatformCard platform="twitch" title="Twitch" description="EventSub WebSocket でチャットを受信します">
        <Field>
          <FieldLabel htmlFor="tw-client">Client ID</FieldLabel>
          <Input id="tw-client" value={s.twitch.clientId} onChange={(e) => update({ stream: { twitch: { clientId: e.target.value.trim() } } })} />
          <FieldDescription>
            Twitch Developer Console でアプリを「Public」クライアントとして登録し、Device Code Grant を有効にします。
            <button type="button" className="font-bold text-primary hover:underline" onClick={() => void api.app.openExternal('https://dev.twitch.tv/console/apps')}>
              開く <ExternalLinkIcon className="inline size-3" />
            </button>
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="tw-channel">チャンネル名</FieldLabel>
          <Input id="tw-channel" placeholder="your_channel" value={s.twitch.channelLogin} onChange={(e) => update({ stream: { twitch: { channelLogin: e.target.value.trim() } } })} />
        </Field>
        <TwitchLogin />
      </PlatformCard>

      <PlatformCard platform="kick" title="Kick" description="公式Webhookを Cloud Relay（Cloudflare Worker）経由で受け取ります">
        <Field>
          <FieldLabel htmlFor="kick-relay">Relay URL</FieldLabel>
          <Input id="kick-relay" placeholder="https://amctk-relay.xxxx.workers.dev" value={s.kick.relayUrl} onChange={(e) => update({ stream: { kick: { relayUrl: e.target.value.trim() } } })} />
          <FieldDescription>workers/stream-relay をデプロイし、Kick の Webhook URL に「Relay URL + /webhook」を設定します</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="kick-slug">チャンネル</FieldLabel>
          <Input id="kick-slug" value={s.kick.channelSlug} onChange={(e) => update({ stream: { kick: { channelSlug: e.target.value.trim() } } })} />
        </Field>
        <SecretField secret="kickRelaySecret" description="Worker の RELAY_SECRET と同じ値を入れます。" />
      </PlatformCard>

      <PlatformCard platform="tiktok" title="TikTok LIVE" description="外部ブリッジ（TikFinity 等）のWebSocketを受け取ります">
        <Alert className="border-candy-peach/40 bg-candy-peach-soft">
          <FlaskConicalIcon />
          <AlertTitle>Experimental</AlertTitle>
          <AlertDescription>一般開発者向けの公式なLIVEコメント取得手段が明確でないため、動作は保証していません。</AlertDescription>
        </Alert>
        <Field>
          <FieldLabel htmlFor="tt-url">ブリッジURL</FieldLabel>
          <Input id="tt-url" value={s.tiktok.bridgeUrl} onChange={(e) => update({ stream: { tiktok: { bridgeUrl: e.target.value.trim() } } })} />
        </Field>
        <Field>
          <FieldLabel htmlFor="tt-id">ユーザー名（任意）</FieldLabel>
          <Input id="tt-id" placeholder="@username" value={s.tiktok.uniqueId} onChange={(e) => update({ stream: { tiktok: { uniqueId: e.target.value.trim() } } })} />
        </Field>
      </PlatformCard>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>コメントの選び方</CardTitle>
          <CardDescription>
            すべてのコメントをAIへ送らず、重複を除いて少し待ち、スコアの高い1件を選びます。スパチャ・質問・初見・キャラ名入りのコメントが優先されます
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2">
          <SettingSlider
            label="まとめて待つ時間"
            description="短いほど早く反応し、長いほど良いコメントを選びやすくなります"
            value={sel.bufferMs}
            min={0}
            max={10000}
            step={100}
            format={(v) => `${(v / 1000).toFixed(1)}秒`}
            onChange={(v) => update({ stream: { selector: { bufferMs: v } } })}
          />
          <SettingSlider
            label="最低スコア"
            description="これ未満のコメントには返事をしません"
            value={sel.minScore}
            min={0}
            max={60}
            onChange={(v) => update({ stream: { selector: { minScore: v } } })}
          />
          <Field>
            <FieldLabel htmlFor="sel-prefix">無視する先頭文字</FieldLabel>
            <Input id="sel-prefix" value={sel.ignorePrefixes} onChange={(e) => update({ stream: { selector: { ignorePrefixes: e.target.value } } })} />
            <FieldDescription>カンマ区切り。Botコマンドなどを除外します</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="sel-block">NGワード</FieldLabel>
            <Textarea id="sel-block" rows={2} value={sel.blockedWords} onChange={(e) => update({ stream: { selector: { blockedWords: e.target.value } } })} />
            <FieldDescription>カンマ・改行区切り。含むコメントは選ばれません</FieldDescription>
          </Field>
        </CardContent>
        <CardFooter>
          <Button variant="outline" size="sm" onClick={() => void api.stream.injectTest(30)}>
            <FlaskConicalIcon data-icon="inline-start" />
            コメント急増テスト（30件）
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
