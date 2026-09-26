export const SIN_KEYS = ['pride', 'greed', 'lust', 'envy', 'gluttony', 'wrath', 'sloth'] as const

export type SinKey = (typeof SIN_KEYS)[number]

/** 各値は 0〜100 */
export type SevenSins = Record<SinKey, number>

export type SinDelta = Partial<Record<SinKey, number>>

export interface SinMeta {
  key: SinKey
  en: string
  ja: string
  /** UI表示用の短い説明 */
  hint: string
  /** 高いときに言動へ出る傾向（プロンプト用） */
  highTrait: string
  /** 低いときに言動へ出る傾向（プロンプト用） */
  lowTrait: string
  /** tokens.css の --sin-* 変数名 */
  token: string
}

export const SIN_META: Record<SinKey, SinMeta> = {
  pride: {
    key: 'pride',
    en: 'Pride',
    ja: '傲慢',
    hint: '自信・プライドの高さ',
    highTrait: '自信満々で少し偉そう。褒められると得意げになる',
    lowTrait: '謙虚で控えめ。自分を低く見積もりがち',
    token: '--sin-pride',
  },
  greed: {
    key: 'greed',
    en: 'Greed',
    ja: '強欲',
    hint: 'もっと欲しい気持ち',
    highTrait: 'ご褒美やスパチャ、注目をもっと欲しがる',
    lowTrait: '欲がなく、あるもので満足する',
    token: '--sin-greed',
  },
  lust: {
    key: 'lust',
    en: 'Lust',
    ja: '色欲',
    hint: '甘えたい・距離の近さ',
    highTrait: '甘えん坊で距離が近い。視聴者に構ってほしがる（健全な範囲）',
    lowTrait: 'さっぱりしていて距離感がある',
    token: '--sin-lust',
  },
  envy: {
    key: 'envy',
    en: 'Envy',
    ja: '嫉妬',
    hint: 'やきもち',
    highTrait: '他の配信者や話題にやきもちを焼く',
    lowTrait: '他人と比べず、素直に人を褒める',
    token: '--sin-envy',
  },
  gluttony: {
    key: 'gluttony',
    en: 'Gluttony',
    ja: '暴食',
    hint: '食べ物・楽しみへの食いつき',
    highTrait: '食べ物の話題にすぐ食いつき、何でも食べ物に例える',
    lowTrait: '食に興味が薄い',
    token: '--sin-gluttony',
  },
  wrath: {
    key: 'wrath',
    en: 'Wrath',
    ja: '憤怒',
    hint: 'イライラ・ツッコミの強さ',
    highTrait: 'ツッコミが鋭く、ぷんすか怒りやすい（攻撃的な暴言は使わない）',
    lowTrait: 'おだやかで怒らない',
    token: '--sin-wrath',
  },
  sloth: {
    key: 'sloth',
    en: 'Sloth',
    ja: '怠惰',
    hint: 'だるさ・眠さ',
    highTrait: '眠そうで返事が短く、面倒くさがる',
    lowTrait: '元気でやる気に満ちている',
    token: '--sin-sloth',
  },
}

export function clampSin(value: number): number {
  if (!Number.isFinite(value)) return 50
  return Math.min(100, Math.max(0, value))
}

export function createSins(fill = 50): SevenSins {
  return Object.fromEntries(SIN_KEYS.map((k) => [k, fill])) as SevenSins
}

export function isSinKey(value: unknown): value is SinKey {
  return typeof value === 'string' && (SIN_KEYS as readonly string[]).includes(value)
}
