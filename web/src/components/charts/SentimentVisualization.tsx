import { useTranslation } from '../../i18n'
import { Table } from '../ui'
import { formatMetric } from './formatMetric'
import { DIVERGING_COLORS, divergingColor } from './palette'
import { sentimentBreakdown, type SentimentCounts } from './sentiment'

interface SentimentVisualizationProps {
  data: SentimentCounts
  /** Already-translated heading. */
  title?: string
  /** BCP-47 locale. Defaults to the document's language. */
  locale?: string
  isLoading?: boolean
  /**
   * Marks the figures as placeholder data.
   *
   * Set this when rendering `sentimentStub`. It puts a visible notice on the chart,
   * because a fabricated number that looks like a measurement is worse than no
   * number at all — and sentiment is blocked on #67, so every current caller is
   * showing a stub.
   */
  isPlaceholder?: boolean
}

/**
 * How positive, neutral and negative the open-ended responses were.
 *
 * Replaces legacy `SentimentVisualization`.
 *
 * ## Sentiment is a diverging scale, not three statuses
 *
 * Legacy coloured the three bars `bg-green-500`, `bg-yellow-500` and `bg-red-500`.
 * That reads sentiment as a *judgement*: amber is the warning colour in this UI, so
 * neutral feedback rendered as a caution, and a workforce that felt fine about
 * something looked like a problem. Negative sentiment is also not an error — it is
 * a measurement, and the whole point of collecting it.
 *
 * So this uses the validated diverging palette instead: two hues around a genuinely
 * neutral grey midpoint. That is what `--admin-chart-div-*` exists for, and it is
 * the one place `divergingColor`'s dead band matters — a net score of +0.02 renders
 * neutral rather than being reported as positive.
 *
 * ## One stacked bar, not three
 *
 * The three shares are parts of one whole and always sum to 100%, so a single
 * 100%-stacked bar shows the composition directly. Three separate tracks make the
 * reader add the percentages up themselves to check they are looking at shares
 * rather than three independent measures. The counts stay in the table beneath, so
 * nothing is lost.
 */
export default function SentimentVisualization({
  data,
  title,
  locale,
  isLoading = false,
  isPlaceholder = false,
}: SentimentVisualizationProps) {
  const { t } = useTranslation()
  const breakdown = sentimentBreakdown(data)

  const segments = [
    {
      key: 'positive',
      label: t('charts.sentimentPositive'),
      share: breakdown.positive,
      // Read from the ends of the scale directly rather than through
      // `divergingColor`: these are the three named categories, not a score.
      color: DIVERGING_COLORS[4],
    },
    {
      key: 'neutral',
      label: t('charts.sentimentNeutral'),
      share: breakdown.neutral,
      color: DIVERGING_COLORS[2],
    },
    {
      key: 'negative',
      label: t('charts.sentimentNegative'),
      share: breakdown.negative,
      color: DIVERGING_COLORS[0],
    },
  ]

  const percent = (fraction: number) =>
    formatMetric(fraction * 100, { kind: 'percentage', decimals: 1 }, locale)
  const count = (value: number) => formatMetric(value, { kind: 'number' }, locale)

  if (isLoading) {
    return (
      <figure className="m-0 flex flex-col gap-2">
        {title ? <figcaption className="text-lg font-medium text-fg-primary">{title}</figcaption> : null}
        <div
          role="status"
          aria-label={t('charts.loadingChart')}
          className="h-40 animate-pulse rounded-lg border border-line-default bg-surface-icon-box"
        />
      </figure>
    )
  }

  return (
    <figure className="m-0 flex flex-col gap-2">
      {title ? (
        <figcaption className="text-lg font-medium text-fg-primary">{title}</figcaption>
      ) : null}

      {isPlaceholder ? (
        <p role="status" className="m-0 text-xs text-accent-amber">
          {t('charts.sentimentPlaceholder')}
        </p>
      ) : null}

      {breakdown.total === 0 ? (
        <p role="status" className="m-0 text-fg-secondary">
          {t('charts.noData')}
        </p>
      ) : (
        <>
          {/* The bar is decorative: every share is stated as text in the table
              below, so it is hidden from assistive tech rather than being read out
              as a row of meaningless boxes. */}
          <div
            aria-hidden="true"
            className="flex h-4 w-full overflow-hidden rounded-full bg-surface-icon-box"
          >
            {segments
              .filter((segment) => segment.share.share > 0)
              .map((segment) => (
                <span
                  key={segment.key}
                  className="h-full"
                  style={{
                    width: `${segment.share.share * 100}%`,
                    backgroundColor: segment.color,
                  }}
                />
              ))}
          </div>

          <Table>
            <caption className="sr-only">{t('charts.sentimentTableCaption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('charts.categoryColumn')}</th>
                <th scope="col">{t('charts.responsesColumn')}</th>
                <th scope="col">{t('charts.shareColumn')}</th>
              </tr>
            </thead>
            <tbody>
              {segments.map((segment) => (
                <tr key={segment.key}>
                  <th scope="row" className="font-normal">
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="size-2 rounded-full"
                        style={{ backgroundColor: segment.color }}
                      />
                      {segment.label}
                    </span>
                  </th>
                  <td>{count(segment.share.count)}</td>
                  <td>{percent(segment.share.share)}</td>
                </tr>
              ))}
            </tbody>
          </Table>

          <p className="m-0 flex items-center gap-2 text-sm">
            <span className="text-fg-secondary">{t('charts.netSentiment')}</span>
            {/* The colour goes on a swatch, not on the digits. The palette's own
                rule is "text wears text tokens, never the series colour", and this
                broke it: `divergingColor` returns fill colours, so a net score just
                inside the band rendered as pale blue on white -- measured at 1.6:1
                against the surface, effectively unreadable. The swatch carries the
                polarity; the number stays legible. */}
            <span
              aria-hidden="true"
              className="size-2 rounded-full"
              style={{ backgroundColor: divergingColor(breakdown.netScore) }}
            />
            <span className="font-semibold text-fg-primary">
              {formatMetric(breakdown.netScore * 100, { kind: 'percentage', decimals: 1 }, locale)}
            </span>
            <span className="text-fg-tertiary">
              {t('charts.totalResponses', { count: count(breakdown.total) })}
            </span>
          </p>
        </>
      )}
    </figure>
  )
}
