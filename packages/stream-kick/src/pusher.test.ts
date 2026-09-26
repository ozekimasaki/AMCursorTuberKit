import type { StreamEvent } from '@amctk/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KickPusherAdapter } from './pusher'

/** Pusher の代わり。購読すると成功を返し、テストから任意のイベントを流せる */
class FakePusher {
  static OPEN = 1
  static sockets: FakePusher[] = []
  readyState = 1
  onmessage?: (ev: { data: string }) => void
  onclose?: (ev: { code: number }) => void
  onerror?: () => void

  constructor(readonly url: string) {
    FakePusher.sockets.push(this)
    queueMicrotask(() => this.push('pusher:connection_established', { socket_id: '1.2', activity_timeout: 120 }))
  }

  send(raw: string) {
    const msg = JSON.parse(raw) as { event: string }
    if (msg.event === 'pusher:subscribe') queueMicrotask(() => this.push('pusher_internal:subscription_succeeded', {}))
  }

  close() {
    if (this.readyState === 3) return
    this.readyState = 3
    queueMicrotask(() => this.onclose?.({ code: 1000 }))
  }

  /** Pusher と同じく、data は JSON 文字列にして送る */
  push(event: string, data: object) {
    this.onmessage?.({ data: JSON.stringify({ event, data: JSON.stringify(data) }) })
  }
}

beforeEach(() => {
  FakePusher.sockets = []
  vi.stubGlobal('WebSocket', FakePusher)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Kick（APIキー不要）の接続', () => {
  it('チャットルームIDを調べている間に切断されたら、接続しない', async () => {
    let found!: (id: number) => void
    const a = new KickPusherAdapter({
      channelSlug: 'xqc',
      resolveChatroomId: () => new Promise((resolve) => (found = resolve)),
    })
    const connecting = a.connect()
    await a.disconnect()
    found(668)
    await connecting
    expect(FakePusher.sockets).toHaveLength(0)
    expect(a.health()).toMatchObject({ state: 'disconnected' })
  })

  it('サブスク・ギフト・ホストの視聴者IDを、チャットで見たIDか調べた数値のIDにそろえる', async () => {
    const lookups: string[] = []
    const a = new KickPusherAdapter({
      channelSlug: 'xqc',
      chatroomId: 668,
      resolveChatroomId: async () => 668,
      resolveUserId: async (username) => {
        lookups.push(username)
        return username === 'santa' ? 42 : undefined
      },
    })
    await a.connect()
    const got: StreamEvent[] = []
    const reading = (async () => {
      for await (const e of a.events()) got.push(e)
    })()

    const ws = FakePusher.sockets[0]
    ws.push('App\\Events\\ChatMessageEvent', {
      id: 'm1',
      content: 'やあ',
      sender: { id: 5, username: 'Fan', slug: 'fan' },
    })
    ws.push('App\\Events\\SubscriptionEvent', { chatroom_id: 668, username: 'Fan', months: 2 })
    ws.push('App\\Events\\GiftedSubscriptionsEvent', {
      chatroom_id: 668,
      gifted_usernames: ['a'],
      gifter_username: 'santa',
    })
    ws.push('App\\Events\\StreamHostEvent', { chatroom_id: 668, host_username: 'stranger', number_viewers: 3 })
    await vi.waitFor(() => expect(got).toHaveLength(4))
    await a.disconnect()
    await reading

    expect(got).toMatchObject([
      { kind: 'chat', viewer: { platformUserId: '5' } },
      { kind: 'subscribe', viewer: { platformUserId: '5', displayName: 'Fan' } },
      { kind: 'gift', viewer: { platformUserId: '42', displayName: 'santa' } },
      // 調べられなければユーザー名のまま
      { kind: 'raid', viewer: { platformUserId: 'stranger' } },
    ])
    expect(lookups).toMatchObject(['santa', 'stranger'])
  })

  it('再試行のたびに設定を読み直し、途中で入力されたチャットルームIDを使う', async () => {
    const settings = { chatroomId: undefined as number | undefined }
    const a = new KickPusherAdapter({
      channelSlug: 'xqc',
      get chatroomId() {
        return settings.chatroomId
      },
      resolveChatroomId: async () => {
        throw new Error('Kick のチャンネル情報を取得できませんでした (HTTP 403)')
      },
    })
    vi.useFakeTimers()
    try {
      await a.connect()
      expect(a.health()).toMatchObject({ state: 'degraded' })
      settings.chatroomId = 668
      await vi.advanceTimersByTimeAsync(2_000)
      expect(a.health()).toMatchObject({ state: 'connected' })
    } finally {
      await a.disconnect()
      vi.useRealTimers()
    }
  })
})
