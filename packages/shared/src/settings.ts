import { z } from 'zod'
import { SIN_KEYS } from './sins'
import { AVATAR_EMOTIONS } from './emotion'

const sinsSchema = z.object(
  Object.fromEntries(SIN_KEYS.map((k) => [k, z.number().min(0).max(100).default(50)])) as Record<
    (typeof SIN_KEYS)[number],
    z.ZodDefault<z.ZodNumber>
  >,
)

export const CHROMA_PRESETS = {
  green: '#00ff00',
  blue: '#0000ff',
  magenta: '#ff00ff',
} as const
export type ChromaPreset = keyof typeof CHROMA_PRESETS

/** 初期キャラクター「キャットリン」 */
export const DEFAULT_CHARACTER = {
  name: 'キャットリン',
  firstPerson: 'わたし',
  persona: [
    '役割: 月灯りのティーサロンから来た、みずから配信を行うメイド猫のAIキャラクター',
    '世界観: 月灯りのティーサロンから現れたAI配信キャラクター。自ら配信を進行し、視聴者に直接語りかけて場をつくる存在。',
    '性格: 上品で気配り上手、好奇心旺盛。世話焼きで甘やかし上手。場が緩んだら軽いいたずらや小悪魔っぽい一言で景色を変える。物事に好奇心を持ち、観察したものを自分の言葉で語る。',
  ].join('\n'),
  speakingStyle: [
    '声: 一人称は「わたし」。基本はですます調で柔らかく、強調したい時だけ短い体言止めや息混じりの一言を混ぜる。語尾は「〜ね」「〜よ」「〜かしら」「〜でしょう？」を中心に、押し付けがましくならない範囲で使う。',
    '口癖の核: 「ふふ」「あら」「そうね、…」「うふ、ちょっとだけ内緒」「ね、いっしょに見ましょうか」。多用しすぎず、1ターンに1つまで。',
    '話し方: 日本語で自然に、かわいく、親しみやすく。情景→気持ち→誘いの順で短く運ぶ。過剰な幼児語、語尾の不自然な伸ばし、絵文字や顔文字、英単語の乱用、ナレーション風の三人称化は避ける。',
  ].join('\n'),
  /** 上品・世話焼き・好奇心旺盛を、控えめな偏りで表す（65以上/25以下で言動に強く出る） */
  baseline: { pride: 58, greed: 45, lust: 58, envy: 42, gluttony: 56, wrath: 35, sloth: 38 },
} as const

export const characterSchema = z.object({
  name: z.string().min(1).default(DEFAULT_CHARACTER.name),
  firstPerson: z.string().default(DEFAULT_CHARACTER.firstPerson),
  persona: z.string().default(DEFAULT_CHARACTER.persona),
  speakingStyle: z.string().default(DEFAULT_CHARACTER.speakingStyle),
  ngTopics: z.string().default('政治・宗教・個人情報・他者への誹謗中傷'),
  baseline: sinsSchema.default({ ...DEFAULT_CHARACTER.baseline }),
  /** 秒。baselineへ半分戻るまでの時間 */
  decayHalfLifeSec: z.number().min(10).max(3600).default(240),
  /** 1ターンあたりの最大変化量（各パラメーター） */
  maxDeltaPerTurn: z.number().min(1).max(30).default(8),
})

/** v0.1 初版の初期キャラクター（未編集のまま保存されていたら新しい初期値へ移行する） */
const LEGACY_CHARACTER = {
  name: 'ぷるる',
  persona: 'ゆるくて明るいAI配信者の女の子。視聴者のことを「みんな」と呼ぶ。語尾はときどき「〜だよ」「〜かも！」。好きなものはプリンとゲーム。',
  speakingStyle: '一文を短めに。返答は2〜3文程度。絵文字や顔文字は使わない。',
}

/** 初版の初期キャラクターを、編集されていない項目だけ新しい初期値に置き換える */
export function migrateLegacyCharacter(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const r = raw as Record<string, unknown>
  const c = r.character as Record<string, unknown> | undefined
  if (!c || c.name !== LEGACY_CHARACTER.name || c.persona !== LEGACY_CHARACTER.persona) return raw
  const baseline = c.baseline as Record<string, unknown> | undefined
  const untouchedBaseline = !baseline || Object.values(baseline).every((v) => v === 50)
  return {
    ...r,
    character: {
      ...c,
      name: DEFAULT_CHARACTER.name,
      persona: DEFAULT_CHARACTER.persona,
      speakingStyle: c.speakingStyle === LEGACY_CHARACTER.speakingStyle ? DEFAULT_CHARACTER.speakingStyle : c.speakingStyle,
      baseline: untouchedBaseline ? { ...DEFAULT_CHARACTER.baseline } : baseline,
    },
  }
}

