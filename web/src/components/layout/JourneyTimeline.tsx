import { Check, Clock, X } from 'lucide-react'
import { Card, CardContent } from '../ui'

/**
 * The vertical journey — ForMaps' `components/ui/admin-timeline.tsx`.
 *
 * Geometry is theirs: a 22px dot at `borderRadius: 11` with a 2px ring, filled for
 * a settled step and hollow for one still ahead; a 1px connector seated at
 * `left: 11` (the dot's centre) running from `top: 24` to the next row; rows 20px
 * apart; the title 13px/500 over a 12px description at `lineHeight: 1.5`; and the
 * card's own heading as a 10px uppercase label at `0.08em`.
 *
 * ## Two deviations
 *
 * **No pulse ring on the active step.** Theirs adds an absolutely-placed ring at
 * `inset: -3` running `animation: pulse 2s infinite`. This repo does not port
 * `framer-motion` (#75–#77) and its `prefers-reduced-motion` block in `index.css`
 * disables infinite animation anyway, so the ring would be a decoration that
 * vanishes for the readers most likely to need the step called out. The filled
 * ring plus the clock glyph says the same thing statically.
 *
 * **Status colour comes from a token, not a hex.** Theirs falls back to literal
 * `#10b981`/`#065292`/`#ef4444` behind each `var(--admin-accent-*)`;
 * `tokenDiscipline` rejects a colour literal anywhere under `layout/`, and the
 * fallbacks are the ForMaps palette rather than this one, so a fallback that fired
 * would paint the wrong product's colours.
 *
 * ## Why the status is not `active | pending` alone
 *
 * A step can be *skipped* — a microclimate cancelled before it closed never
 * reaches "closed", and drawing that step as merely pending says it is still
 * coming. `error` is theirs and means the same thing here: the journey stopped.
 */
export type JourneyStatus = 'completed' | 'active' | 'pending' | 'error'

export interface JourneyStep {
  /** Stable identity, used as the React key. */
  id: string
  /** Already-translated. */
  title: string
  /** Already-translated supporting line. */
  description?: string
  /** Already-translated, right-aligned against the title. */
  timestamp?: string
  status: JourneyStatus
}

export interface JourneyTimelineProps {
  steps: readonly JourneyStep[]
  /** Already-translated card heading. */
  title?: string
  /**
   * Accessible name for the list. Already translated — an ordered list of steps
   * with no name is announced as "list, 4 items" and nothing else.
   */
  label: string
}

const DOT_TONE: Record<JourneyStatus, string> = {
  completed: 'var(--admin-accent-green)',
  active: 'var(--admin-accent-blue)',
  pending: 'var(--admin-font-light)',
  error: 'var(--admin-accent-red)',
}

const TITLE_TONE: Record<JourneyStatus, string> = {
  completed: 'text-fg-primary',
  active: 'text-fg-primary',
  pending: 'text-fg-tertiary',
  error: 'text-fg-primary',
}

export function JourneyTimeline({ steps, title, label }: JourneyTimelineProps) {
  if (steps.length === 0) return null

  return (
    <Card data-slot="journey-timeline">
      <CardContent className="flex flex-col gap-4">
        {title ? (
          <p className="m-0 text-2xs font-semibold uppercase tracking-label text-fg-label">
            {title}
          </p>
        ) : null}

        {/* An `<ol>`, because the steps are ordered and a screen reader should say
            so — ForMaps uses a stack of `<div>`s, which announces four unrelated
            paragraphs. */}
        <ol aria-label={label} className="m-0 flex list-none flex-col p-0">
          {steps.map((step, index) => {
            const isLast = index === steps.length - 1
            const tone = DOT_TONE[step.status]
            const isFilled = step.status === 'completed' || step.status === 'error'
            return (
              <li
                key={step.id}
                className="relative flex gap-gutter"
                style={{ paddingBottom: isLast ? 0 : 20 }}
              >
                {!isLast && (
                  <span
                    aria-hidden="true"
                    className="absolute w-px"
                    style={{
                      left: 11,
                      top: 24,
                      bottom: 0,
                      background: tone,
                      opacity: step.status === 'pending' ? 0.3 : 0.5,
                    }}
                  />
                )}

                <span
                  aria-hidden="true"
                  className="relative z-10 flex shrink-0 items-center justify-center"
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    border: `2px solid ${tone}`,
                    background: isFilled ? tone : 'transparent',
                    color: isFilled ? 'var(--admin-bg-card)' : tone,
                  }}
                >
                  <StatusGlyph status={step.status} />
                </span>

                <span className="min-w-0 flex-1 pt-px">
                  <span className="flex items-start justify-between gap-inline">
                    <span className={`font-medium ${TITLE_TONE[step.status]}`}>{step.title}</span>
                    {step.timestamp && (
                      <span className="shrink-0 text-2xs text-fg-label">{step.timestamp}</span>
                    )}
                  </span>
                  {step.description && (
                    <span className="mt-px block text-sm leading-normal text-fg-tertiary">
                      {step.description}
                    </span>
                  )}
                </span>
              </li>
            )
          })}
        </ol>
      </CardContent>
    </Card>
  )
}

/**
 * `aria-hidden` on the wrapper above, so this is decoration: the status is carried
 * by the step's own copy, not by a tick a screen reader would have to name.
 */
function StatusGlyph({ status }: { status: JourneyStatus }) {
  if (status === 'completed') return <Check style={{ width: 12, height: 12 }} />
  if (status === 'error') return <X style={{ width: 12, height: 12 }} />
  if (status === 'active') return <Clock style={{ width: 12, height: 12 }} />
  return <span style={{ width: 6, height: 6, borderRadius: 3, background: 'currentColor' }} />
}
