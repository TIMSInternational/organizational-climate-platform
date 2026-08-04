import type { ReactNode } from 'react'
import { useTranslation } from '../../i18n'
import type { ChartDatum, ChartSeries } from './types'

interface ChartFrameProps {
  title?: string
  isLoading?: boolean
  /** True when there is nothing to plot. Computed by the caller, not inferred here. */
  isEmpty: boolean
  height: number
  /** Rendered when not loading and not empty. */
  children: ReactNode
  /** Series and data for the table view, which is how identity survives without colour. */
  series?: readonly ChartSeries[]
  data?: readonly ChartDatum[]
}

/**
 * Title, loading state, empty state and table fallback — the four things every
 * chart needs and none of them chart-specific.
 *
 * **Empty and loading are separate states on purpose.** A spinner shown when a
 * query legitimately returned nothing reads as a hung page, and "No data" shown
 * while a request is in flight reads as a wrong answer. Analytics pages routinely
 * render before data arrives, so both happen constantly.
 *
 * The table view is the accessibility fallback the palette layer promises: colour
 * is never the only carrier of identity, and a screen-reader user or a print
 * reader gets the numbers rather than a description of a picture.
 */
export default function ChartFrame({
  title,
  isLoading = false,
  isEmpty,
  height,
  children,
  series,
  data,
}: ChartFrameProps) {
  const { t } = useTranslation()

  return (
    <figure className="m-0 flex flex-col gap-2">
      {title ? (
        <figcaption className="text-lg font-medium text-fg-primary">{title}</figcaption>
      ) : null}

      {isLoading ? (
        // animate-pulse rather than a spinner: the shape of the thing being
        // loaded is more informative than a rotating icon, and framer-motion is
        // not ported (#75-#77).
        <div
          role="status"
          aria-label={t('charts.loadingChart')}
          className="animate-pulse rounded-md bg-surface-icon-box"
          style={{ height }}
        />
      ) : isEmpty ? (
        <p
          role="status"
          className="flex items-center justify-center rounded-md border border-line-default text-fg-secondary"
          style={{ height }}
        >
          {t('charts.noData')}
        </p>
      ) : (
        children
      )}

      {!isLoading && !isEmpty && series && data ? (
        <ChartTable series={series} data={data} />
      ) : null}
    </figure>
  )
}

/**
 * The same numbers as a table, collapsed by default.
 *
 * A `<details>` rather than a toggle button: it needs no state, it is keyboard
 * operable for free, and the content is in the DOM for find-in-page and for a
 * screen reader that walks the document rather than following focus.
 */
function ChartTable({
  series,
  data,
}: {
  series: readonly ChartSeries[]
  data: readonly ChartDatum[]
}) {
  const { t } = useTranslation()

  return (
    <details>
      <summary className="cursor-pointer text-sm text-fg-secondary">{t('charts.showTable')}</summary>
      <table className="w-full text-sm">
        <caption className="sr-only">{t('charts.tableCaption')}</caption>
        <thead>
          <tr>
            <th scope="col" className="text-left text-fg-secondary">
              {t('charts.categoryColumn')}
            </th>
            {series.map((s) => (
              <th key={s.key} scope="col" className="text-left text-fg-secondary">
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((datum) => (
            <tr key={datum.label}>
              <th scope="row" className="text-left font-normal text-fg-primary">
                {datum.label}
              </th>
              {series.map((s) => (
                <td key={s.key} className="text-fg-primary">
                  {datum.values[s.key] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}
