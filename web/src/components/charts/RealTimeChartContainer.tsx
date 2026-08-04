import type { ReactNode } from 'react'
import { useTranslation } from '../../i18n'
import { MAX_POLL_MS, usePolling } from './usePolling'

interface RealTimeChartContainerProps<T> {
  /** Already-translated heading. */
  title: string
  /** Fetches the current value. Inline closures are fine — see `usePolling`. */
  fetch: () => Promise<T>
  /** Renders the chart from the latest value. */
  children: (data: T) => ReactNode
  /** Milliseconds between polls; must be 3000–5000. */
  intervalMs?: number
  /** Stops polling, e.g. a survey that has closed. */
  enabled?: boolean
  /** Shown while polling is disabled, instead of the chart. */
  disabledMessage?: string
  /** BCP-47 locale for the timestamp. Defaults to the document's language. */
  locale?: string
}

/**
 * Wraps a chart in a polling loop and says, honestly, how fresh it is.
 *
 * Replaces legacy `RealTimeChartContainer`, which did not poll: it took
 * `hasUpdate` and `lastUpdateTime` as props and left the actual fetching to
 * whichever parent rendered it, so "real time" was a badge and a glow rather than
 * a mechanism. Three legacy consumers each ran their own loop. The loop lives here
 * now, in `usePolling`.
 *
 * ## Freshness is stated, not implied
 *
 * Legacy's contribution to freshness was a pulsing green "LIVE" pill. That pill is
 * a claim about the transport, not about the data — it goes on pulsing while the
 * endpoint 500s, because nothing was ever checking. Here the timestamp of the last
 * successful fetch is always on screen, and a failed poll flips the pill to a
 * warning while leaving the last good numbers visible. A reader can always answer
 * "how old is this?", which is the only question a live view has to answer.
 *
 * The legacy animation — `framer-motion` glows, radial-gradient pulses, a
 * `boxShadow` keyframe loop and a transient "Data Updated" toast — is not ported.
 * `framer-motion` is not in this project (#75–#77), and a chart that flashes every
 * three seconds trains the reader to ignore it. The `animate-pulse` dot is CSS, so
 * `index.css`'s `prefers-reduced-motion` block already neutralises it.
 */
export default function RealTimeChartContainer<T>({
  title,
  fetch,
  children,
  intervalMs = MAX_POLL_MS,
  enabled = true,
  disabledMessage,
  locale,
}: RealTimeChartContainerProps<T>) {
  const { t } = useTranslation()
  const { data, isLoading, lastUpdatedAt, isStale, refresh } = usePolling(fetch, {
    intervalMs,
    enabled,
  })

  const resolvedLocale =
    locale ?? (typeof document !== 'undefined' ? document.documentElement.lang || undefined : undefined)

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0">{title}</h3>

        <div className="flex items-center gap-2">
          {enabled ? (
            <span
              className={`flex items-center gap-2 text-xs font-medium ${
                isStale ? 'text-accent-amber' : 'text-accent-green'
              }`}
            >
              <span
                aria-hidden="true"
                className={`size-2 rounded-full ${
                  isStale ? 'bg-accent-amber' : 'animate-pulse bg-accent-green'
                }`}
              />
              {isStale ? t('charts.updatesStalled') : t('charts.live')}
            </span>
          ) : null}

          {/* An explicit refresh, because a reader who suspects the number is
              stale should not have to reload the page to find out. */}
          <button type="button" onClick={refresh} className="text-xs">
            {t('charts.refreshNow')}
          </button>
        </div>
      </div>

      {/* Polite, not assertive: a figure updating every few seconds must not
          interrupt whatever a screen-reader user is currently reading. */}
      <p aria-live="polite" className="m-0 text-xs text-fg-tertiary">
        {lastUpdatedAt
          ? t('charts.lastUpdatedAt', {
              time: lastUpdatedAt.toLocaleTimeString(resolvedLocale),
            })
          : t('charts.notYetUpdated')}
      </p>

      {!enabled ? (
        <p role="status" className="m-0 text-fg-secondary">
          {disabledMessage ?? t('charts.updatesPaused')}
        </p>
      ) : isLoading ? (
        <div
          role="status"
          aria-label={t('charts.loadingChart')}
          className="h-40 animate-pulse rounded-lg bg-surface-icon-box"
        />
      ) : data === null ? (
        // Distinct from empty: the first fetch failed, so there is nothing to show
        // and "No data" would be a claim about the data rather than about the fetch.
        <p role="status" className="m-0 text-fg-secondary">
          {t('charts.couldNotLoad')}
        </p>
      ) : (
        children(data)
      )}
    </section>
  )
}
