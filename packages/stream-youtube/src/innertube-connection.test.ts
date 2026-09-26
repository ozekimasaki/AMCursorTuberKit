import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { YouTubeInnertubeAdapter } from './innertube'

class FakeChat {
  stopped = false
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>()

  on(type: string, listener: (...args: unknown[]) => void) {
    const set = this.listeners.get(type) ?? new Set()
    set.add(listener)
    this.listeners.set(type, set)
  }

  once(type: string, listener: (...args: unknown[]) => void) {
    const wrapper = (...args: unknown[]) => {
      this.off(type, wrapper)
      listener(...args)
    }
    this.on(type, wrapper)
  }

  off(type: string, listener: (...args: unknown[]) => void) {
    this.listeners.get(type)?.delete(listener)
  }

  removeAllListeners() {
    this.listeners.clear()
  }

  stop() {
    this.stopped = true
  }

  start() {
    this.emit('start')
  }

  emit(type: string, ...args: unknown[]) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(...args)
  }

  listenerCount() {
    let n = 0
    for (const set of this.listeners.values()) n += set.size
    return n
  }
}

const mocks = vi.hoisted(() => ({
  chats: [] as FakeChat[],
  getInfo: vi.fn(),
}))

vi.mock('youtubei.js', () => ({
  Innertube: class {
    static async create() {
      return { getInfo: mocks.getInfo }
    }
  },
  Parser: { setParserErrorHandler() {} },
  YTNodes: { AddChatItemAction: class AddChatItemAction {} },
}))

function liveInfo(chat: FakeChat) {
  return { livechat: { is_replay: false }, getLiveChat: () => chat }
}

function unavailable(reason = 'Video unavailable') {
  return Object.assign(new Error('This video is unavailable'), { info: { status: 'ERROR', reason } })
}

const liveHtml =
  '<link rel="canonical" href="https://www.youtube.com/watch?v=dbwfbPPeXFI">"liveBroadcastDetails":{"isLiveNow":true}'

describe('YouTube（APIキー不要）の接続', () => {
  let adapter: YouTubeInnertubeAdapter

  beforeEach(() => {
    mocks.chats.length = 0
    mocks.getInfo.mockReset()
    mocks.getInfo.mockImplementation(async () => {
      const chat = new FakeChat()
      mocks.chats.push(chat)
      return liveInfo(chat)
    })
    vi.useFakeTimers()
  })

  afterEach(async () => {
    await adapter?.disconnect()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('ライブチャットが終わったら止めてから再接続し、前のリスナーを残さない', async () => {
    adapter = new YouTubeInnertubeAdapter({ target: 'dQw4w9WgXcQ' })
    await adapter.connect()
    const first = mocks.chats[0]
    expect(adapter.health()).toMatchObject({ state: 'connected' })

    first.emit('end')
    expect(first.stopped).toBe(true)
    expect(first.listenerCount()).toBe(0)
    expect(adapter.health().state).toBe('degraded')

    await vi.advanceTimersByTimeAsync(2_000)
    expect(mocks.chats).toHaveLength(2)
    expect(mocks.getInfo).toHaveBeenCalledTimes(2)
    expect(adapter.health()).toMatchObject({ state: 'connected' })

    first.emit('end')
    first.emit('chat-update', { is: () => true, item: { type: 'LiveChatTextMessage', id: 'old' } })
    expect(mocks.getInfo).toHaveBeenCalledTimes(2)
    expect(adapter.health()).toMatchObject({ state: 'connected', eventCount: 0 })

    await adapter.disconnect()
    expect(mocks.chats[1].stopped).toBe(true)
    expect(mocks.chats[1].listenerCount()).toBe(0)
    expect(adapter.health()).toMatchObject({ state: 'disconnected' })
  })

  it('存在しない動画や非公開の getInfo 失敗は再接続しない', async () => {
    mocks.getInfo.mockRejectedValue(unavailable('Private video'))
    adapter = new YouTubeInnertubeAdapter({ target: 'dQw4w9WgXcQ' })
    await adapter.connect()
    expect(adapter.health()).toMatchObject({
      state: 'error',
      message: 'この動画にはライブチャットがありません（配信終了後の可能性）',
    })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(mocks.getInfo).toHaveBeenCalledTimes(1)
  })

  it('通信失敗の getInfo は再接続する', async () => {
    const http = Object.assign(
      new Error('Request to https://www.youtube.com/youtubei/v1/player failed with status code 503'),
      {
        info: 'unavailable',
      },
    )
    mocks.getInfo.mockRejectedValueOnce(http)
    adapter = new YouTubeInnertubeAdapter({ target: 'dQw4w9WgXcQ' })
    await adapter.connect()
    expect(adapter.health().state).toBe('degraded')
    expect(adapter.health().message).toContain('status code 503')

    await vi.advanceTimersByTimeAsync(2_000)
    expect(mocks.getInfo).toHaveBeenCalledTimes(2)
    expect(adapter.health()).toMatchObject({ state: 'connected' })
  })

  it('チャンネル指定で動画が利用不可でも配信開始まで再接続する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(liveHtml, { status: 200 })),
    )
    mocks.getInfo.mockRejectedValue(unavailable())
    adapter = new YouTubeInnertubeAdapter({ target: 'https://www.youtube.com/@weathernews' })
    await adapter.connect()
    expect(adapter.health().state).toBe('degraded')
    expect(adapter.health().message).toContain('ライブチャットが見つかりません')
    expect(mocks.getInfo).toHaveBeenCalledTimes(1)
  })

  it('再接続を待つ間に切断したら、止めたチャットへつなぎ直さない', async () => {
    adapter = new YouTubeInnertubeAdapter({ target: 'dQw4w9WgXcQ' })
    await adapter.connect()
    const first = mocks.chats[0]
    first.emit('end')
    await adapter.disconnect()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(first.stopped).toBe(true)
    expect(mocks.chats).toHaveLength(1)
    expect(adapter.health()).toMatchObject({ state: 'disconnected' })
  })
})
