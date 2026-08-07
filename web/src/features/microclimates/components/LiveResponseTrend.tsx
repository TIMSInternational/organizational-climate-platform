import { useEffect, useState } from 'react'
import { useTranslation } from '../../../i18n'
import { LineChart } from '../../../components/charts'

interface LiveResponseTrendProps {
  /** The latest total from the poll. */
  responseCount: number
  /** Already-translated heading. */
  title: string
  /** Test-only explicit width — `ResponsiveContainer` measures 0 under happy-dom. */
  width?: number
}

/**
 * How many points to keep.
 *
 * A microclimate runs for minutes and this only records changes, so the cap is a
 * guard against a very long session rather than a normal occurrence. Oldest points
 * are dropped, because the interesting end of a live view is the recent one.
 */
const MAX_POINTS = 30

/**
 * Responses arriving, plotted against the clock.
 *
 * ## What this is, and what it is honestly not
 *
 * The API exposes a running total and no history: there is no per-response row to
 * query (`SubmitResponseAsync` increments an aggregate — see `MicroclimateEndpoints`
 * line 693) and no time series endpoint. So this is not "the response curve for this
 * session"; it is what *this browser tab* has observed since it was opened, and the
 * heading says exactly that. Opening the page late shows a short line starting at
 * whatever the total already was, which is the truth rather than a gap.
 *
 * ## A point per change, not a point per poll
 *
 * The effect depends on `responseCount`, so a poll that returns the same total adds
 * nothing. Thirty identical points on a flat line is not a trend, it is the poll
 * interval drawn as data — and it makes the one moment that matters, a response
 * landing, indistinguishable from the twenty seconds either side of it.
 *
 * ## The axis rule
 *
 * A line fits its data range: `LineChart` sets `domain={['auto', 'auto']}` itself,
 * so a session that moves from 18 to 22 responses shows that movement instead of a
 * flat line at the top of a 0-22 axis. Bars are the ones anchored to zero, which is
 * what the results page uses for word frequencies.
 */
export default function LiveResponseTrend({ responseCount, title, width }: LiveResponseTrendProps) {
  const { t, locale } = useTranslation()
  const [points, setPoints] = useState<{ label: string; value: number }[]>([])

  useEffect(() => {
    // Functional update, so the effect does not have to depend on `points` and
    // therefore does not re-run itself on every append.
    setPoints((current) => {
      const next = [
        ...current,
        { label: new Date().toLocaleTimeString(locale), value: responseCount },
      ]
      return next.slice(-MAX_POINTS)
    })
  }, [responseCount, locale])

  if (points.length < 2) {
    // Not an empty chart: one point is a dot on an axis, which reads as a broken
    // chart rather than as "nothing has changed yet".
    return (
      <div className="flex flex-col gap-inline">
        <h3 className="m-0">{title}</h3>
        <p className="m-0 text-fg-secondary">{t('microclimates.liveTrendHint')}</p>
      </div>
    )
  }

  return (
    <LineChart
      title={title}
      width={width}
      data={points.map((point) => ({ label: point.label, values: { responses: point.value } }))}
      series={[{ key: 'responses', name: t('microclimates.liveSeriesResponses') }]}
    />
  )
}
