import { sleep, type AvatarEmotion, type ModelOption, type SinDelta } from '@amctk/shared'
import type { AgentHealth, AgentRunHandlers, AgentRunResult, CharacterAgent, TurnContext } from './types'

interface Rule {
  test: RegExp
  emotion: AvatarEmotion
  delta: SinDelta
  replies: string[]
}

const RULES: Rule[] = [
  {
    test: /(こんにち|こんばん|おはよ|はじめまして|初見|hello|hi\b)/i,
    emotion: 'happy',
    delta: { sloth: -3, lust: 2 },
    replies: ['{name}さん、いらっしゃい！来てくれてうれしいよ。', '{name}さん、やっほー！今日もゆっくりしていってね。'],
  },
  {
    test: /(かわいい|可愛い|すごい|天才|えらい|上手)/,
    emotion: 'smug',
    delta: { pride: 6, lust: 2 },
    replies: ['えへへ、でしょー？もっと褒めてくれてもいいんだよ。', 'ふふん、{first}の実力、わかってきたみたいだね！'],
  },
  {
    test: /(プリン|ごはん|ご飯|食べ|おなか|お腹|ラーメン|ケーキ|お菓子)/,
    emotion: 'happy',
    delta: { gluttony: 7, sloth: -2 },
    replies: ['その話はずるい！おなかすいてきちゃった。', '食べ物の話なら任せて。{first}、プリンなら三個はいけるよ！'],
  },
  {
    test: /(ねむ|眠|おやすみ|疲れ|つかれ)/,
    emotion: 'sleepy',
    delta: { sloth: 7 },
    replies: ['わかる……{first}もちょっと眠くなってきたかも。', 'ふわぁ……あっ、あくびがうつっちゃった。'],
  },
  {
    test: /(ばか|バカ|うざ|へた|下手|ポンコツ)/i,
    emotion: 'angry',
    delta: { wrath: 7, pride: -3 },
    replies: ['むっ、いまのは聞き捨てならないよ！', 'ぷんすか！{first}だってがんばってるんだからね。'],
  },
  {
    test: /(他の配信|推し|浮気|あの子)/,
    emotion: 'sad',
    delta: { envy: 7 },
    replies: ['えっ、他の子の話……？ちょっとだけやきもち焼いちゃうな。', 'むむ、{first}のことも忘れないでよね？'],
  },
  {
    test: /(好き|すき|大好き|愛して)/,
    emotion: 'shy',
    delta: { lust: 6, pride: 2 },
    replies: ['えっ、急にそんなこと言われたら照れちゃうよ。', 'ありがと……{first}も{name}さんのこと、けっこう好きだよ。'],
  },
  {
    test: /[?？]$/,
    emotion: 'neutral',
    delta: { sloth: -1 },
    replies: ['うーん、いい質問だね。{first}はね、たぶんそうだと思うよ。', 'それ気になるよね！ちょっと考えさせて……うん、きっと大丈夫！'],
  },
]

const FALLBACK: string[] = [
  'なるほどね！{name}さん、コメントありがとう。',
  'うんうん、それ面白いね。もっと聞かせて！',
  'へえー、そうなんだ。{first}、ちょっと感心しちゃった。',
]

/**
 * Cursor API Key 未設定時・オフライン時のデモ応答。
 * 実際のLLMではなく、キーワードに反応するだけの簡易実装。
 */
export class DemoCharacterAgent implements CharacterAgent {
  readonly id = 'demo' as const
  private counter = 0

  async health(): Promise<AgentHealth> {
    return { ok: true, message: 'デモ応答モード（LLMは使っていません）' }
  }

  async listModels(): Promise<ModelOption[]> {
    return []
  }

  async run(_prompt: string, handlers: AgentRunHandlers): Promise<AgentRunResult> {
    const started = Date.now()
    const ctx = handlers.context
    const text = ctx ? this.compose(ctx) : '<meta>{"emotion":"neutral"}</meta>\nこんにちは！'
    await sleep(350, handlers.signal)
    for (const chunk of chunked(text, 3)) {
      handlers.onText(chunk)
      await sleep(28, handlers.signal)
    }
    return { text, durationMs: Date.now() - started }
  }

  private compose(ctx: TurnContext): string {
    const p = ctx.interaction.primary
    const name = p.viewer.displayName || 'みんな'
    let emotion: AvatarEmotion = 'neutral'
    let delta: SinDelta = {}
    let body: string

    if (p.kind === 'superchat' || p.kind === 'cheer' || p.kind === 'gift') {
      emotion = 'happy'
      delta = { greed: 6, pride: 3 }
      body = `わあっ、{name}さん、${p.amount?.display ?? '応援'}ありがとう！すっごくうれしい！`
    } else if (p.kind === 'subscribe') {
      emotion = 'happy'
      delta = { greed: 4, lust: 3 }
      body = '{name}さん、メンバーになってくれてありがとう！これからよろしくね。'
    } else if (p.kind === 'raid') {
      emotion = 'surprised'
      delta = { pride: 4, sloth: -4 }
      body = 'わっ、レイドだ！みんないらっしゃい、ゆっくりしていってね！'
    } else {
      const rule = RULES.find((r) => r.test.test(p.text.trim()))
      if (rule) {
        emotion = rule.emotion
        delta = rule.delta
        body = rule.replies[this.counter++ % rule.replies.length]
      } else {
        body = FALLBACK[this.counter++ % FALLBACK.length]
      }
    }

    const memory = ctx.memory?.items.find((m) => m.kind === 'preference' || m.kind === 'fact')
    if (memory && this.counter % 2 === 0) body += ` そういえば、${memory.content.replace(/。$/, '')}って覚えてるよ。`
    if (ctx.sins.sloth > 72) body = body.replace(/！/g, '。') + ' ……ふわぁ。'
    if (ctx.sins.wrath > 72) body += ' ……べつに怒ってないけどね！'

    const statement = !/[?？]\s*$/.test(p.text.trim())
    const remember = statement && /(好き|すき|嫌い|きらい|趣味|住んで|誕生日)/.test(p.text) ? `${name}さんは「${p.text.slice(0, 60)}」と言っていた` : ''
    const meta = JSON.stringify({ emotion, intensity: 0.7, sin_delta: delta, remember })
    const filled = body.replace(/\{name\}/g, name).replace(/\{first\}/g, ctx.firstPerson || 'わたし')
    return `<meta>${meta}</meta>\n${filled}`
  }

  async dispose() {}
}

function* chunked(text: string, size: number) {
  const chars = [...text]
  // メタ部分は一気に流す
  const metaEnd = text.indexOf('</meta>')
  let i = 0
  if (metaEnd >= 0) {
    const head = text.slice(0, metaEnd + 7)
    yield head
    i = [...head].length
  }
  for (; i < chars.length; i += size) yield chars.slice(i, i + size).join('')
}
