import { describe, expect, it } from 'vitest'
import { createKickChatroomResolver, createKickUserIdResolver, mapKickPusherEvent, mapKickWebhook, normalizeKickSlug } from '@amctk/stream-kick'
import { FatalStreamError } from '@amctk/stream-core'
import { normalizeTikTokBridgeMessage } from '@amctk/stream-tiktok'
import { mapTwitchEvent, mapTwitchIrcMessage, mapTwitchIrcNotice, normalizeTwitchLogin, twitchJoinError } from '@amctk/stream-twitch'
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

  it('チャンネル（@ハンドル / チャンネルURL / チャンネルID）を判別する', () => {
    expect(parseYouTubeTarget('@weathernews')).toEqual({ channelPath: '@weathernews' })
    expect(parseYouTubeTarget('https://www.youtube.com/@weathernews/live')).toEqual({ channelPath: '@weathernews' })
    expect(parseYouTubeTarget('https://www.youtube.com/channel/UCNsidkYpIAQ4QaufptQBPHQ')).toEqual({ channelPath: 'channel/UCNsidkYpIAQ4QaufptQBPHQ' })
    expect(parseYouTubeTarget('UCNsidkYpIAQ4QaufptQBPHQ')).toEqual({ channelPath: 'channel/UCNsidkYpIAQ4QaufptQBPHQ' })
  })

  it('日本語のハンドル、アドレス欄からコピーしたURL、Studio の配信画面のURLも判別する', () => {
    expect(parseYouTubeTarget('@しぐれうい')).toMatchObject({ channelPath: '@しぐれうい' })
    expect(parseYouTubeTarget('https://www.youtube.com/@%E3%81%97%E3%81%90%E3%82%8C/live')).toMatchObject({ channelPath: '@しぐれ' })
    // ASCII で始まるハンドルが途中で切れて別のチャンネルにならない
    expect(parseYouTubeTarget('https://www.youtube.com/@abc%E3%82%A6')).toMatchObject({ channelPath: '@abcウ' })
    expect(parseYouTubeTarget('https://studio.youtube.com/video/abcdefghijk/livestreaming')).toMatchObject({ videoId: 'abcdefghijk' })
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

describe('Twitch（ログイン不要）', () => {
  const user = { userId: '9', userName: 'kuma', displayName: 'Kuma', isMod: true, isSubscriber: false, isBroadcaster: false }

  it('チャンネル名はURLや # 付きでも受け付ける', () => {
    expect(normalizeTwitchLogin('https://www.twitch.tv/Kato_Junichi0817?tab=about')).toBe('kato_junichi0817')
    expect(normalizeTwitchLogin(' #xqc ')).toBe('xqc')
  })

  it('ポップアウトのチャットやモデレーター画面のURL、スキームの無いURLからもチャンネル名を取り出す', () => {
    expect(normalizeTwitchLogin('https://www.twitch.tv/popout/xqc/chat?popout=')).toBe('xqc')
    expect(normalizeTwitchLogin('https://www.twitch.tv/moderator/xqc')).toBe('xqc')
    expect(normalizeTwitchLogin('https://dashboard.twitch.tv/u/xqc/stream-manager')).toBe('xqc')
    expect(normalizeTwitchLogin('twitch.tv/xqc')).toBe('xqc')
  })

  it('参加の応答が無いだけなら再試行し、それ以外の参加失敗は再試行しない', () => {
    expect(twitchJoinError('xqc', 'twurple_timeout')).not.toBeInstanceOf(FatalStreamError)
    expect(twitchJoinError('xqc', 'msg_channel_suspended')).toBeInstanceOf(FatalStreamError)
  })

  it('Cheer 付きのメッセージを cheer として扱う', () => {
    expect(mapTwitchIrcMessage({ id: 'a', text: 'Cheer100 がんば', bits: 100, user })).toMatchObject({
      id: 'tw:a',
      kind: 'cheer',
      amount: { value: 100, currency: 'bits' },
      viewer: { platformUserId: '9', displayName: 'Kuma', isModerator: true },
    })
    expect(mapTwitchIrcMessage({ id: 'b', text: 'やあ', bits: 0, user }).kind).toBe('chat')
  })

  it('サブスク・ギフト・レイドを正規化する', () => {
    expect(mapTwitchIrcNotice('s', user, { type: 'sub', months: 3 })).toMatchObject({ id: 'tw:s', kind: 'subscribe', text: 'サブスクしました（3か月）' })
    expect(mapTwitchIrcNotice('g', user, { type: 'gift', count: 5 })).toMatchObject({ kind: 'gift', text: 'サブスクを5件ギフト' })
    expect(mapTwitchIrcNotice('r', user, { type: 'raid', viewers: 120 })).toMatchObject({ kind: 'raid', text: '120人でレイドしました' })
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

describe('Kick（APIキー不要）', () => {
  it('チャンネル名はURLでも受け付ける', () => {
    expect(normalizeKickSlug('https://kick.com/XQC?tab=vods')).toBe('xqc')
  })

  it('ポップアウトのURL、スキームの無いURL、_ を含むユーザー名からも slug を取り出す', () => {
    expect(normalizeKickSlug('https://kick.com/popout/xqc/chat')).toBe('xqc')
    expect(normalizeKickSlug('kick.com/xqc')).toBe('xqc')
    // slug では _ が - になる（kick.com/api/v2/channels/sir_fas は 404）
    expect(normalizeKickSlug('@Sir_Fas')).toBe('sir-fas')
  })

  it('ユーザー名から数値のユーザーIDを調べ、調べられなければ undefined にする', async () => {
    const urls: string[] = []
    const resolve = createKickUserIdResolver(async (url) => {
      urls.push(url)
      return new Response(JSON.stringify({ id: 111419511, user_id: 112662668, slug: 'sir-fas' }), { status: 200 })
    })
    expect(await resolve('Sir_Fas')).toBe(112662668)
    expect(await resolve('sir_fas')).toBe(112662668)
    expect(urls).toEqual(['https://kick.com/api/v2/channels/sir-fas'])
    const blocked = createKickUserIdResolver(async () => new Response('', { status: 403 }))
    expect(await blocked('fan')).toBeUndefined()
  })

  it('Pusher の ChatMessageEvent を正規化し、エモート表記を読みやすくする', () => {
    const e = mapKickPusherEvent('App\\Events\\ChatMessageEvent', {
      id: 'uuid-1',
      chatroom_id: 668,
      content: 'やっほー [emote:37226:KEKW]',
      type: 'message',
      created_at: '2026-09-26T00:00:00Z',
      sender: {
        id: 5,
        username: 'kicker',
        slug: 'kicker',
        identity: { color: '#ffffff', badges: [{ type: 'subscriber', text: 'Subscriber', count: 3 }, { type: 'moderator', text: 'Moderator' }] },
      },
      metadata: { message_ref: '1' },
    })
    expect(e).toMatchObject({
      id: 'kick:uuid-1',
      kind: 'chat',
      text: 'やっほー :KEKW:',
      viewer: { platformUserId: '5', displayName: 'kicker', isMember: true, isModerator: true, isOwner: false },
    })
  })

  it('サブスク・ギフト・ホストを正規化し、使わないイベントは null', () => {
    expect(mapKickPusherEvent('App\\Events\\SubscriptionEvent', { chatroom_id: 1, username: 'fan', months: 2 })).toMatchObject({
      kind: 'subscribe',
      text: 'サブスクしました（2か月）',
      viewer: { displayName: 'fan' },
    })
    expect(mapKickPusherEvent('App\\Events\\GiftedSubscriptionsEvent', { chatroom_id: 1, gifted_usernames: ['a', 'b'], gifter_username: 'santa' })).toMatchObject({
      kind: 'gift',
      text: 'サブスクを2件ギフト',
    })
    expect(mapKickPusherEvent('App\\Events\\StreamHostEvent', { chatroom_id: 1, host_username: 'friend', number_viewers: 30, optional_message: '' })).toMatchObject({
      kind: 'raid',
      text: '30人でホストしました',
    })
    expect(mapKickPusherEvent('App\\Events\\MessageDeletedEvent', { id: 'x', message: { id: 'y' } })).toBeNull()
  })

  it('チャットルームIDは渡された fetch で調べ、同じチャンネルは再取得しない', async () => {
    const urls: string[] = []
    const resolve = createKickChatroomResolver(async (url) => {
      urls.push(url)
      return new Response(JSON.stringify({ id: 1, chatroom: { id: 668 } }), { status: 200 })
    })
    expect(await resolve('xqc')).toBe(668)
    expect(await resolve('xqc')).toBe(668)
    expect(urls).toEqual(['https://kick.com/api/v2/channels/xqc'])
  })

  it('存在しないチャンネルは再試行しないエラー、Cloudflare の 403 は再試行するエラーにする', async () => {
    const notFound = createKickChatroomResolver(async () => new Response('', { status: 404 }))
    await expect(notFound('nobody')).rejects.toBeInstanceOf(FatalStreamError)
    const blocked = createKickChatroomResolver(async () => new Response('', { status: 403 }))
    const err = await blocked('xqc').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(FatalStreamError)
    expect(String(err)).toContain('チャットルームID')
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
