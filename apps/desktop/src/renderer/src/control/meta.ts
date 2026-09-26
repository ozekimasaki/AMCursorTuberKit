import {
  BookHeartIcon,
  BrainIcon,
  BugIcon,
  LayoutDashboardIcon,
  MicVocalIcon,
  MonitorPlayIcon,
  RadioTowerIcon,
  SmileIcon,
  type LucideIcon,
} from 'lucide-react'
import type { AgentPhase, HealthLevel, StreamPlatform } from '@amctk/shared'

export type PageId = 'dashboard' | 'stage' | 'avatar' | 'voice' | 'ai' | 'memory' | 'streams' | 'debug'

export interface PageMeta {
  id: PageId
  label: string
  description: string
  icon: LucideIcon
  /** アイコンチップの色（tokens.css の candy-*） */
  tone: 'pink' | 'mint' | 'lemon' | 'grape' | 'sky' | 'peach'
}

export const NAV: { label: string; pages: PageMeta[] }[] = [
  {
    label: '配信',
    pages: [
      { id: 'dashboard', label: 'ダッシュボード', description: '会話・内部状態・コメントの流れをまとめて確認します', icon: LayoutDashboardIcon, tone: 'pink' },
      { id: 'stage', label: 'ステージ・出力', description: '配信に映す画面の位置・背景・字幕を調整します', icon: MonitorPlayIcon, tone: 'sky' },
    ],
  },
  {
    label: 'キャラクター',
    pages: [
      { id: 'avatar', label: 'アバター', description: 'PNG / VRM / Live2D などの見た目を選びます', icon: SmileIcon, tone: 'peach' },
      { id: 'voice', label: 'ボイス', description: '読み上げエンジンと声の調子を設定します', icon: MicVocalIcon, tone: 'mint' },
      { id: 'ai', label: 'AI・性格', description: 'Cursor SDK の接続と、キャラクターの性格・七つの大罪を設定します', icon: BrainIcon, tone: 'grape' },
      { id: 'memory', label: '記憶', description: '視聴者ごとに覚えていることを確認・整理します', icon: BookHeartIcon, tone: 'lemon' },
    ],
  },
  {
    label: '接続',
    pages: [
      { id: 'streams', label: '配信サービス', description: 'YouTube / Twitch / Kick / TikTok のコメントを受け取ります', icon: RadioTowerIcon, tone: 'sky' },
    ],
  },
  {
    label: 'その他',
    pages: [{ id: 'debug', label: 'デバッグ', description: 'ログ・イベント・動作確認用のツール', icon: BugIcon, tone: 'grape' }],
  },
]

export const PAGES = Object.fromEntries(NAV.flatMap((g) => g.pages).map((p) => [p.id, p])) as Record<PageId, PageMeta>

export const TONE_CLASS: Record<PageMeta['tone'], string> = {
  pink: 'bg-candy-pink-soft text-candy-pink',
  mint: 'bg-candy-mint-soft text-candy-mint',
  lemon: 'bg-candy-lemon-soft text-candy-lemon',
  grape: 'bg-candy-grape-soft text-candy-grape',
  sky: 'bg-candy-sky-soft text-candy-sky',
  peach: 'bg-candy-peach-soft text-candy-peach',
}

export const PLATFORM_META: Record<StreamPlatform, { label: string; tone: PageMeta['tone'] }> = {
  manual: { label: '手入力', tone: 'pink' },
  youtube: { label: 'YouTube', tone: 'peach' },
  twitch: { label: 'Twitch', tone: 'grape' },
  kick: { label: 'Kick', tone: 'mint' },
  tiktok: { label: 'TikTok', tone: 'sky' },
}

export const PHASE_META: Record<AgentPhase, { label: string; tone: PageMeta['tone'] }> = {
  idle: { label: 'まってるよ', tone: 'mint' },
  recalling: { label: '思い出し中', tone: 'lemon' },
  thinking: { label: 'かんがえ中', tone: 'grape' },
  speaking: { label: 'おしゃべり中', tone: 'pink' },
  error: { label: 'エラー', tone: 'peach' },
}

export const LEVEL_DOT: Record<HealthLevel, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  error: 'bg-error',
  off: 'bg-off',
}
