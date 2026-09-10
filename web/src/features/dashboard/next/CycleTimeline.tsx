import { cn } from '../../../lib/cn'
import type { WaveStatus } from './model'

/**
 * The survey cycle as a horizontal rail: closed waves as rings, the open wave as
 * the one filled red dot, the next wave hollow and dashed.
 *
 * Why not `JourneyTimeline`: that component is a vertical `flex-col` list with a
 * status glyph in every dot (check / clock / cross), built for a card's step list.
 * The design here is a horizontal rail whose one emphasis is *which wave is open
 * now*, read left to right like a calendar, and it has no glyphs. Composing a
 * rail from tokens is smaller than bending the list sideways.
 */
export interface CycleStep {
  id: string
  code: string
  /** Already-translated status line under the code. */
  detail: string
  status: WaveStatus
}

export interface CycleTimelineProps {
  steps: readonly CycleStep[]
  /** Already-translated accessible name of the list. */
  label: string
}

const DOT: Record<WaveStatus, string> = {
  closed: 'size-4 border-2 border-accent-purple bg-accent-purple-soft',
  open: 'size-5 border-2 border-accent-red bg-accent-red ring-4 ring-accent-red-soft',
  planned: 'size-4 border-2 border-dashed border-line-default bg-surface-card',
}

export default function CycleTimeline({ steps, label }: CycleTimelineProps) {
  return (
    <ol aria-label={label} className="m-0 flex list-none gap-0 p-0">
      {steps.map((step, index) => {
        const current = step.status === 'open'
        return (
          <li
            key={step.id}
            data-slot="cycle-step"
            data-current={current ? 'true' : 'false'}
            className="min-w-0 flex-1"
          >
            <div className="flex h-5 items-center" aria-hidden="true">
              <span className={cn('h-px flex-1', index === 0 ? 'bg-transparent' : 'bg-line-default')} />
              <span className={cn('shrink-0 rounded-full', DOT[step.status])} />
              <span
                className={cn(
                  'h-px flex-1',
                  index === steps.length - 1 ? 'bg-transparent' : 'bg-line-default',
                )}
              />
            </div>
            <div className="mt-1.5 px-1 text-center">
              <div
                className={cn(
                  'text-xs font-semibold',
                  current ? 'text-accent-red' : step.status === 'planned' ? 'text-fg-label' : 'text-fg-primary',
                )}
              >
                {step.code}
              </div>
              <div
                className={cn(
                  'font-mono text-2xs tabular-nums',
                  current ? 'font-semibold text-accent-red' : 'text-fg-label',
                )}
              >
                {step.detail}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
