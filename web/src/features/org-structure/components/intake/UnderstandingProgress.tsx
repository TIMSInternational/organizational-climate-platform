import { useEffect, useState } from 'react'
import { CircleCheck, CircleDashed, CircleMinus, CircleX, LoaderCircle } from 'lucide-react'
import { useTranslation } from '../../../../i18n'
import { cn } from '../../../../lib/cn'
import type { IntakeSource } from '../../api/intake'
import { stagesFor, stageStates, type StageName, type StageState } from './intakeModel'

/**
 * Step 2 while the request runs: what the server is doing, as a checklist.
 *
 * ## What it may and may not claim
 *
 * The first stages advance on a clock — reading and profiling a spreadsheet take about a second
 * — but the LAST stage is only ever ticked by the response itself, and the AI stage is resolved
 * by what the response says happened: done when the model mapped it, "not needed" for our own
 * template, "not available" when the server fell back to header words. A corrected mapping never
 * reaches the model, so its checklist has no AI stage at all. A checklist that ticked "La IA
 * interpreta" for a template would be the screen inventing work.
 *
 * Motion: the spinner is `motion-safe:` only, and `index.css` zeroes every animation under
 * `prefers-reduced-motion`; the stages still advance, because they are information, not motion.
 */
export function UnderstandingProgress({
  mode,
  startedAt,
  outcome,
}: {
  mode: 'initial' | 'manual'
  /** `performance.now()` when the request left. */
  startedAt: number
  /** The response's `source`, once it has landed. */
  outcome: IntakeSource | null
}) {
  const { t, locale } = useTranslation()
  const [now, setNow] = useState(() => performance.now())

  useEffect(() => {
    if (outcome !== null) return
    const timer = window.setInterval(() => setNow(performance.now()), 200)
    return () => window.clearInterval(timer)
  }, [outcome])

  const elapsed = Math.max(0, now - startedAt)
  const stages = stagesFor(mode)
  const states = stageStates(stages, elapsed, outcome)
  const seconds = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.floor(elapsed / 1000))

  const labelFor = (stage: StageName, state: StageState) => {
    if (stage === 'ai' && state === 'skipped') return t('users.intake.progress.aiSkipped')
    if (stage === 'ai' && state === 'failed') return t('users.intake.progress.aiFailed')
    return t(`users.intake.progress.stage.${stage}`)
  }

  return (
    <div
      data-slot="intake-progress"
      className="flex flex-col gap-4 rounded-xl border border-line-default bg-surface-card px-5 py-5 shadow-sm"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="m-0 text-xl">
          {mode === 'manual' ? t('users.intake.progress.applyingTitle') : t('users.intake.progress.title')}
        </h3>
        <span className="font-mono text-xs text-fg-tertiary tabular-nums">
          {t('users.intake.progress.elapsed', { seconds })}
        </span>
      </div>
      <ol aria-live="polite" className="m-0 flex list-none flex-col gap-2.5 p-0">
        {stages.map((stage) => {
          const state = states[stage]
          return (
            <li
              key={stage}
              data-stage={stage}
              data-state={state}
              className={cn(
                // `relative`: holds the `sr-only` state word inside the row.
                'relative flex items-center gap-2.5 text-base',
                state === 'pending' ? 'text-fg-tertiary' : 'text-fg-primary',
                state === 'active' && 'font-semibold',
              )}
            >
              <span aria-hidden="true" className="inline-flex shrink-0 [&_svg]:size-4.5">
                {state === 'done' && <CircleCheck className="text-accent-green" />}
                {state === 'active' && <LoaderCircle className="text-accent-blue motion-safe:animate-spin" />}
                {state === 'pending' && <CircleDashed className="text-fg-tertiary" />}
                {state === 'skipped' && <CircleMinus className="text-fg-tertiary" />}
                {state === 'failed' && <CircleX className="text-accent-amber" />}
              </span>
              <span>{labelFor(stage, state)}</span>
              <span className="sr-only">{t(`users.intake.progress.state.${state}`)}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
