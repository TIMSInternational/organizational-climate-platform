import type { ReactNode } from 'react'
import { PROTECTED_HATCH } from '../../../../components/charts/suppression'
import { cn } from '../../../../lib/cn'

/**
 * The pieces both team dashboards draw, as the LeaderDashboard and SupervisorDashboard
 * artboards (10 Sep) draw them. Components only — `react(only-export-components)` is a
 * lint rule with a hard budget here.
 */

/**
 * The canvas's `.card` with its heading row: 8px radius, the hairline, 16px by 20px inside
 * (18px at the foot), 12px between rows, the serif h2 at 20px and a 12px meta at the right.
 */
export function TeamCard({
  id,
  heading,
  meta,
  children,
  className,
}: {
  id: string
  heading: ReactNode
  meta?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-lg border border-line-default bg-surface-card px-5 pt-4 pb-4.5 shadow-xs',
        className,
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={id} className="m-0 text-2xl">
          {heading}
        </h2>
        {meta ? <span className="inline-flex flex-wrap items-center gap-x-1 text-sm text-fg-label">{meta}</span> : null}
      </div>
      {children}
    </section>
  )
}

/**
 * A count withheld under the floor: the canvas's `.cell.hatched` — 34px, the hatch, the
 * light ink — carrying the sentence that stands in for the number ("menos de 5
 * respuestas"). `role="img"` with a full sentence as its name, so a screen reader hears why
 * there is no number, never an empty cell. The hatch is `PROTECTED_HATCH`, the one copy
 * `protectedHatch.test.ts` allows.
 */
export function HatchedCount({ text, label, className }: { text: string; label: string; className?: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-slot="hatched-count"
      className={cn(
        'inline-flex h-8.5 min-w-0 items-center justify-center rounded bg-surface-icon-box px-3 text-xs whitespace-nowrap text-fg-tertiary',
        PROTECTED_HATCH,
        className,
      )}
    >
      <span aria-hidden="true">{text}</span>
    </span>
  )
}

/**
 * A plan on either page: the 28px glyph box, the plan's own words, a line of chips and
 * facts, three recessed boxes, and the one action at the right — the artboards' row. The
 * action drops under the text on a narrow screen rather than squeezing it.
 */
export function TeamPlanRow({
  id,
  code,
  icon,
  que,
  chips,
  boxes,
  action,
}: {
  id: string
  code: string
  icon: ReactNode
  que: string
  chips: ReactNode
  boxes: ReactNode
  action?: ReactNode
}) {
  const headingId = `team-plan-${id}`
  return (
    <article
      aria-labelledby={headingId}
      data-plan={code}
      className="grid grid-cols-[28px_minmax(0,1fr)] items-start gap-3 pt-1 lg:grid-cols-[28px_minmax(0,1fr)_auto]"
    >
      <span
        aria-hidden="true"
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-icon-box text-fg-secondary [&>svg]:size-4"
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-col gap-1.5">
        <h3 id={headingId} className="m-0 font-sans text-lg leading-snug font-semibold text-fg-primary">
          {que}
        </h3>
        <div className="flex flex-wrap items-center gap-2">{chips}</div>
        <div className="mt-1 grid grid-cols-1 gap-2.5 sm:grid-cols-3">{boxes}</div>
      </div>
      {action ? <div className="col-start-2 lg:col-start-3">{action}</div> : null}
    </article>
  )
}

/** One of the supervisor's three coverage boxes: a label, the reading, a line under it. */
export function CoverageBox({ label, children, sub }: { label: string; children: ReactNode; sub: ReactNode }) {
  return (
    <div data-slot="coverage-box" className="flex min-w-0 flex-col gap-1.5 rounded-md border border-line-light px-3.5 py-3">
      <span className="text-2xs font-bold uppercase tracking-label text-fg-label">{label}</span>
      {children}
      <span className="text-sm text-fg-label">{sub}</span>
    </div>
  )
}
