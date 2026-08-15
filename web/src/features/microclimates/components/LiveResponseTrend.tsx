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
      const label = new Date().toLocaleTimeString(locale)

      // `label` is this chart's x-axis key (`XAxis dataKey="label"` in LineChart), and
      // a formatted clock time is only unique to the second. Appending blindly lets two
      // points share a key, which React reports as "Encountered two children with the
      // same key" and recharts draws as one category holding two values.
      //
      // A second is not a rare collision here. React's StrictMode double-invokes this
      // effect on mount, so it happened on every single page load in development. In
      // production the same thing happens whenever two responses land inside the same
      // second -- which for a live pulse view is the event it exists to show, not an
      // edge case. Switching UI language mid-session is a third route, since `locale`
      // is a dependency.
      //
      // The last point wins rather than being dropped: a point means "the total was N
      // at time T", so when two changes share a T the newer total is the accurate one
      // to draw there. That keeps labels unique without inventing a fake timestamp,
      // and leaves the "a point per change" rule above intact.
      const last = current.at(-1)
      const next =
        last?.label === label
          ? [...current.slice(0, -1), { label, value: responseCount }]
          : [...current, { label, value: responseCount }]

      return next.slice(-MAX_POINTS)
    })
  }, [responseCount, locale])

  if (points.length < 2) {
    // Not an empty chart: one point is a dot on an axis, which reads as a broken
    // chart rather than as "nothing has changed yet".
    return (
      <div className="flex flex-col gap-inline">
        {/* Matches `ChartFrame`'s `<figcaption>` (`text-lg font-medium`), because
            this heading is standing in for exactly that caption while there is
            nothing to draw yet — an `h3` at 16px made the placeholder state
            louder than the chart it becomes. Level `h4`: the only caller renders
            this inside `RealTimeChartContainer`, whose own heading is an `h3`. */}
        <h4 className="m-0 text-lg font-medium text-fg-primary">{title}</h4>
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
