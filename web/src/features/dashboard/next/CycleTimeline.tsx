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
 * In a container under 36rem (`@max-xl`) the rail turns vertical (the spec's `.tl`). It is
 * the CARD's width that decides, not the window's: at 1440 the rail sits in a five-column
 * card about 440px wide, and five columns there wrapped "Pulso de incorporación abierta
 * cierra 30 sept" to four lines with neighbouring labels nearly touching (review, fix
 * round 1); at 390 five columns left each wave 50px (review finding 4). Each step then
 * carries its own dot beside its text, and the horizontal track is hidden. The same
 * `@max-xl` the climate range bar drops its track at.
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
  open: 'size-4 border-3 border-surface-card bg-accent-blue-fill ring-1 ring-accent-blue-fill',
  planned: 'size-3 border border-dashed border-line-hover bg-surface-card',
}

export default function CycleTimeline({ steps, label }: CycleTimelineProps) {
  return (
    <div data-slot="cycle" className="@container flex flex-col gap-3.5">
      <div aria-hidden="true" data-slot="cycle-track" className="relative mx-1.5 mt-2 h-0.5 bg-line-default @max-xl:hidden">
        <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 items-center justify-between">
          {steps.map((step) => (
            <span key={step.id} className={cn('shrink-0 rounded-full', DOT[step.status])} />
          ))}
        </div>
      </div>
      <ol
        aria-label={label}
        className="m-0 grid list-none auto-cols-fr grid-flow-col gap-1.5 p-0 @max-xl:grid-flow-row @max-xl:gap-0"
      >
        {steps.map((step, index) => {
          const current = step.status === 'open'
          const planned = step.status === 'planned'
          const trailing = planned && index === steps.length - 1 && steps.length > 1
          return (
            <li
              key={step.id}
              data-slot="cycle-step"
              data-current={current ? 'true' : 'false'}
              className={cn(
                'relative flex min-w-0 flex-col text-sm @xl:text-xs',
                '@max-xl:pb-3.5 @max-xl:pl-7.5 @max-xl:last:pb-0',
                trailing && '@xl:text-right',
              )}
            >
              {/* The phone's vertical rail: a dot per step and the line down to the next. */}
              {index < steps.length - 1 && (
                <span aria-hidden="true" className="absolute top-4 bottom-0 left-2 w-0.5 -translate-x-1/2 bg-line-default @xl:hidden" />
              )}
              <span
                aria-hidden="true"
                className="absolute top-0.5 left-0 flex size-4 items-center justify-center @xl:hidden"
              >
                <span className={cn('shrink-0 rounded-full', DOT[step.status])} />
              </span>
              <span
                className={cn(
                  'font-semibold',
                  current ? 'text-accent-blue-ink' : planned ? 'text-fg-label' : 'text-fg-primary',
                )}
              >
                {step.code}
              </span>
              <span className={cn(planned ? undefined : 'tabular-nums', current ? 'text-accent-blue-ink' : 'text-fg-label')}>
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
