import type { ReactNode } from 'react'
import type { HealthLevel, StreamPlatform } from '@amctk/shared'
import { Badge } from '@/components/ui/badge'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { LEVEL_DOT, PLATFORM_META, TONE_CLASS, type PageMeta } from '../meta'

export function ToneIcon({ icon: Icon, tone, className }: { icon: PageMeta['icon']; tone: PageMeta['tone']; className?: string }) {
  return (
    <span className={cn('grid size-7 shrink-0 place-items-center rounded-[0.7rem]', TONE_CLASS[tone], className)}>
      <Icon className="size-4" strokeWidth={2.4} />
    </span>
  )
}

export function StatusDot({ level, pulse, className }: { level: HealthLevel; pulse?: boolean; className?: string }) {
  return (
    <span className={cn('relative inline-flex size-2.5 shrink-0', className)}>
      {pulse && <span className={cn('absolute inset-0 animate-ping rounded-full opacity-60', LEVEL_DOT[level])} />}
      <span className={cn('relative inline-flex size-2.5 rounded-full', LEVEL_DOT[level])} />
    </span>
  )
}

export function PlatformBadge({ platform }: { platform: StreamPlatform }) {
  const meta = PLATFORM_META[platform]
  return (
    <Badge variant="secondary" className={cn('border-transparent font-bold', TONE_CLASS[meta.tone])}>
      {meta.label}
    </Badge>
  )
}

export function SettingSlider({
  label,
  description,
  value,
  min,
  max,
  step = 1,
  format = (v) => String(v),
  onChange,
  accent,
}: {
  label: ReactNode
  description?: ReactNode
  value: number
  min: number
  max: number
  step?: number
  format?: (v: number) => string
  onChange: (v: number) => void
  accent?: string
}) {
  return (
    <Field>
      <div className="flex items-center justify-between gap-3">
        <FieldLabel>{label}</FieldLabel>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold tabular-nums text-muted-foreground">{format(value)}</span>
      </div>
      <Slider
        value={value}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : (v as number))}
        style={accent ? ({ '--primary': accent } as React.CSSProperties) : undefined}
      />
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  )
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h3 className="text-sm font-extrabold">{children}</h3>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  )
}

export function timeAgo(at: number) {
  const s = Math.round((Date.now() - at) / 1000)
  if (s < 10) return 'たった今'
  if (s < 60) return `${s}秒前`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}分前`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}時間前`
  return `${Math.round(h / 24)}日前`
}
