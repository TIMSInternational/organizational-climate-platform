import { Check } from 'lucide-react'
import { useTranslation } from '../../../i18n'
import { cn } from '../../../lib/cn'
import { JOURNEY, type JourneyKey, type JourneyState } from './derive'

const TITLE_KEY: Record<JourneyKey, string> = {
  create: 'microclimates.next.journey.create',
  share: 'microclimates.next.journey.share',
  live: 'microclimates.next.journey.live',
  read: 'microclimates.next.journey.read',
}

/**
 * "Crear · Compartir · Ver en vivo · Leer" — the rail the Crear and Detalle boards draw
 * under the header, the triage's "as one flow: create, share, watch, read" made visible.
 *
 * Drawn as the Apple design's `.steps` (occ.css): a done step is a check on a disc in the
 * label ink, the current one a blue disc inside a blue-tinted pill with its note in the blue
 * ink (blue is selection and "where you are"), a pending one a numbered disc on the gray fill.
 * Green is not used: it means the Fortaleza result area and nothing else. Pending ink is
 * `text-fg-tertiary` (4.5:1 or better on the card). The state is never the colour alone: the
 * current step is `aria-current="step"`, a done one carries the check, and the notes say so.
 */
export function JourneyRail({
  states,
  notes,
}: {
  states: Record<JourneyKey, JourneyState>
  /** The line under each step, already translated. */
  notes: Record<JourneyKey, string>
}) {
  const { t } = useTranslation()
  return (
    <nav
      aria-label={t('microclimates.next.journey.label')}
      className="rounded-xl border border-line-default bg-surface-card px-4 py-3"
    >
      {/* Below `xl` a grid, not a wrapping row: one step per line on a phone, two by two from
          `sm`. The wrapping row gave each of four `flex-1` steps a quarter of 390px, so every
          label broke one word per line and "Compartir" ran into "Ver en vivo" (#640's shot).
          From `xl` the board's one row with its rules between the steps, unchanged. */}
      <ol
        data-slot="journey-rail"
        className="m-0 grid list-none grid-cols-1 gap-x-3.5 gap-y-3 p-0 sm:grid-cols-2 xl:flex xl:flex-nowrap xl:items-center"
      >
        {JOURNEY.map((key, index) => {
          const state = states[key]
          const previous = index > 0 ? states[JOURNEY[index - 1] as JourneyKey] : null
          return (
            <li
              key={key}
              className={cn('flex min-w-0 items-center gap-3.5', index > 0 && 'flex-1')}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              {index > 0 && (
                <span
                  aria-hidden="true"
                  className={cn('hidden h-px min-w-5 flex-1 xl:block', previous === 'done' ? 'bg-fg-tertiary' : 'bg-line-default')}
                />
              )}
              <span
                data-slot="journey-step"
                className={cn(
                  'flex min-w-0 items-center gap-2.5 rounded-full py-1 pr-3 pl-1',
                  state === 'current' && 'bg-accent-blue-soft',
                )}
              >
                {state === 'done' ? (
                  <span className="inline-flex size-5.5 shrink-0 items-center justify-center rounded-full bg-fg-primary text-surface-card">
                    <Check aria-hidden="true" className="size-3" strokeWidth={2.4} />
                  </span>
                ) : (
                  <span
                    className={cn(
                      'inline-flex size-5.5 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums',
                      state === 'current' ? 'bg-accent-blue-fill text-fg-on-accent' : 'bg-surface-fill text-fg-secondary',
                    )}
                  >
                    {index + 1}
                  </span>
                )}
                <span className="flex min-w-0 flex-col leading-snug">
                  <span
                    className={cn(
                      'text-sm font-semibold',
                      state === 'current' ? 'text-accent-blue-ink' : state === 'done' ? 'text-fg-primary' : 'text-fg-secondary',
                    )}
                  >
                    {t(TITLE_KEY[key])}
                  </span>
                  <span
                    className={cn(
                      'text-xs',
                      state === 'current' ? 'text-accent-blue-ink' : 'text-fg-tertiary',
                    )}
                  >
                    {notes[key]}
                  </span>
                </span>
              </span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
