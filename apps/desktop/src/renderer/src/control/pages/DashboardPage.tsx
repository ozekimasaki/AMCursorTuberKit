import { CheckIcon, EraserIcon, FlaskConicalIcon, RotateCcwIcon, XIcon } from 'lucide-react'
import { EMOTION_META, SIN_KEYS, type HealthItem, type SevenSins, type StreamEvent } from '@amctk/shared'
import { AvatarView } from '@/avatar/AvatarView'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import { useRuntime, useSettings } from '@/lib/store'
import { cn } from '@/lib/utils'
import { PlatformBadge, StatusDot } from '../components/bits'
import { ChatPanel, Composer } from '../components/ChatPanel'
import { SinRadar } from '../components/SinChart'
import type { PageId } from '../meta'

const NEUTRAL = Object.fromEntries(SIN_KEYS.map((k) => [k, 50])) as SevenSins
const NO_EVENTS: StreamEvent[] = []
const NO_HEALTH: HealthItem[] = []
const NEUTRAL_EMOTION = { emotion: 'neutral' as const, intensity: 0.5 }

function AvatarPreviewCard() {
  const [settings] = useSettings()
  const emotion = useRuntime((r) => r.emotion, NEUTRAL_EMOTION)
  const sins = useRuntime((r) => r.sins.current, NEUTRAL)
  const speaking = useRuntime((r) => r.speaking, false)
  const utterance = useRuntime((r) => r.utterance?.text ?? '', '')
  if (!settings) return null
  const meta = EMOTION_META[emotion.emotion]
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="relative aspect-[4/3] bg-gradient-to-b from-candy-pink-soft via-card to-candy-lemon-soft">
        <div className="absolute inset-x-6 top-4 bottom-0">
          <AvatarView avatar={settings.avatar} emotion={emotion.emotion} intensity={emotion.intensity} sins={sins} speaking={speaking} />
        </div>
        <div className="absolute top-3 left-3 flex gap-1.5">
          <Badge variant="secondary" className="h-6 border-transparent bg-card/90 font-bold shadow-soft">
            {meta.emoji} {meta.ja}
          </Badge>
          {speaking && (
            <Badge className="h-6 border-transparent font-bold">
              <span className="size-1.5 animate-pulse rounded-full bg-current" /> 話してる
            </Badge>
          )}
        </div>
      </div>
      <div className={cn('min-h-12 border-t px-4 py-2.5 text-sm font-bold transition-opacity duration-200', speaking ? 'opacity-100' : 'opacity-50')}>
        {speaking && utterance ? `「${utterance}」` : 'いまは静かにしています'}
      </div>
    </Card>
  )
}

function SinsCard() {
  const current = useRuntime((r) => r.sins.current, NEUTRAL)
  const baseline = useRuntime((r) => r.sins.baseline, NEUTRAL)
  return (
    <Card className="gap-2">
      <CardHeader>
        <CardTitle>七つの大罪</CardTitle>
        <CardDescription>点線が本来の性格。会話で動き、時間がたつと戻ります</CardDescription>
        <CardAction>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="本来の値に戻す" onClick={() => void api.agent.resetSins()} />}>
              <RotateCcwIcon />
            </TooltipTrigger>
            <TooltipContent>本来の値に戻す</TooltipContent>
          </Tooltip>
        </CardAction>
      </CardHeader>
      <CardContent>
        <SinRadar current={current} baseline={baseline} className="mx-auto max-w-72" />
      </CardContent>
    </Card>
  )
}

function QueueCard() {
  const pending = useRuntime((r) => r.pending, NO_EVENTS)
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          コメント待ち
          <Badge variant="secondary" className="tabular-nums">
            {pending.length}
          </Badge>
        </CardTitle>
        <CardDescription>スコアの高いものから1件ずつAIへ渡します</CardDescription>
        <CardAction className="flex gap-1">
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="テストコメント" onClick={() => void api.stream.injectTest(10)} />}>
              <FlaskConicalIcon />
            </TooltipTrigger>
            <TooltipContent>テストコメントを10件流す</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="クリア" disabled={!pending.length} onClick={() => void api.stream.clearQueue()} />}>
              <EraserIcon />
            </TooltipTrigger>
            <TooltipContent>待ちコメントを消す</TooltipContent>
          </Tooltip>
        </CardAction>
      </CardHeader>
      <CardContent>
        {pending.length ? (
          <ItemGroup className="gap-1.5">
            {pending.slice(0, 6).map((e) => (
              <Item key={e.id} size="sm" variant="muted" className="rounded-xl py-1.5">
                <ItemContent className="min-w-0 gap-0.5">
                  <ItemTitle className="w-full min-w-0 gap-1.5 text-xs">
                    <PlatformBadge platform={e.platform} />
                    <span className="truncate">{e.viewer.displayName}</span>
                  </ItemTitle>
                  <ItemDescription className="line-clamp-1 text-xs">{e.amount?.display ? `${e.amount.display} ` : ''}{e.text}</ItemDescription>
                </ItemContent>
              </Item>
            ))}
          </ItemGroup>
        ) : (
          <p className="py-3 text-center text-xs text-muted-foreground">いまは待っているコメントはありません</p>
        )}
      </CardContent>
    </Card>
  )
}

