import { describe, expect, it } from 'vitest'
import { Parser } from 'youtubei.js'
import { mapInnertubeChatItem, parseYouTubeAmount, type InnertubeChatItem } from './innertube'
import { extractLiveVideoId } from './target'

// InnerTube の生データを youtubei.js 本体で解析してから変換する（ライブラリ側の項目名の変更を検知するため）
const parse = (raw: object) => Parser.parseItem(raw) as unknown as InnertubeChatItem
const usec = String(Date.now() * 1000)
const menu = { contextMenuEndpoint: {}, contextMenuAccessibility: { accessibilityData: { label: 'チャットの操作' } } }
const author = (name: string, channelId: string, badges: object[] = []) => ({
  authorName: { simpleText: name },
  authorPhoto: { thumbnails: [] },
  authorBadges: badges,
  authorExternalChannelId: channelId,
})
const moderator = { liveChatAuthorBadgeRenderer: { icon: { iconType: 'MODERATOR' }, tooltip: 'モデレーター' } }
const owner = { liveChatAuthorBadgeRenderer: { icon: { iconType: 'OWNER' }, tooltip: '所有者' } }
const member = {
  liveChatAuthorBadgeRenderer: {
    customThumbnail: { thumbnails: [{ url: 'https://yt3.ggpht.com/badge', width: 16, height: 16 }] },
    tooltip: 'メンバー（2 か月）',
  },
}

describe('YouTube（APIキー不要）', () => {
  it('通常コメントとバッジを正規化する', () => {
    const e = mapInnertubeChatItem(
      parse({
        liveChatTextMessageRenderer: {
          id: 't1',
          timestampUsec: usec,
          message: { runs: [{ text: 'こんばんは、' }, { text: 'はじめまして' }] },
          ...author('@mochiko', 'UC1', [moderator, member]),
          ...menu,
        },
      }),
    )
    expect(e).toMatchObject({
      id: 'yt:t1',
      platform: 'youtube',
      kind: 'chat',
      text: 'こんばんは、はじめまして',
      viewer: { platformUserId: 'UC1', displayName: '@mochiko', isModerator: true, isMember: true, isOwner: false },
    })
    const byOwner = mapInnertubeChatItem(
      parse({
        liveChatTextMessageRenderer: {
          id: 't2',
          timestampUsec: usec,
          message: { runs: [{ text: 'はじめます' }] },
          ...author('@me', 'UC2', [owner]),
          ...menu,
        },
      }),
    )
    expect(byOwner?.viewer).toMatchObject({ isOwner: true, isModerator: false, isMember: false })
  })

  it('スーパーチャットの金額を数値と通貨に分ける', () => {
    const e = mapInnertubeChatItem(
      parse({
        liveChatPaidMessageRenderer: {
          id: 'p1',
          timestampUsec: usec,
          purchaseAmountText: { simpleText: '￥1,000' },
          message: { runs: [{ text: 'がんばって' }] },
          ...author('@fan', 'UC9', [member]),
          headerBackgroundColor: 0,
          headerTextColor: 0,
          bodyBackgroundColor: 0,
          bodyTextColor: 0,
          authorNameTextColor: 0,
          timestampColor: 0,
          ...menu,
        },
      }),
    )
    expect(e).toMatchObject({
      id: 'yt:p1',
      kind: 'superchat',
      text: 'がんばって',
      amount: { value: 1000, currency: 'JPY', display: '￥1,000' },
    })
  })

  it('メンバー加入とメンバーシップギフトを正規化する', () => {
    const join = mapInnertubeChatItem(
      parse({
        liveChatMembershipItemRenderer: {
          id: 'm1',
          timestampUsec: usec,
          headerSubtext: { runs: [{ text: 'メンバーシップ「ねこ部」へようこそ！' }] },
          ...author('@newbie', 'UC5'),
          ...menu,
        },
      }),
    )
    expect(join).toMatchObject({
      kind: 'subscribe',
      text: 'メンバーシップ「ねこ部」へようこそ！',
      viewer: { platformUserId: 'UC5' },
    })

    const gift = mapInnertubeChatItem(
      parse({
        liveChatSponsorshipsGiftPurchaseAnnouncementRenderer: {
          id: 'g1',
          timestampUsec: usec,
          authorExternalChannelId: 'UC7',
          header: {
            liveChatSponsorshipsHeaderRenderer: {
              authorName: { simpleText: '@santa' },
              authorPhoto: { thumbnails: [] },
              authorBadges: [member],
              primaryText: { runs: [{ text: '5 件のメンバーシップをギフトしました' }] },
              image: { thumbnails: [] },
              ...menu,
            },
          },
        },
      }),
    )
    expect(gift).toMatchObject({
      kind: 'gift',
      text: '5 件のメンバーシップをギフトしました',
      viewer: { platformUserId: 'UC7', displayName: '@santa', isMember: true },
    })
  })

  it('使わない項目は null', () => {
    expect(mapInnertubeChatItem({ type: 'LiveChatPlaceholderItem', id: 'x' })).toBeNull()
    expect(mapInnertubeChatItem({ type: 'LiveChatTextMessage' })).toBeNull()
  })

  it('金額表示から通貨を判別する', () => {
    expect(parseYouTubeAmount('$5.00')).toMatchObject({ value: 5, currency: 'USD' })
    expect(parseYouTubeAmount('CA$2.00')).toMatchObject({ value: 2, currency: 'CAD' })
    expect(parseYouTubeAmount('€2,50')).toMatchObject({ value: 2.5, currency: 'EUR' })
    expect(parseYouTubeAmount('₩10,000')).toMatchObject({ value: 10000, currency: 'KRW' })
    expect(parseYouTubeAmount('PHP 1,000.00')).toMatchObject({ value: 1000, currency: 'PHP' })
    expect(parseYouTubeAmount('???')).toMatchObject({ value: 0, currency: '', display: '???' })
  })

  it('チャンネルの /live ページから配信中・配信予定の枠だけを取り出す', () => {
    const canonical = '<link rel="canonical" href="https://www.youtube.com/watch?v=dbwfbPPeXFI">'
    expect(extractLiveVideoId(`${canonical}{"isLiveNow":true}`)).toBe('dbwfbPPeXFI')
    expect(extractLiveVideoId(`${canonical}{"isUpcoming":true}`)).toBe('dbwfbPPeXFI')
    expect(extractLiveVideoId(`${canonical}{"isLiveNow":false}`)).toBeNull()
    expect(extractLiveVideoId('<link rel="canonical" href="https://www.youtube.com/@weathernews">')).toBeNull()
  })
})
