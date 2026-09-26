import { useEffect, useState } from 'react'
import { MonitorPlayIcon, MonitorXIcon, SquareIcon } from 'lucide-react'
import { BuiltinAvatarAdapter } from '@amctk/avatar-core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { api, isPreview } from '@/lib/api'
import { useRuntime, useSettings } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { HealthItem } from '@amctk/shared'
import { StatusDot, ToneIcon } from './components/bits'
import { NAV, PAGES, PHASE_META, TONE_CLASS, type PageId } from './meta'
import { AiPage } from './pages/AiPage'
import { AvatarPage } from './pages/AvatarPage'
import { DashboardPage } from './pages/DashboardPage'
import { DebugPage } from './pages/DebugPage'
import { MemoryPage } from './pages/MemoryPage'
import { StagePage } from './pages/StagePage'
import { StreamsPage } from './pages/StreamsPage'
import { VoicePage } from './pages/VoicePage'

const EMPTY_HEALTH: HealthItem[] = []

function pageFromHash(): PageId {
  const id = location.hash.replace('#', '')
  return id in PAGES ? (id as PageId) : 'dashboard'
}

/** サイドバーのロゴ：組み込みアバター（キャットリン）の顔を小さく動かす */
function Logo() {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!el) return
    const a = new BuiltinAvatarAdapter(el)
    void a.load({ kind: 'builtin', files: {}, options: { palette: 'cocoa', framing: 'face' } })
    a.setExpression('happy', 0.8)
    let raf = 0
    let last = performance.now()
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop)
      a.update(Math.min(100, t - last))
      last = t
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      void a.dispose()
    }
  }, [el])
  return <div ref={setEl} className="size-9 shrink-0" aria-hidden />
}

function AppSidebar({ page, onPage }: { page: PageId; onPage: (p: PageId) => void }) {
  const health = useRuntime((r) => r.health.items, EMPTY_HEALTH)
  const problems = health.filter((h) => h.level === 'error' || h.level === 'warn')
  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-1 pt-1">
          <Logo />
          <div className="min-w-0 leading-tight group-data-[collapsible=icon]:hidden">
            <div className="truncate text-sm font-extrabold">AMCursorTuberKit</div>
            <div className="truncate text-2xs font-medium text-muted-foreground">記憶と気分で話すAI配信</div>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {NAV.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.pages.map((p) => (
                  <SidebarMenuItem key={p.id}>
                    <SidebarMenuButton
                      isActive={page === p.id}
                      tooltip={p.label}
                      onClick={() => onPage(p.id)}
                      className="h-10 gap-2.5 rounded-xl font-bold"
                    >
                      <ToneIcon icon={p.icon} tone={p.tone} className="-ml-1 size-7" />
                      <span>{p.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <button
          type="button"
          onClick={() => onPage('debug')}
          className="press flex items-center gap-2 rounded-xl px-2 py-2 text-left text-xs font-bold hover:bg-sidebar-accent group-data-[collapsible=icon]:justify-center"
        >
          <StatusDot level={problems.some((p) => p.level === 'error') ? 'error' : problems.length ? 'warn' : 'ok'} />
          <span className="truncate group-data-[collapsible=icon]:hidden">
            {problems.length ? `${problems.length}件 確認が必要です` : 'すべて正常に動いています'}
          </span>
        </button>
      </SidebarFooter>
    </Sidebar>
  )
}

function AgentPhasePill() {
  const phase = useRuntime((r) => r.agent.phase, 'idle')
  const provider = useRuntime((r) => r.agent.provider, 'demo')
  const queue = useRuntime((r) => r.ttsQueue, 0)
  const meta = PHASE_META[phase]
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge variant="secondary" className={cn('h-8 gap-1.5 rounded-full border-transparent px-3 font-bold', TONE_CLASS[meta.tone])} />
        }
      >
        <span className={cn('size-2 rounded-full bg-current', phase !== 'idle' && 'animate-pulse')} />
        {meta.label}
        {queue > 1 && <span className="tabular-nums opacity-70">・残り{queue - 1}文</span>}
      </TooltipTrigger>
      <TooltipContent>{provider === 'cursor' ? 'Cursor SDK で応答中' : 'デモ応答（Cursor未接続）'}</TooltipContent>
    </Tooltip>
  )
}

function StageButton() {
  const open = useRuntime((r) => r.stageOpen, false)
  return open ? (
    <Button variant="outline" onClick={() => void api.stage.close()}>
      <MonitorXIcon data-icon="inline-start" />
      ステージを閉じる
    </Button>
  ) : (
    <Button onClick={() => void api.stage.open()}>
      <MonitorPlayIcon data-icon="inline-start" />
      ステージを開く
    </Button>
  )
}

export function App() {
  const [page, setPageState] = useState<PageId>(() => pageFromHash())
  const setPage = (p: PageId) => {
    setPageState(p)
    history.replaceState(null, '', `#${p}`)
  }
  useEffect(() => {
    const onHash = () => setPageState(pageFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const [settings] = useSettings()
  const phase = useRuntime((r) => r.agent.phase, 'idle')
  const meta = PAGES[page]

  useEffect(() => {
    const dark = settings?.ui.theme === 'dark' || (settings?.ui.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.classList.toggle('dark', !!dark)
    document.documentElement.classList.toggle('reduce-motion', !!settings?.ui.reduceMotion)
  }, [settings?.ui.theme, settings?.ui.reduceMotion])

  return (
    <SidebarProvider>
      <AppSidebar page={page} onPage={setPage} />
      <SidebarInset className="surface-dots min-w-0">
        <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-3 border-b bg-background/85 px-5 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <ToneIcon icon={meta.icon} tone={meta.tone} className="size-9 rounded-xl" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg leading-tight font-extrabold">{meta.label}</h1>
            <p className="truncate text-xs text-muted-foreground">{meta.description}</p>
          </div>
          {isPreview && (
            <Badge variant="outline" className="font-bold">
              ブラウザプレビュー
            </Badge>
          )}
          <AgentPhasePill />
          {(phase === 'thinking' || phase === 'speaking' || phase === 'recalling') && (
            <Tooltip>
              <TooltipTrigger render={<Button variant="outline" size="icon" aria-label="止める" onClick={() => void api.agent.cancel()} />}>
                <SquareIcon />
              </TooltipTrigger>
              <TooltipContent>返答と読み上げを止める</TooltipContent>
            </Tooltip>
          )}
          <StageButton />
        </header>
        <main key={page} className="enter-pop min-h-0 flex-1 p-5">
          {page === 'dashboard' && <DashboardPage onNavigate={setPage} />}
          {page === 'stage' && <StagePage />}
          {page === 'avatar' && <AvatarPage />}
          {page === 'voice' && <VoicePage />}
          {page === 'ai' && <AiPage />}
          {page === 'memory' && <MemoryPage />}
          {page === 'streams' && <StreamsPage />}
          {page === 'debug' && <DebugPage />}
        </main>
      </SidebarInset>
      <Toaster position="bottom-right" theme={settings?.ui.theme === 'dark' ? 'dark' : 'light'} />
    </SidebarProvider>
  )
}
