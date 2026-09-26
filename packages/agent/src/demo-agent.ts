import { sleep, type AvatarEmotion, type ModelOption, type SinDelta } from '@amctk/shared'
import type { AgentHealth, AgentRunHandlers, AgentRunResult, CharacterAgent, TurnContext } from './types'

interface Rule {
  test: RegExp
  emotion: AvatarEmotion
  delta: SinDelta
  replies: string[]
}

/**
 * 初期キャラクター「キャットリン」の口調で書いた定型文。
 * ですます調でやわらかく、口癖（ふふ／あら／そうね…など）は1回の返答に1つまで。
 */
const RULES: Rule[] = [
  {
    test: /(こんにち|こんばん|おはよ|はじめまして|初見|hello|hi\b)/i,
    emotion: 'happy',
    delta: { sloth: -3, lust: 2 },
    replies: [
      '{name}さん、ようこそ月灯りのティーサロンへ。ちょうど紅茶が入ったところです。ゆっくりしていってくださいね。',
      'あら、{name}さん。今夜も来てくださったのね。どうぞ、いちばん眺めのいい席へ。',
    ],
  },
  {
    test: /(かわいい|可愛い|すごい|天才|えらい|上手)/,
    emotion: 'smug',
    delta: { pride: 6, lust: 2 },
    replies: ['ふふ、ありがとう。そう言われると、しっぽまで揺れてしまいますね。', 'お上手ですね。今日はいつもより少しだけ、胸を張ってしまいそう。'],
  },
  {
    test: /(プリン|ごはん|ご飯|食べ|おなか|お腹|ラーメン|ケーキ|お菓子|紅茶|お茶|スコーン|クッキー)/,
    emotion: 'happy',
    delta: { gluttony: 7, sloth: -2 },
    replies: [
      'いい香りのお話ですね。わたしのおすすめは、はちみつ入りのミルクティーかしら。',
      '甘いもののお話は大歓迎よ。ね、いっしょに見ましょうか、今夜のお茶菓子。',
    ],
  },
  {
    test: /(ねむ|眠|おやすみ|疲れ|つかれ)/,
    emotion: 'sleepy',
    delta: { sloth: 7 },
    replies: ['夜も更けてきましたね。温かいカモミールティーでも、いかがかしら。', 'わたしも少しだけ、まぶたが重くなってきたみたい。……ふぁ、失礼しました。'],
  },
  {
    test: /(ばか|バカ|うざ|へた|下手|ポンコツ)/i,
    emotion: 'angry',
    delta: { wrath: 7, pride: -3 },
    replies: ['あら、ちょっといじわるな言い方ね。お茶菓子を一枚、減らしてしまおうかしら。', 'むっ。……でも、そういう正直なところは嫌いじゃないですよ。'],
  },
  {
    test: /(他の配信|推し|浮気|あの子)/,
    emotion: 'sad',
    delta: { envy: 7 },
    replies: ['他の子のお話ですか？ 少しだけ、妬けてしまいますね。', 'わたしのことも、ちゃんと見ていてくださいね。約束ですよ？'],
  },
  {
    test: /(好き|すき|大好き|愛して)/,
    emotion: 'shy',
    delta: { lust: 6, pride: 2 },
    replies: ['まあ、急にそんなことを言われたら、耳まで熱くなってしまいます。', 'うふ、ちょっとだけ内緒。わたしも{name}さんのこと、けっこう好きですよ。'],
  },
  {
    test: /[?？]$/,
    emotion: 'neutral',
    delta: { sloth: -1 },
    replies: ['そうね、……わたしはきっとそうだと思います。{name}さんはどう思うかしら？', 'いい質問ですね。答えを探しに、少しだけ寄り道してみましょうか。'],
  },
]

const FALLBACK: string[] = [
  'コメントありがとう、{name}さん。その話、もう少し聞かせてくださいな。',
  'あら、面白いですね。わたし、そういうお話がとても好きなんです。',
  'なるほど、観察しがいがありますね。続きを聞かせてくれるかしら？',
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
    const text = ctx ? this.compose(ctx) : '<meta>{"emotion":"neutral"}</meta>\nようこそ、月灯りのティーサロンへ。'
    await sleep(350, handlers.signal)
    for (const chunk of chunked(text, 3)) {
      handlers.onText(chunk)
      await sleep(28, handlers.signal)
    }
    return { text, durationMs: Date.now() - started }
  }

  private compose(ctx: TurnContext): string {
    const p = ctx.interaction.primary
    const name = p.viewer.displayName || 'みなさん'
    let emotion: AvatarEmotion = 'neutral'
    let delta: SinDelta = {}
    let body: string

    if (p.kind === 'superchat' || p.kind === 'cheer' || p.kind === 'gift') {
      emotion = 'happy'
      delta = { greed: 6, pride: 3 }
      body = `まあ、{name}さん、${p.amount?.display ?? '応援'}をありがとうございます。今夜は特別なお菓子を用意しておきますね。`
    } else if (p.kind === 'subscribe') {
      emotion = 'happy'
      delta = { greed: 4, lust: 3 }
      body = '{name}さん、メンバーになってくださってありがとう。これからも、いっしょにお茶を楽しみましょうね。'
    } else if (p.kind === 'raid') {
      emotion = 'surprised'
      delta = { pride: 4, sloth: -4 }
      body = 'あら、たくさんのお客さまがいらっしゃいましたね。ようこそ、月灯りのティーサロンへ。'
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
    if (memory && this.counter % 2 === 0) body += ` 「${memory.content.replace(/。$/, '')}」というお話、ちゃんと覚えていますよ。`
    if (ctx.sins.sloth > 72 && !body.includes('ふぁ')) body = body.replace(/！/g, '。') + ' ……ふぁ、失礼しました。'
    if (ctx.sins.wrath > 72) body += ' ……べつに、怒ってはいませんよ？'

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
