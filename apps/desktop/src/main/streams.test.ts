import { describe, expect, it } from 'vitest'
import { mapKickWebhook } from '@amctk/stream-kick'
import { normalizeTikTokBridgeMessage } from '@amctk/stream-tiktok'
import { mapTwitchEvent } from '@amctk/stream-twitch'
import { mapYouTubeItem, parseYouTubeTarget } from '@amctk/stream-youtube'
import { JsonObjectStreamParser } from '@amctk/stream-core'

describe('JsonObjectStreamParser', () => {
  it('JSON配列がチャンクで届いても1オブジェクトずつ取り出す', () => {
    const p = new JsonObjectStreamParser()
    expect(p.push('[{"a":1,"s":"}{"}')).toEqual([{ a: 1, s: '}{' }])
    expect(p.push(',{"b":{"c"')).toEqual([])
    expect(p.push(':2}}]')).toEqual([{ b: { c: 2 } }])
  })
})

describe('YouTube', () => {
  it('URL / 動画ID / liveChatId を判別する', () => {
    expect(parseYouTubeTarget('https://www.youtube.com/watch?v=abcdefghijk&t=1')).toEqual({ videoId: 'abcdefghijk' })
    expect(parseYouTubeTarget('https://youtube.com/live/abcdefghijk')).toEqual({ videoId: 'abcdefghijk' })
    expect(parseYouTubeTarget('abcdefghijk')).toEqual({ videoId: 'abcdefghijk' })
    expect(parseYouTubeTarget('Cg0KC2FiY2RlZmdoaWpr')).toEqual({ liveChatId: 'Cg0KC2FiY2RlZmdoaWpr' })
  })

  it('スーパーチャットを共通イベントへ正規化する', () => {
    const e = mapYouTubeItem({
      id: 'm1',
      snippet: {
        type: 'superChatEvent',
        superChatDetails: { amountMicros: '1000000000', currency: 'JPY', amountDisplayString: '¥1,000', userComment: 'がんばって' },
      },
      authorDetails: { channelId: 'UC1', displayName: 'もちこ', isChatSponsor: true },
    })
    expect(e).toMatchObject({ id: 'yt:m1', kind: 'superchat', text: 'がんばって', amount: { value: 1000, currency: 'JPY' } })
    expect(e?.viewer).toMatchObject({ platform: 'youtube', platformUserId: 'UC1', isMember: true })
  })
})

describe('Twitch', () => {
  it('channel.chat.message の Cheer を cheer として扱う', () => {
    const e = mapTwitchEvent(
      'channel.chat.message',
      { message_id: 'x', chatter_user_id: '9', chatter_user_name: 'Kuma', message: { text: 'Cheer100 がんば' }, cheer: { bits: 100 }, badges: [{ set_id: 'moderator' }] },
      'meta',
    )
    expect(e).toMatchObject({ id: 'tw:x', kind: 'cheer', amount: { value: 100 }, viewer: { isModerator: true } })
  })
})

describe('Kick', () => {
  it('chat.message.sent を正規化する', () => {
    const e = mapKickWebhook(
      'chat.message.sent',
      { message_id: 'k1', content: 'やっほー', sender: { user_id: 5, username: 'kicker', identity: { badges: [{ type: 'subscriber' }] } } },
      'k1',
    )
    expect(e).toMatchObject({ kind: 'chat', text: 'やっほー', viewer: { platformUserId: '5', displayName: 'kicker', isMember: true } })
    expect(mapKickWebhook('unknown.event', {}, '')).toBeNull()
  })
})

describe('TikTok bridge', () => {
  it('TikFinity形式のchat/giftを受け付ける', () => {
    const chat = normalizeTikTokBridgeMessage({ event: 'chat', data: { comment: 'hi', uniqueId: 'u', nickname: 'ゆー', msgId: '1' } }, 1)
    expect(chat).toMatchObject({ id: 'tt:1', kind: 'chat', text: 'hi', viewer: { displayName: 'ゆー' } })
    const gift = normalizeTikTokBridgeMessage({ event: 'gift', data: { giftName: 'Rose', repeatCount: 3, diamondCount: 1, uniqueId: 'u' } }, 2)
    expect(gift).toMatchObject({ kind: 'gift', amount: { value: 3 } })
    expect(normalizeTikTokBridgeMessage({ event: 'like' }, 3)).toBeNull()
  })
})
