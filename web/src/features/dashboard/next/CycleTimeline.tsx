import { cn } from '../../../lib/cn'
import type { WaveStatus } from './model'

/**
 * The survey cycle as a horizontal rail, as the Dashboard artboard draws it (10 Sep): a
 * 2px track with a dot per wave spread across it — closed waves filled in the accent
 * with a ring, the open wave the one larger red dot, the next wave hollow and dashed —
 * and under it one column per wave: its code, then its date (or "por planificar"), the
 * last one right-aligned when it is the wave still to plan.
 *
 * The track and its dots are decoration (`aria-hidden`); the list under them carries
 * everything, and a date's full sentence ("cerró 12 feb") rides beside it for AT.
 *
 * Why not `JourneyTimeline`: that component is a vertical `flex-col` list with a
 * status glyph in every dot (check / clock / cross), built for a card's step list.
 * The design here is a horizontal rail whose one emphasis is *which wave is open
 * now*, read left to right like a calendar, and it has no glyphs.
 */
export interface CycleStep {
  id: string
  code: string
  /** Already-translated line under the code: a date, or "por planificar". */
  detail: string
  /** Already-translated sentence read instead of `detail` by AT, e.g. "cerró 12 feb". */
  srDetail?: string
  status: WaveStatus
}

export interface CycleTimelineProps {
  steps: readonly CycleStep[]
  /** Already-translated accessible name of the list. */
  label: string
}

const DOT: Record<WaveStatus, string> = {
  closed: 'size-3 border-2 border-surface-card bg-accent-blue ring-1 ring-accent-blue',
  open: 'size-4 border-3 border-surface-card bg-accent-red ring-1 ring-accent-red',
  planned: 'size-3 border border-dashed border-line-hover bg-surface-card',
}

export default function CycleTimeline({ steps, label }: CycleTimelineProps) {
  return (
    <div className="flex flex-col gap-3.5">
      <div aria-hidden="true" data-slot="cycle-track" className="relative mx-1.5 mt-2 h-0.5 bg-line-default">
        <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 items-center justify-between">
          {steps.map((step) => (
            <span key={step.id} className={cn('shrink-0 rounded-full', DOT[step.status])} />
          ))}
        </div>
      </div>
      <ol aria-label={label} className="m-0 grid list-none auto-cols-fr grid-flow-col gap-1.5 p-0">
        {steps.map((step, index) => {
          const current = step.status === 'open'
          const planned = step.status === 'planned'
          const trailing = planned && index === steps.length - 1 && steps.length > 1
          return (
            <li
              key={step.id}
              data-slot="cycle-step"
              data-current={current ? 'true' : 'false'}
              className={cn('flex min-w-0 flex-col text-xs', trailing && 'text-right')}
            >
              <span
                className={cn(
                  'font-semibold',
                  current ? 'text-accent-red-ink' : planned ? 'text-fg-label' : 'text-fg-primary',
                )}
              >
                {step.code}
              </span>
              <span className={cn(planned ? undefined : 'font-mono tabular-nums', current ? 'text-accent-red-ink' : 'text-fg-label')}>
                {step.srDetail ? (
                  <>
                    <span className="sr-only">{step.srDetail}</span>
                    <span aria-hidden="true">{step.detail}</span>
                  </>
                ) : (
                  step.detail
                )}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