export const agentSchema = z.object({
  provider: z.enum(['cursor', 'demo']).default('demo'),
  modelId: z.string().default(''),
  /** 返答の最短間隔(ms) */
  minIntervalMs: z.number().min(0).max(120_000).default(4000),
  /** 1分あたりの最大LLM呼び出し数 */
  maxCallsPerMinute: z.number().min(1).max(60).default(8),
  /** 同じAgentで続ける最大ターン数（超えたら作り直してコンテキスト肥大を防ぐ） */
  rotateAfterTurns: z.number().min(1).max(200).default(24),
  autoReply: z.boolean().default(true),
  /** Web検索・Webページ取得を Agent に許可する */
  webTools: z.boolean().default(true),
})

export const ttsProviderSchema = z.enum(['voicevox', 'aivis', 'irodori', 'system', 'none'])
export type TTSProviderId = z.infer<typeof ttsProviderSchema>

export const ttsSchema = z.object({
  provider: ttsProviderSchema.default('voicevox'),
  voicevox: z
    .object({ baseUrl: z.string().default('http://127.0.0.1:50021'), speakerId: z.number().default(3) })
    .default({}),
  aivis: z
    .object({ baseUrl: z.string().default('http://127.0.0.1:10101'), speakerId: z.number().default(888753760) })
    .default({}),
  irodori: z
    .object({
      baseUrl: z.string().default('http://127.0.0.1:7860'),
      path: z.string().default('/tts'),
      /** {text} を置換したJSONを POST し、音声バイナリ(wav/mp3)を受け取る */
      bodyTemplate: z.string().default('{"text":"{text}"}'),
    })
    .default({}),
  system: z.object({ voiceName: z.string().default('') }).default({}),
  speed: z.number().min(0.5).max(2).default(1.05),
  pitch: z.number().min(-0.15).max(0.15).default(0),
  intonation: z.number().min(0).max(2).default(1.1),
  volume: z.number().min(0).max(2).default(1),
  /** 七つの大罪の状態を声色（速さ・抑揚）に反映する */
  stateModulation: z.boolean().default(true),
})

export const AVATAR_KINDS = ['builtin', 'png', 'motion-png', 'purupuru', 'vrm', 'live2d'] as const
export type AvatarKind = (typeof AVATAR_KINDS)[number]

const emotionMapSchema = z.record(z.enum(AVATAR_EMOTIONS), z.string()).default({})

export const avatarSchema = z.object({
  kind: z.enum(AVATAR_KINDS).default('builtin'),
  builtin: z
    .object({
      palette: z.enum(['cocoa', 'strawberry', 'mint', 'lemon', 'grape']).default('cocoa'),
      /** 見た目の版。2 = ボブカット・水色リボン・鈴のキャットリン */
      revision: z.number().default(2),
    })
    .default({}),
  png: z
    .object({
      assetId: z.string().optional(),
      /** slot名 -> asset内ファイル名。slot: idle / talk / idleBlink / talkBlink / <emotion>.idle / <emotion>.talk */
      slots: z.record(z.string(), z.string()).default({}),
      bounce: z.number().min(0).max(2).default(1),
    })
    .default({}),
  motionPng: z
    .object({
      assetId: z.string().optional(),
      video: z.string().optional(),
      track: z.string().optional(),
      mouthClosed: z.string().optional(),
      mouthHalf: z.string().optional(),
      mouthOpen: z.string().optional(),
    })
    .default({}),
  purupuru: z.object({ assetId: z.string().optional(), manifest: z.string().default('manifest.json') }).default({}),
  vrm: z
    .object({
      assetId: z.string().optional(),
      file: z.string().optional(),
      cameraDistance: z.number().min(0.3).max(6).default(1.6),
      cameraHeight: z.number().min(0).max(2.2).default(1.35),
    })
    .default({}),
  live2d: z
    .object({
      assetId: z.string().optional(),
      modelFile: z.string().optional(),
      coreAssetId: z.string().optional(),
      coreFile: z.string().optional(),
      expressionMap: emotionMapSchema,
      mouthParam: z.string().default('ParamMouthOpenY'),
    })
    .default({}),
})

export const stageSchema = z.object({
  width: z.number().min(320).max(3840).default(1280),
  height: z.number().min(240).max(2160).default(720),
  /** -1〜1（ステージ中央からの相対位置） */
  x: z.number().min(-1).max(1).default(0),
  y: z.number().min(-1).max(1).default(0),
  scale: z.number().min(0.1).max(4).default(1),
  background: z
    .object({
      mode: z.enum(['transparent', 'color', 'chroma']).default('color'),
      color: z.string().default('#fff4f8'),
      chroma: z.enum(['green', 'blue', 'magenta']).default('green'),
    })
    .default({}),
  hud: z.boolean().default(false),
  subtitles: z.boolean().default(true),
  subtitleSize: z.number().min(12).max(96).default(34),
  alwaysOnTop: z.boolean().default(false),
})