function GettingStarted({ onNavigate }: { onNavigate: (p: PageId) => void }) {
  const [settings, update] = useSettings()
  const health = useRuntime((r) => r.health.items, NO_HEALTH)
  const stageOpen = useRuntime((r) => r.stageOpen, false)
  if (!settings || settings.ui.onboarded) return null
  const tts = health.find((h) => h.id === 'tts')
  const agent = health.find((h) => h.id === 'agent')
  const steps: { done: boolean; title: string; desc: string; action: () => void; label: string }[] = [
    {
      done: tts?.level === 'ok',
      title: '声をつなぐ',
      desc: 'VOICEVOX を起動すると自動でつながります',
      action: () => onNavigate('voice'),
      label: 'ボイス設定',
    },
    {
      done: settings.agent.provider === 'cursor' && agent?.level === 'ok',
      title: 'AIをつなぐ（任意）',
      desc: '未設定でもデモ応答で試せます',
      action: () => onNavigate('ai'),
      label: 'AI設定',
    },
    {
      done: stageOpen,
      title: 'ステージを開く',
      desc: 'OBSでこのウィンドウを取り込みます',
      action: () => void api.stage.open(),
      label: '開く',
    },
  ]
  return (
    <Card className="gap-3 border-primary/30 bg-gradient-to-br from-candy-pink-soft to-card">
      <CardHeader>
        <CardTitle>はじめにやること</CardTitle>
        <CardDescription>3ステップで配信の準備ができます</CardDescription>
        <CardAction>
          <Button variant="ghost" size="icon-sm" aria-label="閉じる" onClick={() => update({ ui: { onboarded: true } })}>
            <XIcon />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ItemGroup className="gap-1.5">
          {steps.map((s, i) => (
            <Item key={s.title} size="sm" variant="outline" className="rounded-xl bg-card">
              <ItemMedia>
                <span
                  className={cn(
                    'grid size-6 place-items-center rounded-full text-xs font-extrabold',
                    s.done ? 'bg-ok text-white' : 'bg-secondary text-secondary-foreground',
                  )}
                >
                  {s.done ? <CheckIcon className="size-3.5" strokeWidth={3} /> : i + 1}
                </span>
              </ItemMedia>
              <ItemContent className="gap-0">
                <ItemTitle className="text-xs">{s.title}</ItemTitle>
                <ItemDescription className="text-2xs">{s.desc}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button size="xs" variant={s.done ? 'ghost' : 'secondary'} onClick={s.action}>
                  {s.label}
                </Button>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      </CardContent>
    </Card>
  )
}

function HealthStrip({ onNavigate }: { onNavigate: (p: PageId) => void }) {
  const health = useRuntime((r) => r.health.items, NO_HEALTH)
  const target: Record<string, PageId> = { agent: 'ai', tts: 'voice', memory: 'memory', stage: 'stage', runtime: 'debug', storage: 'debug' }
  return (
    <div className="ml-auto flex flex-wrap justify-end gap-1">
      {health.map((h) => (
        <Tooltip key={h.id}>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={() => onNavigate(target[h.id] ?? 'debug')}
                className="press flex h-6 items-center gap-1.5 rounded-full border bg-card px-2 text-2xs font-bold hover:bg-muted"
              />
            }
          >
            <StatusDot level={h.level} />
            {h.label}
          </TooltipTrigger>
          <TooltipContent className="max-w-72">{h.message}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}

export function DashboardPage({ onNavigate }: { onNavigate: (p: PageId) => void }) {
  return (
    <div className="grid h-[calc(100vh-6.5rem)] min-h-[520px] grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card className="min-h-0 gap-0 overflow-hidden py-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3">
          <div className="shrink-0">
            <div className="text-sm font-extrabold">ライブ会話</div>
            <div className="text-xs text-muted-foreground">視聴者のコメントとキャラクターの返事</div>
          </div>
          <HealthStrip onNavigate={onNavigate} />
        </div>
        <ChatPanel />
        <Composer />
      </Card>
      <div className="enter-stagger flex min-h-0 flex-col gap-4 overflow-y-auto pr-1 pb-2 *:shrink-0">
        <GettingStarted onNavigate={onNavigate} />
        <AvatarPreviewCard />
        <SinsCard />
        <QueueCard />
      </div>
    </div>
  )
}
