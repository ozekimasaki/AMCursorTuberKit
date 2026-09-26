import type { SinKey } from '@amctk/shared'

/** CSS変数名（tokens.css と対応） */
export const sinColorVar = (key: SinKey) => `var(--sin-${key})`

export const CANDY = ['pink', 'mint', 'lemon', 'grape', 'sky', 'peach'] as const
export type Candy = (typeof CANDY)[number]
