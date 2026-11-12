import type { ReactNode } from 'react'
import { Lock } from 'lucide-react'
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
        // The spec's `.card`: 12px radius, the panel hairline, no shadow.
        'flex min-w-0 flex-col gap-3.5 rounded-xl border border-line-panel bg-surface-card px-5 pt-4.5 pb-5',
        className,
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={id} className="m-0 text-2xl font-semibold">
          {heading}
        </h2>
        {meta ? <span className="inline-flex flex-wrap items-center gap-x-1 text-sm text-fg-tertiary">{meta}</span> : null}
      </div>
      {children}
    </section>
  )
}

/**
 * A count withheld under the floor, carrying the words that stand in for the number
 * ("Menos de {floor}"). `role="img"` with a full sentence as its name, so a screen reader
 * hears why there is no number, never an empty cell.
 */
export function HatchedCount({ text, label, className }: { text: string; label: string; className?: string }) {
  return (
    // The protected state of the spec (`.prot`, the `ProtectedState` primitive): a padlock
    // and the words, in the tertiary ink — no number, and no striped box competing with
    // the readings around it. One accessible name, so the words are read once.
    <span
      role="img"
      aria-label={label}
      title={label}
      data-slot="hatched-count"
      className={cn('inline-flex min-w-0 items-center gap-1.5 text-sm font-medium whitespace-nowrap text-fg-tertiary', className)}
    >
      <Lock aria-hidden="true" className="size-3.5 shrink-0" />
      <span aria-hidden="true" data-slot="protected-label">
        {text}
      </span>
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
    <div data-slot="coverage-box" className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-line-panel bg-surface-card px-5 py-4.5">
      <span className="text-2xs font-semibold uppercase tracking-tile text-fg-label">{label}</span>
      {children}
      <span className="text-sm text-fg-tertiary">{sub}</span>
    </div>
  )
}
