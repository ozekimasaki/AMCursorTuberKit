import { useCallback, useEffect, useState } from 'react'
import { BookHeartIcon, PlusIcon, RefreshCwIcon, Trash2Icon, UsersRoundIcon } from 'lucide-react'
import { toast } from 'sonner'
import type { MemoryHealth, MemoryItem, ViewerSummary } from '@amctk/shared'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api } from '@/lib/api'
import { useSettings } from '@/lib/store'
import { cn } from '@/lib/utils'
import { PlatformBadge, SettingSlider, StatusDot, timeAgo } from '../components/bits'
import { SecretField } from '../components/SecretField'

const KIND_LABEL: Record<MemoryItem['kind'], string> = {
  fact: '事実',
  event: '出来事',
  preference: '好み',
  relationship: '関係',
  topic: '話題',
  note: 'メモ',
}

function ProviderCard() {
  const [settings, update] = useSettings()
  const [health, setHealth] = useState<MemoryHealth | null>(null)
  const check = useCallback(() => void api.memory.health().then(setHealth).catch(() => setHealth(null)), [])
  useEffect(check, [check, settings?.memory.provider])
  if (!settings) return null
  const m = settings.memory
  return (
    <Card>
      <CardHeader>
        <CardTitle>記憶の保存先</CardTitle>
        <CardDescription>七つの大罪の数値はローカルに、視聴者の好みや出来事は記憶として保存します</CardDescription>
        <CardAction>
          <Button variant="ghost" size="icon-sm" aria-label="再確認" onClick={check}>
            <RefreshCwIcon />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ToggleGroup
          value={[m.provider]}
          onValueChange={(v) => v[0] && update({ memory: { provider: v[0] as 'local' | 'cloudflare' } })}
          variant="outline"
          className="grid w-full grid-cols-2 gap-2"
        >
          <ToggleGroupItem value="local" className="h-auto flex-col whitespace-normal items-start gap-0.5 rounded-2xl px-3.5 py-3 text-left">
            <span className="text-sm font-extrabold">ローカル</span>
            <span className="text-2xs font-medium opacity-75">このPCのSQLiteに保存</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="cloudflare" className="h-auto flex-col whitespace-normal items-start gap-0.5 rounded-2xl px-3.5 py-3 text-left">
            <span className="text-sm font-extrabold">Cloudflare Agent Memory</span>
            <span className="text-2xs font-medium opacity-75">高度な検索・private beta</span>
          </ToggleGroupItem>
        </ToggleGroup>
        {health && (
          <div className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-xs font-bold">
            <StatusDot level={health.ok ? 'ok' : 'warn'} />
            {health.message ?? health.provider}
          </div>
        )}
        <FieldGroup>
          {m.provider === 'cloudflare' && (
            <>
              <Alert>
                <BookHeartIcon />
                <AlertTitle>落ちても会話は止まりません</AlertTitle>
                <AlertDescription>Cloudflare に接続できないときは、自動でローカル記憶に切り替えて続行します。</AlertDescription>
              </Alert>
              <Field>
                <FieldLabel htmlFor="cf-account">Account ID</FieldLabel>
                <Input id="cf-account" value={m.cloudflare.accountId} onChange={(e) => update({ memory: { cloudflare: { accountId: e.target.value.trim() } } })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="cf-ns">Namespace</FieldLabel>
                <Input id="cf-ns" value={m.cloudflare.namespace} onChange={(e) => update({ memory: { cloudflare: { namespace: e.target.value.trim() } } })} />
                <FieldDescription>視聴者ごとに profile を分けて保存します</FieldDescription>
              </Field>
              <SecretField secret="cloudflareApiToken" description="Agent Memory の編集権限を持つトークン。" />
            </>
          )}
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="mem-ingest">会話から自動で覚える</FieldLabel>
              <FieldDescription>好み・出来事など、次回も使える情報だけを保存します</FieldDescription>
            </FieldContent>
            <Switch id="mem-ingest" checked={m.ingestEnabled} onCheckedChange={(v) => update({ memory: { ingestEnabled: v } })} />
          </Field>
          <SettingSlider
            label="思い出す時間の上限"
            description="これを超えたら記憶なしで返事を始めます"
            value={m.recallTimeoutMs}
            min={200}
            max={5000}
            step={100}
            format={(v) => `${(v / 1000).toFixed(1)}秒`}
            onChange={(v) => update({ memory: { recallTimeoutMs: v } })}
          />
        </FieldGroup>
      </CardContent>
    </Card>
  )
}

function ViewersCard() {
  const [viewers, setViewers] = useState<ViewerSummary[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [memories, setMemories] = useState<MemoryItem[]>([])
  const [note, setNote] = useState('')

  const loadViewers = useCallback(() => void api.memory.viewers().then(setViewers), [])
  const loadMemories = useCallback(() => void api.memory.list(selected ?? undefined).then(setMemories), [selected])
  useEffect(loadViewers, [loadViewers])
  useEffect(loadMemories, [loadMemories])

  const add = async () => {
    if (!note.trim()) return
    await api.memory.remember({ viewerKey: selected ?? undefined, kind: 'note', content: note.trim() })
    setNote('')
    loadMemories()
    loadViewers()
    toast.success('覚えました')
  }
  const forget = async (id: string) => {
    await api.memory.forget(id)
    loadMemories()
    loadViewers()
  }
  const current = viewers.find((v) => v.viewerKey === selected)

  return (
    <Card className="min-h-0">
      <CardHeader>
        <CardTitle>覚えていること</CardTitle>
        <CardDescription>視聴者を選ぶと、その人についての記憶が表示されます（ローカル記憶）</CardDescription>
        <CardAction>
          <Button variant="ghost" size="icon-sm" aria-label="更新" onClick={() => (loadViewers(), loadMemories())}>
            <RefreshCwIcon />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid min-h-0 grid-cols-1 gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
        <div className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto pr-1">
          <button
            type="button"
            onClick={() => setSelected(null)}
            className={cn('press flex items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-bold hover:bg-muted', !selected && 'bg-secondary text-secondary-foreground')}
          >
            <UsersRoundIcon className="size-4" /> すべて
          </button>
          {viewers.map((v) => (
            <button
              key={v.viewerKey}
              type="button"
              onClick={() => setSelected(v.viewerKey)}
              className={cn('press flex items-center gap-2 rounded-xl px-2.5 py-2 text-left hover:bg-muted', selected === v.viewerKey && 'bg-secondary text-secondary-foreground')}
            >
              <Avatar className="size-7">
                <AvatarFallback className="bg-candy-lemon-soft text-xs font-extrabold">{v.displayName.slice(0, 1)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-bold">{v.displayName}</div>
                <div className="text-2xs text-muted-foreground">
                  {v.interactions}回・記憶{v.memoryCount}件
                </div>
              </div>
            </button>
          ))}
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          {current && (
            <div className="flex items-center gap-2 text-sm font-extrabold">
              <PlatformBadge platform={current.platform} />
              {current.displayName}
              <span className="text-xs font-medium text-muted-foreground">最後に来た: {timeAgo(current.lastSeenAt)}</span>
            </div>
          )}
          <InputGroup>
            <InputGroupInput
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void add()}
              placeholder={current ? `${current.displayName}さんについて覚えておくこと` : '配信全体で覚えておくこと'}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton variant="default" onClick={() => void add()} disabled={!note.trim()}>
                <PlusIcon data-icon="inline-start" />
                追加
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          {memories.length ? (
            <ItemGroup className="max-h-[52vh] gap-1.5 overflow-y-auto pr-1">
              {memories.map((m) => (
                <Item key={m.id} size="sm" variant="outline" className="rounded-xl">
                  <ItemMedia>
                    <Badge variant="secondary">{KIND_LABEL[m.kind]}</Badge>
                  </ItemMedia>
                  <ItemContent className="gap-0">
                    <ItemTitle className="text-xs">{m.content}</ItemTitle>
                    <ItemDescription className="text-2xs">
                      {!selected && m.viewerName ? `${m.viewerName}・` : ''}
                      {timeAgo(m.createdAt)}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button variant="ghost" size="icon-xs" aria-label="忘れる" onClick={() => void forget(m.id)}>
                      <Trash2Icon />
                    </Button>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          ) : (
            <Empty className="border-none py-8">
              <EmptyHeader>
                <EmptyMedia variant="icon" className="bg-candy-lemon-soft text-candy-lemon">
                  <BookHeartIcon />
                </EmptyMedia>
                <EmptyTitle>まだ何も覚えていません</EmptyTitle>
                <EmptyDescription>会話で好みや出来事が出てくると、ここに増えていきます</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function MemoryPage() {
  return (
    <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)]">
      <ProviderCard />
      <ViewersCard />
    </div>
  )
}
