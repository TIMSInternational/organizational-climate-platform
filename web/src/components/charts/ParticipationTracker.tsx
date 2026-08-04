import { useTranslation } from '../../i18n'
import { Progress } from '../ui/progress'
import { formatMetric } from './formatMetric'
import {
  bandStatus,
  formatMinutes,
  participationBand,
  participationRate,
  type ParticipationBand,
} from './participation'

interface ParticipationTrackerProps {
  /** Responses received so far. */
  current: number
  /** How many were invited. */
  target: number
  /** Minutes until the survey closes, if it closes. */
  minutesRemaining?: number
  /** Already-translated heading. */
  title?: string
  /** BCP-47 locale. Defaults to the document's language. */
  locale?: string
  isLoading?: boolean
}

/**
 * How much of the invited population has responded.
 *
 * Consolidates legacy `charts/ParticipationTracker` with the linear bar from
 * `widgets/progress-bar` — the bar is now `ui/progress`, which is Radix-backed and
 * therefore carries `role="progressbar"` and `aria-valuenow`. The legacy widget's
 * bar was a bare `<div>` with an animated width and no ARIA at all, so a screen
 * reader saw a coloured box; and like the rest of `components/widgets/` it was
 * exported from a barrel and imported by nothing, i.e. dead on arrival.
 *
 * `widgets/progress-bar` also exported `CircularProgress`, `MultiProgress` and
 * `StepProgress`. Those are not ported here because they are not this chart, and
 * `climate-project/src/components/ui/Progress.tsx` already had its own
 * `CircularProgress` and `StepProgress` — the widget file was a third copy of
 * primitives that belong in `ui/`, not a participation view. Nothing in the legacy
 * app rendered any of them.
 *
 * ## The rate is derived, not passed
 *
 * Legacy took `{ current, target, rate }` and then trusted `rate` for the colour
 * and the status word while computing "remaining" from `target - current`. Two
 * sources for one fact: a payload where they disagreed produced a card that
 * contradicted itself and no way to tell which half was right. `rate` is computed
 * from `current` and `target` here.
 *
 * ## The percentage moved out of the bar
 *
 * Legacy centred the figure inside the bar in `text-white`, which is legible only
 * while the fill happens to be under the text — at 5% the white number sits on the
 * grey track and vanishes. It also faded the label out entirely below 10%, hiding
 * the number exactly when the news was worst. It now sits beside the bar, where it
 * is always readable.
 */
export default function ParticipationTracker({
  current,
  target,
  minutesRemaining,
  title,
  locale,
  isLoading = false,
}: ParticipationTrackerProps) {
  const { t } = useTranslation()

  const rate = participationRate(current, target)
  // Rounded once, then used for the label, the band and the bar alike. Banding on
  // the raw ratio while displaying a rounded one makes them disagree at the
  // boundary: 190 of 480 is 39.58%, which displays as "40%" -- the documented
  // threshold for Fair -- while banding as Low. Seen on the chart gallery as a
  // card reading "Low" beside "40%". One number, one verdict.
  const displayRate = rate === null ? null : Math.round(rate)
  const band: ParticipationBand | null =
    displayRate === null ? null : participationBand(displayRate)
  const status = band === null ? null : bandStatus(band)

  // Classes are written here rather than returned from participation.ts so
  // styles/utilityExistence.test.ts can see them -- it sweeps `className` in
  // .tsx and cannot follow a class name out of a .ts helper.
  const textTone =
    status === 'critical'
      ? 'text-accent-red'
      : status === 'warning'
        ? 'text-accent-amber'
        : 'text-accent-green'
  const fillTone =
    status === 'critical'
      ? 'bg-accent-red'
      : status === 'warning'
        ? 'bg-accent-amber'
        : 'bg-accent-green'

  const bandLabel =
    band === 'excellent'
      ? t('charts.participationExcellent')
      : band === 'good'
        ? t('charts.participationGood')
        : band === 'fair'
          ? t('charts.participationFair')
          : t('charts.participationLow')

  const count = (value: number) => formatMetric(value, { kind: 'number' }, locale)

  if (isLoading) {
    return (
      <section className="flex flex-col gap-4">
        {title ? <h3>{title}</h3> : null}
        <div
          role="status"
          aria-label={t('charts.loadingChart')}
          className="h-40 animate-pulse rounded-lg border border-line-default bg-surface-icon-box"
        />
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-4">
      {title ? <h3>{title}</h3> : null}

      <dl className="m-0 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label={t('charts.responsesReceived')} value={count(current)} />
        <Stat label={t('charts.invited')} value={count(target)} />
        {/* Never negative: more responses than invitations means the invite list
            changed under the survey, and "-12 remaining" reads as a bug. */}
        <Stat label={t('charts.stillOutstanding')} value={count(Math.max(0, target - current))} />
        {minutesRemaining !== undefined ? (
          <Stat label={t('charts.timeRemaining')} value={formatMinutes(minutesRemaining, locale)} />
        ) : null}
      </dl>

      {rate === null ? (
        // No target means no denominator, so there is no rate to show -- and a bar
        // at 0% would claim nobody responded, which is a different statement.
        <p className="m-0 text-sm text-fg-secondary">{t('charts.noParticipationTarget')}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-sm">
            <span className={`font-medium ${textTone}`}>{bandLabel}</span>
            <span className="text-fg-secondary">
              {formatMetric(displayRate ?? 0, { kind: 'percentage', decimals: 0 }, locale)}
            </span>
          </div>
          <Progress
            // Already whole, so `aria-valuenow` is not read out digit by digit.
            value={Math.max(0, Math.min(100, displayRate ?? 0))}
            indicatorClassName={fillTone}
            aria-label={t('charts.participationProgress', {
              current: count(current),
              target: count(target),
            })}
          />
        </div>
      )}
    </section>
  )
}

/** One figure with its label, as a definition pair so the association is real markup. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-fg-tertiary">{label}</dt>
      <dd className="m-0 text-xl font-semibold text-fg-primary">{value}</dd>
    </div>
  )
}
