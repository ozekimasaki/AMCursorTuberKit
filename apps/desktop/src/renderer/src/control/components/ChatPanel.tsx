import { useState } from 'react'
import { MegaphoneIcon, SendHorizonalIcon, SparklesIcon, UserRoundIcon } from 'lucide-react'
import { EMOTION_META, SIN_META, isSinKey, type ConversationEntry } from '@amctk/shared'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupTextarea } from '@/components/ui/input-group'
import { Kbd } from '@/components/ui/kbd'
import { Marker, MarkerContent } from '@/components/ui/marker'
import { Message, MessageAvatar, MessageContent, MessageFooter, MessageHeader } from '@/components/ui/message'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api } from '@/lib/api'
import { useRuntime, useSettings } from '@/lib/store'
import { PlatformBadge } from './bits'

const EMPTY: ConversationEntry[] = []

function DeltaChips({ entry }: { entry: ConversationEntry }) {
  const delta = Object.entries(entry.sinDelta ?? {}).filter(([k, v]) => isSinKey(k) && v)
  if (!delta.length && !entry.emotion) return null
  return (
    <div className="flex flex-wrap items-center gap-1">
      {entry.emotion && (
        <span className="rounded-full bg-muted px-2 py-0.5 text-2xs font-bold">
          {EMOTION_META[entry.emotion].emoji} {EMOTION_META[entry.emotion].ja}
        </span>
      )}
      {delta.map(([k, v]) => (
        <span
          key={k}
          className="rounded-full px-2 py-0.5 text-2xs font-bold text-white tabular-nums"
          style={{ background: `var(--sin-${k})` }}
        >
          {SIN_META[k as keyof typeof SIN_META].ja} {v! > 0 ? `+${v}` : v}
        </span>
      ))}
    </div>
  )
}

function Row({ entry, characterName }: { entry: ConversationEntry; characterName: string }) {
  const time = new Date(entry.at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  if (entry.role === 'system') {
    return (
      <Marker variant="separator">
        <MarkerContent className="text-xs">{entry.text}</MarkerContent>
      </Marker>
    )
  }
  if (entry.role === 'character') {
    return (
      <Message align="start" className="[animation:bubble-in_240ms_var(--ease-out)_both]">
        <MessageAvatar>
          <Avatar className="size-8">
            <AvatarFallback className="bg-candy-pink-soft font-extrabold text-primary">
              {characterName.slice(0, 1)}
            </AvatarFallback>
          </Avatar>
        </MessageAvatar>
        <MessageContent>
          <MessageHeader>{characterName}</MessageHeader>
          <Bubble variant="tinted">
            <BubbleContent className="text-[0.92rem]">
              {entry.text || <span className="inline-flex gap-1 py-1">
                <span className="size-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-primary" />
              </span>}
            </BubbleContent>
          </Bubble>
          <MessageFooter className="gap-2">
            <span>{time}</span>
            <DeltaChips entry={entry} />
          </MessageFooter>
        </MessageContent>
      </Message>
    )
  }
  return (
    <Message align="end" className="[animation:bubble-in_240ms_var(--ease-out)_both]">
      <MessageContent>
        <MessageHeader className="gap-1.5">
          {entry.platform && <PlatformBadge platform={entry.platform} />}
          <span>{entry.viewerName}</span>
        </MessageHeader>
        <Bubble variant="outline" align="end">
          <BubbleContent className="text-[0.92rem]">{entry.text}</BubbleContent>
        </Bubble>
        <MessageFooter>{time}</MessageFooter>
      </MessageContent>
    </Message>
  )
}

export function ChatPanel() {
  const conversation = useRuntime((r) => r.conversation, EMPTY)
  const [settings] = useSettings()
  const name = settings?.character.name ?? 'キャラクター'

  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport>
          <MessageScrollerContent className="gap-4 px-4 py-4">
            {conversation.length === 0 && (
              <MessageScrollerItem messageId="empty">
                <Empty className="border-none py-10">
                  <EmptyHeader>
                    <EmptyMedia variant="icon" className="bg-candy-pink-soft text-primary">
                      <SparklesIcon />
                    </EmptyMedia>
                    <EmptyTitle>まだ会話がありません</EmptyTitle>
                    <EmptyDescription>下の入力欄から話しかけるか、配信サービスを接続してください。</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </MessageScrollerItem>
            )}
            {conversation.map((entry) => (
              <MessageScrollerItem key={entry.id} messageId={entry.id} scrollAnchor={entry.role === 'viewer'}>
                <Row entry={entry} characterName={name} />
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}

export function Composer() {
  const [text, setText] = useState('')
  const [viewer, setViewer] = useState('')
  const [mode, setMode] = useState<'talk' | 'say'>('talk')

  const send = () => {
    const t = text.trim()
    if (!t) return
    void api.agent.submit({ text: t, viewerName: viewer.trim() || undefined, direct: mode === 'say' })
    setText('')
  }

  return (
    <div className="flex flex-col gap-2 border-t bg-card/70 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          value={[mode]}
          onValueChange={(v) => v[0] && setMode(v[0] as 'talk' | 'say')}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="talk" className="font-bold">
            <SparklesIcon data-icon="inline-start" />
            話しかける
          </ToggleGroupItem>
          <ToggleGroupItem value="say" className="font-bold">
            <MegaphoneIcon data-icon="inline-start" />
            そのまま読む
          </ToggleGroupItem>
        </ToggleGroup>
        {mode === 'talk' && (
          <InputGroup className="h-7 w-44">
            <InputGroupAddon>
              <UserRoundIcon />
            </InputGroupAddon>
            <InputGroupInput value={viewer} onChange={(e) => setViewer(e.target.value)} placeholder="名前（空欄=配信者）" className="text-xs" />
          </InputGroup>
        )}
        <span className="ml-auto hidden items-center gap-1 text-2xs text-muted-foreground sm:flex">
          <Kbd>Enter</Kbd> 送信 / <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> 改行
        </span>
      </div>
      <InputGroup className="rounded-2xl">
        <InputGroupTextarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
          rows={2}
          placeholder={mode === 'talk' ? 'キャラクターに話しかける…（AIが返事をします）' : 'キャラクターにそのまま読ませる文章…'}
          className="min-h-14 text-[0.92rem]"
        />
        <InputGroupAddon align="block-end" className="justify-end">
          <InputGroupButton variant="default" size="sm" disabled={!text.trim()} onClick={send}>
            <SendHorizonalIcon data-icon="inline-start" />
            {mode === 'talk' ? '送る' : '読み上げ'}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

export function QueueEmptyHint() {
  return (
    <Button variant="outline" size="sm" onClick={() => void api.stream.injectTest(8)}>
      テストコメントを流す
    </Button>
  )
}