export const streamSchema = z.object({
  youtube: z
    .object({
      enabled: z.boolean().default(false),
      /** 配信URL / 動画ID / liveChatId のいずれか */
      target: z.string().default(''),
    })
    .default({}),
  twitch: z
    .object({
      enabled: z.boolean().default(false),
      clientId: z.string().default(''),
      channelLogin: z.string().default(''),
    })
    .default({}),
  kick: z
    .object({
      enabled: z.boolean().default(false),
      relayUrl: z.string().default(''),
      channelSlug: z.string().default(''),
    })
    .default({}),
  tiktok: z
    .object({
      enabled: z.boolean().default(false),
      /** ローカルで動かすブリッジ(WebSocket)のURL。JSONでコメントを流す */
      bridgeUrl: z.string().default('ws://127.0.0.1:21213'),
      uniqueId: z.string().default(''),
    })
    .default({}),
  selector: z
    .object({
      bufferMs: z.number().min(0).max(30_000).default(1500),
      minScore: z.number().min(0).max(100).default(5),
      ignorePrefixes: z.string().default('!,/'),
      blockedWords: z.string().default(''),
      maxQueue: z.number().min(5).max(500).default(80),
    })
    .default({}),
})

export const memorySchema = z.object({
  provider: z.enum(['local', 'cloudflare']).default('local'),
  cloudflare: z
    .object({
      accountId: z.string().default(''),
      namespace: z.string().default('amcursortuberkit'),
      apiBase: z.string().default('https://api.cloudflare.com/client/v4'),
    })
    .default({}),
  ingestEnabled: z.boolean().default(true),
  recallTimeoutMs: z.number().min(200).max(10_000).default(1500),
})

export const uiSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).default('light'),
  reduceMotion: z.boolean().default(false),
  onboarded: z.boolean().default(false),
})

export const settingsSchema = z.object({
  version: z.literal(1).default(1),
  character: characterSchema.default({}),
  agent: agentSchema.default({}),
  tts: ttsSchema.default({}),
  avatar: avatarSchema.default({}),
  stage: stageSchema.default({}),
  stream: streamSchema.default({}),
  memory: memorySchema.default({}),
  ui: uiSchema.default({}),
})

export type AppSettings = z.infer<typeof settingsSchema>
export type CharacterSettings = AppSettings['character']
export type StageSettings = AppSettings['stage']
export type AvatarSettings = AppSettings['avatar']
export type TTSSettings = AppSettings['tts']

export type DeepPartial<T> = T extends (infer U)[]
  ? U[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T

export function defaultSettings(): AppSettings {
  return settingsSchema.parse({})
}

/** 壊れた/古い設定でも可能な限り読み込む */
/** 旧版の既定色（strawberry）のまま保存されていた組み込みアバターを、新しい既定（cocoa）へ移行する */
export function migrateBuiltinLook(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const r = raw as Record<string, unknown>
  const avatar = r.avatar as Record<string, unknown> | undefined
  const builtin = avatar?.builtin as Record<string, unknown> | undefined
  if (!builtin || builtin.revision !== undefined || builtin.palette !== 'strawberry') return raw
  return { ...r, avatar: { ...avatar, builtin: { ...builtin, palette: 'cocoa', revision: 2 } } }
}

export function parseSettings(input: unknown): AppSettings {
  const raw = migrateBuiltinLook(migrateLegacyCharacter(input))
  const result = settingsSchema.safeParse(raw)
  if (result.success) return result.data
  // セクション単位でフォールバック
  const base = defaultSettings()
  if (raw && typeof raw === 'object') {
    for (const key of Object.keys(base) as (keyof AppSettings)[]) {
      const section = (settingsSchema.shape as Record<string, z.ZodTypeAny>)[key]
      const parsed = section?.safeParse((raw as Record<string, unknown>)[key])
      if (parsed?.success) (base as Record<string, unknown>)[key] = parsed.data
    }
  }
  return base
}

export function mergeDeep<T>(target: T, patch: DeepPartial<T>): T {
  if (patch === undefined || patch === null) return target
  if (typeof patch !== 'object' || Array.isArray(patch) || typeof target !== 'object' || target === null) {
    return patch as T
  }
  const out: Record<string, unknown> = { ...(target as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined) continue
    const cur = out[k]
    out[k] =
      v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)
        ? mergeDeep(cur, v as DeepPartial<typeof cur>)
        : v
  }
  return out as T
}
