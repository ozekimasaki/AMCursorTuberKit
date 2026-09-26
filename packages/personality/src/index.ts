import {
  AVATAR_EMOTIONS,
  SIN_KEYS,
  SIN_META,
  type AvatarEmotion,
  type CharacterSettings,
  type MemoryContext,
  type SelectedInteraction,
  type SevenSins,
  type SinKey,
} from '@amctk/shared'

export interface StateTrait {
  key: SinKey
  value: number
  level: 'high' | 'low'
  text: string
}

/** 目立っているパラメーターを抽出（言動に出す対象） */
export function salientTraits(sins: SevenSins): StateTrait[] {
  const traits: StateTrait[] = []
  for (const key of SIN_KEYS) {
    const v = sins[key]
    if (v >= 65) traits.push({ key, value: v, level: 'high', text: SIN_META[key].highTrait })
    else if (v <= 25) traits.push({ key, value: v, level: 'low', text: SIN_META[key].lowTrait })
  }
  return traits.sort((a, b) => Math.abs(b.value - 50) - Math.abs(a.value - 50)).slice(0, 3)
}

export function describeState(current: SevenSins, baseline: SevenSins): string {
  const lines = SIN_KEYS.map((k) => {
    const diff = Math.round(current[k] - baseline[k])
    const d = diff === 0 ? '' : diff > 0 ? ` (本来より+${diff})` : ` (本来より${diff})`
    return `- ${SIN_META[k].ja}/${SIN_META[k].en}: ${Math.round(current[k])}${d}`
  })
  const traits = salientTraits(current)
  const traitText = traits.length
    ? traits.map((t) => `・${SIN_META[t.key].ja}が${t.level === 'high' ? '高い' : '低い'}: ${t.text}`).join('\n')
    : '・目立った偏りはない。ふだん通りのキャラクターで話す'
  return `${lines.join('\n')}\n\n今の状態が言動に出る傾向:\n${traitText}`
}

/** Agentが感情を返さなかったときの推定 */
export function deriveEmotion(sins: SevenSins): { emotion: AvatarEmotion; intensity: number } {
  const top = SIN_KEYS.map((k) => ({ k, v: sins[k] })).sort((a, b) => b.v - a.v)[0]
  const intensity = Math.max(0.3, Math.min(1, (top.v - 50) / 40))
  if (top.v < 62) return { emotion: 'neutral', intensity: 0.5 }
  const map: Record<SinKey, AvatarEmotion> = {
    pride: 'smug',
    greed: 'happy',
    lust: 'shy',
    envy: 'sad',
    gluttony: 'happy',
    wrath: 'angry',
    sloth: 'sleepy',
  }
  return { emotion: map[top.k], intensity }
}

export interface VoiceModulation {
  speed: number
  pitch: number
  intonation: number
  volume: number
}

/** 状態と感情を声色へ反映（VOICEVOXのaudio_queryに掛ける係数・加算値） */
export function voiceModulation(sins: SevenSins, emotion: AvatarEmotion): VoiceModulation {
  const n = (k: SinKey) => (sins[k] - 50) / 50 // -1〜1
  let speed = 1 + n('wrath') * 0.06 - n('sloth') * 0.1 + n('gluttony') * 0.02
  let pitch = n('lust') * 0.02 + n('pride') * 0.01 - n('sloth') * 0.02
  let intonation = 1 + n('wrath') * 0.15 + n('pride') * 0.08 - n('sloth') * 0.25
  let volume = 1 + n('wrath') * 0.08 - n('sloth') * 0.08
  switch (emotion) {
    case 'happy':
      pitch += 0.02
      intonation += 0.15
      speed += 0.03
      break
    case 'angry':
      speed += 0.05
      intonation += 0.2
      volume += 0.08
      break
    case 'sad':
      pitch -= 0.03
      speed -= 0.07
      intonation -= 0.15
      break
    case 'surprised':
      pitch += 0.04
      intonation += 0.25
      break
    case 'sleepy':
    case 'relaxed':
      speed -= 0.08
      intonation -= 0.2
      break
    case 'shy':
      volume -= 0.08
      pitch += 0.02
      break
    case 'smug':
      intonation += 0.1
      break
  }
  return {
    speed: clamp(speed, 0.75, 1.3),
    pitch: clamp(pitch, -0.08, 0.08),
    intonation: clamp(intonation, 0.5, 1.6),
    volume: clamp(volume, 0.7, 1.3),
  }
}

export interface MotionProfile {
  /** 話しているときの跳ね具合 */
  bounce: number
  /** 体の揺れ */
  sway: number
  /** 1分あたりのまばたき回数 */
  blinkPerMinute: number
  /** 呼吸の速さ倍率 */
  breath: number
}

