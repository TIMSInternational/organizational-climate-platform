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
 * A done step is a green check, the current one a red numbered disc (the identity fill,
 * `bg-accent-blue-fill`, which is `#dd0c15` in both palettes and carries white at 5.47:1),
 * a pending one a hollow numbered disc. Pending ink is `text-fg-tertiary`, not the board's
 * `#8a82a5`: that is `text-fg-light`, a non-text ink under 4.5:1 (`inkContrast.test.ts`). The rule after a done step is green. The state is
 * never the colour alone: the current step is `aria-current="step"` and its note says so.
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
      className="rounded-xl border border-line-default bg-surface-card px-5 py-3 shadow-xs"
    >
      <ol className="m-0 flex list-none flex-wrap items-center gap-x-3.5 gap-y-3 p-0 xl:flex-nowrap">
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
                  className={cn('hidden h-px min-w-5 flex-1 xl:block', previous === 'done' ? 'bg-accent-green' : 'bg-line-default')}
                />
              )}
              <span className="flex min-w-0 items-center gap-2.5">
                {state === 'done' ? (
                  <span className="inline-flex size-5.5 shrink-0 items-center justify-center rounded-full border border-accent-green-ring bg-accent-green-soft text-accent-green-ink">
                    <Check aria-hidden="true" className="size-3" strokeWidth={2.4} />
                  </span>
                ) : (
                  <span
                    className={cn(
                      'inline-flex size-5.5 shrink-0 items-center justify-center rounded-full font-mono text-xs tabular-nums',
                      state === 'current'
                        ? 'bg-accent-blue-fill font-semibold text-fg-on-accent'
                        : 'border border-line-default bg-surface-icon-box text-fg-tertiary',
                    )}
                  >
                    {index + 1}
                  </span>
                )}
                <span className="flex min-w-0 flex-col leading-snug">
                  <span
                    className={cn(
                      'text-sm font-semibold',
                      state === 'current' ? 'text-fg-primary' : state === 'done' ? 'text-fg-secondary' : 'text-fg-tertiary',
                    )}
                  >
                    {t(TITLE_KEY[key])}
                  </span>
                  <span
                    className={cn(
                      'text-xs xl:whitespace-nowrap',
                      state === 'current' ? 'text-accent-red-ink' : 'text-fg-tertiary',
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
