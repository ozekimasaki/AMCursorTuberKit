import { useEffect, useMemo, useState } from 'react'
import { FolderOpenIcon, MinusIcon, PlusIcon, RefreshCwIcon } from 'lucide-react'
import { SIN_KEYS, SIN_META, type AppInfo, type HealthItem, type SevenSins } from '@amctk/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api } from '@/lib/api'
import { useRuntime, useSettings, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { StatusDot } from '../components/bits'
import { SinBars } from '../components/SinChart'

const NO_HEALTH: HealthItem[] = []
const NEUTRAL = Object.fromEntries(SIN_KEYS.map((k) => [k, 50])) as SevenSins
const LEVEL_CLASS = { debug: 'text-muted-foreground', info: 'text-foreground', warn: 'text-warn', error: 'text-error' } as const

function HealthCard() {
  const health = useRuntime((r) => r.health.items, NO_HEALTH)
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => void api.app.info().then(setInfo), [])
  return (
    <Card>
      <CardHeader>
        <CardTitle>動作状況</CardTitle>
        <CardDescription>1つが止まっても、他の機能は動き続けます</CardDescription>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void api.runtime.healthCheck().finally(() => setBusy(false))
            }}
          >
            <RefreshCwIcon data-icon="inline-start" className={busy ? 'animate-spin' : ''} />
            再チェック
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {health.map((h) => (
          <div key={h.id} className="flex items-start gap-2.5 rounded-xl bg-muted/60 px-3 py-2">
            <StatusDot level={h.level} className="mt-1" />
            <div className="min-w-0">
              <div className="text-xs font-extrabold">{h.label}</div>
              <div className="text-xs text-muted-foreground">{h.message}</div>
            </div>
          </div>
        ))}
        {info && (
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-2xs text-muted-foreground">
            <span>Version {info.version}</span>
            <span>Electron {info.electron}</span>
            <span>Node {info.node}</span>
            <span>{info.platform}</span>
            <span className="col-span-2 truncate">データ: {info.userData}</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function SinsTool() {
  const current = useRuntime((r) => r.sins.current, NEUTRAL)
  const baseline = useRuntime((r) => r.sins.baseline, NEUTRAL)
  return (
    <Card>
      <CardHeader>
        <CardTitle>内部状態を手で動かす</CardTitle>
        <CardDescription>表情や声がどう変わるかを確かめられます</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={() => void api.agent.resetSins()}>
            リセット
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <SinBars current={current} baseline={baseline} />
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {SIN_KEYS.map((k) => (
            <div key={k} className="flex items-center justify-between gap-1 rounded-xl border px-2 py-1">
              <span className="text-xs font-bold">{SIN_META[k].ja}</span>
              <span className="flex">
                <Button variant="ghost" size="icon-xs" aria-label={`${SIN_META[k].ja}を下げる`} onClick={() => void api.agent.nudgeSins({ [k]: -10 })}>
                  <MinusIcon />
                </Button>
                <Button variant="ghost" size="icon-xs" aria-label={`${SIN_META[k].ja}を上げる`} onClick={() => void api.agent.nudgeSins({ [k]: 10 })}>
                  <PlusIcon />
                </Button>
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function AppearanceCard() {
  const [settings, update] = useSettings()
  if (!settings) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>表示</CardTitle>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel>テーマ</FieldLabel>
            <ToggleGroup
              value={[settings.ui.theme]}
              onValueChange={(v) => v[0] && update({ ui: { theme: v[0] as 'light' | 'dark' | 'system' } })}
              variant="outline"
              className="grid w-full grid-cols-3 gap-2"
            >
              <ToggleGroupItem value="light" className="font-bold">ライト</ToggleGroupItem>
              <ToggleGroupItem value="dark" className="font-bold">ダーク</ToggleGroupItem>
              <ToggleGroupItem value="system" className="font-bold">OSに合わせる</ToggleGroupItem>
            </ToggleGroup>
          </Field>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="rm">動きを減らす</FieldLabel>
              <FieldDescription>画面のアニメーションを最小限にします（アバターの動きは変わりません）</FieldDescription>
            </FieldContent>
            <Switch id="rm" checked={settings.ui.reduceMotion} onCheckedChange={(v) => update({ ui: { reduceMotion: v } })} />
          </Field>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="ob">「はじめにやること」を表示</FieldLabel>
            </FieldContent>
            <Switch id="ob" checked={!settings.ui.onboarded} onCheckedChange={(v) => update({ ui: { onboarded: !v } })} />
          </Field>
        </FieldGroup>
      </CardContent>
    </Card>
  )
}

function LogsCard() {
  const logs = useStore((s) => s.logs)
  const events = useStore((s) => s.events)
  const [category, setCategory] = useState<string>('all')
  const categories = useMemo(() => ['all', ...new Set(logs.map((l) => l.category))], [logs])
  const filtered = logs.filter((l) => category === 'all' || l.category === category).slice(-150).reverse()
  return (
    <Card className="xl:col-span-2">
      <CardHeader>
        <CardTitle>ログ・イベント</CardTitle>
        <CardDescription>トークンや記憶の全文は記録しません</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={() => void api.logs.openFolder()}>
            <FolderOpenIcon data-icon="inline-start" />
            ログフォルダ
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="logs">
          <TabsList>
            <TabsTrigger value="logs">ログ</TabsTrigger>
            <TabsTrigger value="events">イベント</TabsTrigger>
          </TabsList>
          <TabsContent value="logs" className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-1">
              {categories.map((c) => (
                <Badge
                  key={c}
                  variant={category === c ? 'default' : 'outline'}
                  render={<button type="button" onClick={() => setCategory(c)} />}
                  className="cursor-pointer"
                >
                  {c}
                </Badge>
              ))}
            </div>
            <div className="max-h-96 overflow-y-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">時刻</TableHead>
                    <TableHead className="w-28">分類</TableHead>
                    <TableHead>内容</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="font-mono text-2xs">
                  {filtered.map((l, i) => (
                    <TableRow key={`${l.at}-${i}`}>
                      <TableCell className="tabular-nums">{new Date(l.at).toLocaleTimeString('ja-JP')}</TableCell>
                      <TableCell>{l.category}</TableCell>
                      <TableCell className={cn('whitespace-pre-wrap', LEVEL_CLASS[l.level])}>
                        {l.message}
                        {l.data && Object.keys(l.data).length ? ` ${JSON.stringify(l.data)}` : ''}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
          <TabsContent value="events">
            <div className="max-h-96 overflow-y-auto rounded-xl border">
              <Table>
                <TableBody className="font-mono text-2xs">
                  {[...events].reverse().slice(0, 150).map((e, i) => (
                    <TableRow key={`${e.at}-${i}`}>
                      <TableCell className="w-24 tabular-nums">{new Date(e.at).toLocaleTimeString('ja-JP')}</TableCell>
                      <TableCell className="w-52 font-bold">{e.type}</TableCell>
                      <TableCell className="whitespace-pre-wrap">{e.summary}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

export function DebugPage() {
  return (
    <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 xl:grid-cols-2">
      <HealthCard />
      <SinsTool />
      <AppearanceCard />
      <LogsCard />
    </div>
  )
}