export function motionProfile(sins: SevenSins): MotionProfile {
  const n = (k: SinKey) => (sins[k] - 50) / 50
  return {
    bounce: clamp(1 + n('wrath') * 0.3 + n('gluttony') * 0.2 - n('sloth') * 0.5 + n('pride') * 0.1, 0.3, 1.8),
    sway: clamp(1 + n('lust') * 0.3 - n('sloth') * 0.2, 0.4, 1.6),
    blinkPerMinute: clamp(16 + n('sloth') * 10 - n('wrath') * 4, 6, 30),
    breath: clamp(1 - n('sloth') * 0.35 + n('wrath') * 0.2, 0.5, 1.5),
  }
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v))
}

/* ---------------- Prompt ---------------- */

export interface RecentLine {
  role: 'viewer' | 'character'
  name?: string
  text: string
}

export interface PromptInput {
  character: CharacterSettings
  current: SevenSins
  baseline: SevenSins
  interaction: SelectedInteraction
  memory: MemoryContext | null
  recent: RecentLine[]
  maxDelta: number
  toolsAvailable: boolean
}

export const OUTPUT_CONTRACT = (maxDelta: number) => `# 出力形式（厳守）
1行目に必ず次のメタ情報を1行で出力し、改行してから返答本文を書く。
<meta>{"emotion":"<${AVATAR_EMOTIONS.join('|')}>","intensity":0.0〜1.0,"sin_delta":{"pride":0,"greed":0,"lust":0,"envy":0,"gluttony":0,"wrath":0,"sloth":0},"remember":"覚えておくべき事実があれば短く。なければ空文字"}</meta>
- sin_delta は今回のやりとりで「内部状態がどう動いたか」の提案値。各値は -${maxDelta}〜${maxDelta} の整数。変化がなければ0。
- remember には視聴者の好み・出来事など、次回以降も覚えておく価値がある情報だけを書く。
- 返答本文はそのまま読み上げられる。マークダウン、箇条書き、URL、絵文字は使わない。`

export function buildCharacterInstruction(character: CharacterSettings, maxDelta: number): string {
  return `あなたはAI配信者「${character.name}」としてライブ配信で視聴者と会話する。コードの作成やファイル操作は行わない。
# キャラクター
${character.persona}
- 一人称: ${character.firstPerson}
- 話し方: ${character.speakingStyle}
- 触れない話題: ${character.ngTopics}。話題に出たらやんわり別の話にそらす。
# 内部状態（七つの大罪）
0〜100の7つのパラメーターがあり、現在値が言動に表れる。数値そのものを視聴者に言ってはいけない。
${OUTPUT_CONTRACT(maxDelta)}`
}

export function buildTurnPrompt(input: PromptInput): string {
  const { interaction, memory, recent, character } = input
  const p = interaction.primary
  const who = p.platform === 'manual' ? (p.viewer.displayName || '配信者') : p.viewer.displayName
  const kindText: Record<string, string> = {
    chat: 'コメント',
    superchat: `スーパーチャット(${p.amount?.display ?? p.amount?.value ?? ''})`,
    cheer: `Cheer(${p.amount?.value ?? ''} bits)`,
    subscribe: 'サブスク/メンバー加入',
    gift: 'ギフト',
    follow: 'フォロー',
    raid: 'レイド',
    system: 'システム通知',
  }
  const memoryText =
    memory && (memory.items.length || memory.summary)
      ? [memory.summary, ...memory.items.slice(0, 6).map((m) => `- (${m.kind}) ${m.content}`)].filter(Boolean).join('\n')
      : '（この視聴者についての記憶はまだない）'
  const recentText = recent.length
    ? recent
        .slice(-8)
        .map((r) => `${r.role === 'character' ? character.name : (r.name ?? '視聴者')}: ${r.text}`)
        .join('\n')
    : '（まだ会話はない）'
  const related = interaction.related.length
    ? `\n# 同時に来ていた他のコメント（必要なら軽く触れてよい）\n${interaction.related
        .map((e) => `- ${e.viewer.displayName}: ${e.text.slice(0, 80)}`)
        .join('\n')}`
    : ''

  return `${buildCharacterInstruction(character, input.maxDelta)}

# 現在の内部状態
${describeState(input.current, input.baseline)}

# ${who} さんについての記憶
${memoryText}

# 直近の会話
${recentText}
${related}

# 今回返答する相手
[${p.platform}] ${who} の${kindText[p.kind] ?? 'コメント'}: 「${p.text}」
${input.toolsAvailable ? '\n必要なら get_character_state / get_viewer_context ツールを使ってよいが、使わずにすぐ答えてよい。' : ''}
メタ情報の行から出力を始めること。`
}
