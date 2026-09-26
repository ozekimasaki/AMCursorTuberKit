import { SIN_KEYS, SIN_META, type SevenSins } from '@amctk/shared'
import { cn } from '@/lib/utils'

const R = 100

function point(i: number, value: number, radius = R) {
  const a = (Math.PI * 2 * i) / SIN_KEYS.length - Math.PI / 2
  const r = (value / 100) * radius
  return [Math.cos(a) * r, Math.sin(a) * r] as const
}

function polygon(values: SevenSins) {
  return `M ${SIN_KEYS.map((k, i) => point(i, values[k]).map((n) => n.toFixed(1)).join(' ')).join(' L ')} Z`
}

/** 七角形のレーダー。点線が本来の性格（baseline）、塗りが現在値 */
export function SinRadar({ current, baseline, className }: { current: SevenSins; baseline: SevenSins; className?: string }) {
  return (
    <svg viewBox="-150 -135 300 270" className={cn('w-full', className)} role="img" aria-label="七つの大罪レーダー">
      {[25, 50, 75, 100].map((v) => (
        <path
          key={v}
          d={polygon(Object.fromEntries(SIN_KEYS.map((k) => [k, v])) as SevenSins)}
          fill={v === 100 ? 'var(--candy-pink-soft)' : 'none'}
          fillOpacity={v === 100 ? 0.45 : 0}
          stroke="var(--border)"
          strokeWidth={1.2}
        />
      ))}
      {SIN_KEYS.map((k, i) => {
        const [x, y] = point(i, 100)
        return <line key={k} x1={0} y1={0} x2={x} y2={y} stroke="var(--border)" strokeWidth={1} />
      })}
      <path d={polygon(baseline)} fill="none" stroke="var(--muted-foreground)" strokeOpacity={0.55} strokeWidth={1.6} strokeDasharray="4 4" />
      <path
        style={{ d: `path('${polygon(current)}')`, transition: 'd 700ms var(--ease-out)' } as React.CSSProperties}
        fill="var(--primary)"
        fillOpacity={0.22}
        stroke="var(--primary)"
        strokeWidth={2.6}
        strokeLinejoin="round"
      />
      {SIN_KEYS.map((k, i) => {
        const [x, y] = point(i, current[k])
        const [lx, ly] = point(i, 126)
        return (
          <g key={k}>
            <circle
              r={5}
              fill={`var(--sin-${k})`}
              stroke="var(--card)"
              strokeWidth={2}
              style={{ transform: `translate(${x}px, ${y}px)`, transition: 'transform 700ms var(--ease-out)' }}
            />
            <text x={lx} y={ly - 5} textAnchor="middle" fontSize={12} fontWeight={800} fill="var(--foreground)">
              {SIN_META[k].ja}
            </text>
            <text x={lx} y={ly + 9} textAnchor="middle" fontSize={10.5} fontWeight={700} fill={`var(--sin-${k})`} className="tabular-nums">
              {Math.round(current[k])}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** 横棒。本来の値に目盛りを付け、今どれだけずれているかを見せる */
export function SinBars({ current, baseline, compact }: { current: SevenSins; baseline: SevenSins; compact?: boolean }) {
  return (
    <div className={cn('flex flex-col', compact ? 'gap-1.5' : 'gap-2.5')}>
      {SIN_KEYS.map((k) => {
        const diff = Math.round(current[k] - baseline[k])
        return (
          <div key={k} className="flex items-center gap-2.5">
            <div className="w-16 shrink-0 text-xs leading-tight font-bold">
              {SIN_META[k].ja}
              {!compact && <div className="text-2xs font-medium text-muted-foreground">{SIN_META[k].en}</div>}
            </div>
            <div className="relative h-2.5 flex-1 rounded-full bg-muted">
              <div
                className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out"
                style={{ width: `${current[k]}%`, background: `var(--sin-${k})` }}
              />
              <div className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-foreground/40" style={{ left: `${baseline[k]}%` }} />
            </div>
            <div className="w-14 shrink-0 text-right text-xs font-bold tabular-nums">
              {Math.round(current[k])}
              <span className={cn('ml-1 text-2xs', diff > 0 ? 'text-sin-up' : diff < 0 ? 'text-sin-down' : 'text-muted-foreground')}>
                {diff > 0 ? `+${diff}` : diff < 0 ? diff : '±0'}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
