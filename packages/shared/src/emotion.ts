export const AVATAR_EMOTIONS = [
  'neutral',
  'happy',
  'angry',
  'sad',
  'surprised',
  'relaxed',
  'smug',
  'shy',
  'sleepy',
] as const

export type AvatarEmotion = (typeof AVATAR_EMOTIONS)[number]

export const EMOTION_META: Record<AvatarEmotion, { ja: string; emoji: string }> = {
  neutral: { ja: 'ふつう', emoji: '🙂' },
  happy: { ja: 'うれしい', emoji: '😆' },
  angry: { ja: 'ぷんすか', emoji: '😤' },
  sad: { ja: 'しょんぼり', emoji: '🥺' },
  surprised: { ja: 'びっくり', emoji: '😲' },
  relaxed: { ja: 'まったり', emoji: '😌' },
  smug: { ja: 'ドヤ', emoji: '😏' },
  shy: { ja: 'てれてれ', emoji: '☺️' },
  sleepy: { ja: 'ねむねむ', emoji: '😪' },
}

export function isAvatarEmotion(value: unknown): value is AvatarEmotion {
  return typeof value === 'string' && (AVATAR_EMOTIONS as readonly string[]).includes(value)
}

export interface EmotionState {
  emotion: AvatarEmotion
  /** 0〜1 */
  intensity: number
}
