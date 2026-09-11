import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../../../lib/cn'

/**
 * The reading tile the SurveyDetail and Distribution artboards open with: a 10px tracked label,
 * a 28px mono reading with its unit on the same baseline, then an optional line or meter. The
 * canvas's own grammar (`card`, 14px by 16px of padding, 6px between rows) rather than `KpiTile`,
 * whose value row carries a change indicator these tiles never have.
 */
export function ReadingTile({
  label,
  value,
  unit,
  children,
  testId,
}: {
  label: string
  /** Null prints an em dash: a reading nobody took is never a zero. */
  value: string | number | null
  unit?: ReactNode
  children?: ReactNode
  testId?: string
}) {
  return (
    <div
      data-testid={testId}
      className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-line-default bg-surface-card px-4 py-3.5 shadow-xs"
    >
      <span className="text-2xs font-bold uppercase tracking-wider text-fg-label">{label}</span>
      <div className="flex flex-wrap items-baseline gap-1.5">
        <span data-slot="reading" className="font-mono text-kpi-lg leading-none text-fg-primary tabular-nums">
          {value === null ? '—' : value}
        </span>
        {unit !== undefined && <span className="text-sm text-fg-secondary">{unit}</span>}
      </div>
      {children}
    </div>
  )
}

/** The 6px response meter under a reading. Absent, not empty, when there is no rate to draw. */
export function Meter({ percent, label }: { percent: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, percent))
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      className="h-1.5 overflow-hidden rounded-sm bg-surface-icon-box"
    >
      <div className="h-full bg-accent-blue" style={{ width: `${clamped}%` }} />
    </div>
  )
}

/** A white card with the canvas hairline, as every artboard section draws it. */
export function Card({ className, children, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn('rounded-lg border border-line-default bg-surface-card shadow-xs', className)} {...rest}>
      {children}
    </section>
  )
}
