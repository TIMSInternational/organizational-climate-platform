import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { MessageSquare, Users, UserMinus, Percent } from 'lucide-react'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import {
  Counter,
  KPIDisplay,
  ParticipationTracker,
  RealTimeChartContainer,
  type Kpi,
} from '../../../components/charts'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  H2,
  LoadingRegion,
  NetworkError,
  SkeletonText,
} from '../../../components/ui'
import {
  getLiveResults,
  getMicroclimate,
  type LiveResults,
  type MicroclimateDetail,
} from '../api/microclimates'
import LiveResponseTrend from '../components/LiveResponseTrend'
import MicroclimateContentNotice from '../components/MicroclimateContentNotice'
import MicroclimateSentimentNotice from '../components/MicroclimateSentimentNotice'
import MicroclimateWordPanel from '../components/MicroclimateWordPanel'
import { participationPercent } from '../microclimatePrivacy'
import { engagementLabel, statusBadgeVariant, statusLabel } from '../microclimateVocabulary'

/**
 * Milliseconds between polls.
 *
 * `usePolling` throws a `RangeError` outside 3000-5000ms rather than clamping, on the
 * grounds that a 200ms interval is a production incident and silently correcting it
 * hides a false belief about how often this runs. 4000 sits in the middle: a
 * microclimate runs for minutes in front of a room, so the number on screen has to
 * be a few seconds old rather than a minute old, and faster than a human reads buys
 * nothing.
 */
const POLL_MS = 4000

/**
 * #128 — a microclimate while it is happening.
 *
 * ## Why this does not reuse `LiveResultsPanel`'s loop
 *
 * The issue says to reuse the polling already in `MicroclimateDetailPage`. That
 * instruction predates #79. `LiveResultsPanel` is a 61-line `setInterval` that
 * swallows every failure in a bare `catch {}` — so a reader watching a dead endpoint
 * sees a plausible figure with no indication it stopped updating, which is the worst
 * failure a live view has, because the number is still *there*. `usePolling` and
 * `RealTimeChartContainer` generalise exactly that loop and were written to replace
 * it: they skip a tick while a request is still in flight (so a slow backend cannot
 * accumulate requests and settle on an older value than it already had), pause on
 * `visibilitychange` (so an abandoned tab stops hitting the API forever for data
 * nobody will see), and keep the last good value while flipping a visible "updates
 * stalled" marker. Reusing the named file would have re-shipped all three bugs.
 *
 * Polling stops on unmount because the effect inside `usePolling` cleans up its
 * interval and its listener — that is the acceptance criterion, satisfied by the
 * mechanism rather than by a second one written here.
 *
 * ## Detail once, results on the loop
 *
 * The title, the schedule and the questions do not change while a session runs, so
 * they are fetched once. Only `/live-results` is polled, which is the cheap endpoint
 * — a single row read plus a JSON parse, no question join.
 *
 * ## The three non-live states are designed, not a blank panel
 *
 * A draft has not opened yet: the page says when it will, and links to the session
 * where it is launched. A closed session will never move again: the page says so and
 * points at the results. Only `active` polls at all, so a page left open on a closed
 * session is not quietly hitting the API every four seconds.
 *
 * ## No sentiment
 *
 * `sentimentScore` is hardcoded to `0` on every submission. See
 * `MicroclimateSentimentNotice` for why a labelled absence beats a badged zero.
 */
export default function MicroclimateLivePage() {
  const { t, locale } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  const [microclimate, setMicroclimate] = useState<MicroclimateDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // `useCallback` + `[reload]`, not a plain function with `[id]`. The lint budget is
  // `--max-warnings 10` and full, so one new `exhaustive-deps` warning fails CI.
  const reload = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setLoadError(null)
    try {
      // The UI locale is sent explicitly. Letting the server default it resolves
      // against the microclimate's own language rather than the reader's, so a
      // Spanish reader silently gets English on a bilingual session.
      setMicroclimate(await getMicroclimate(baseUrl, id, locale))
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [baseUrl, id, locale, t])

  useEffect(() => {
    void reload()
  }, [reload])

  // Held as a callback so the identity is stable across renders. `usePolling` keeps
  // the fetcher in a ref, so an inline arrow would also be fine — this is for
  // readability, not for the hook.
  const fetchLive = useCallback(
    () => getLiveResults(baseUrl, id ?? ''),
    [baseUrl, id],
  )

  if (!id) {
    return <p role="alert">{t('errors.notFound')}</p>
  }

  if (loadError) {
    return (
      <NetworkError
        title={t('microclimates.errorLoadingMicroclimate')}
        description={loadError}
        onRetry={reload}
        retryText={t('common.retry')}
      />
    )
  }

  if (loading || !microclimate) {
    return (
      <LoadingRegion loading label={t('common.loading')}>
        <SkeletonText lines={6} />
      </LoadingRegion>
    )
  }

  const title = microclimate.title ?? t('microclimates.untitled')
  const isActive = microclimate.status === 'active'
  const respondUrl = `${window.location.origin}/microclimates/${microclimate.id}/respond`

  return (
    <div>
      <PageTopBar
        title={title}
        description={t('microclimates.liveDescription')}
        badge={{
          text: statusLabel(t, microclimate.status),
          variant: statusBadgeVariant(microclimate.status),
        }}
        breadcrumbs={[
          { label: t('navigation.microclimates'), href: '/microclimates' },
          { label: title, href: `/microclimates/${microclimate.id}` },
          { label: t('microclimates.liveTitle') },
        ]}
        actions={
          <Button asChild variant="outline">
            <Link to={`/microclimates/${microclimate.id}/results`}>
              {t('microclimates.results')}
            </Link>
          </Button>
        }
      />

      <MicroclimateContentNotice
        language={microclimate.language}
        resolvedLocale={microclimate.resolvedLocale}
        fallbackFields={microclimate.fallbackFields}
      />

      {microclimate.status === 'draft' && (
        <Alert variant="info" role="status" className="mb-panel-gap">
          <AlertTitle>{t('microclimates.microclimateScheduled')}</AlertTitle>
          <AlertDescription>
            <span className="grid gap-1">
              <span>{t('microclimates.scheduledMicroclimateDescription')}</span>
              <span>
                {t('microclimates.scheduledStartTime')}:{' '}
                {new Date(microclimate.startTime).toLocaleString(locale)}
              </span>
            </span>
          </AlertDescription>
        </Alert>
      )}

      {microclimate.status === 'closed' && (
        <Alert role="status" className="mb-panel-gap">
          <AlertTitle>{t('microclimates.liveClosedTitle')}</AlertTitle>
          <AlertDescription>{t('microclimates.liveClosedDescription')}</AlertDescription>
        </Alert>
      )}

      {isActive && microclimate.anonymousResponses && (
        <Card className="mb-panel-gap">
          <CardHeader>
            <CardTitle className="text-base">{t('microclimates.liveRespondLink')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-inline">
            <p className="m-0 text-fg-secondary">
              {t('microclimates.liveRespondLinkDescription')}
            </p>
            {/* Selectable text rather than a copy button: the clipboard API is
                blocked outside a secure context and silently no-ops in several
                embedded browsers, and a copy button that does nothing is worse than
                a link somebody can read out or select. */}
            <code className="break-all rounded-md border border-line-default bg-surface-input px-2 py-1 text-sm">
              {respondUrl}
            </code>
          </CardContent>
        </Card>
      )}

      <RealTimeChartContainer
        // Not `liveTitle`: that is already the last breadcrumb and the page's own
        // subject, and a panel heading repeating it says nothing about the panel.
        title={t('microclimates.liveResults')}
        fetch={fetchLive}
        intervalMs={POLL_MS}
        // Only an open session polls. A page left on a closed one otherwise hits the
        // API every four seconds for a number that cannot change.
        enabled={isActive}
        disabledMessage={t('microclimates.liveResultsOnlyWhenActive')}
        locale={locale}
      >
        {(live: LiveResults) => (
          <div className="flex flex-col gap-panel-gap">
            <KPIDisplay
              kpis={liveKpis(live, t, `/microclimates/${id}/results`)}
              columns={4}
              locale={locale}
              title={t('microclimates.liveParticipation')}
            />

            {live.responseCount === 0 ? (
              // A designed state, not a blank panel. The counters above still read
              // "0 of 40", which identifies nobody and is exactly the number that
              // says whether to keep chasing.
              <EmptyState
                title={t('microclimates.liveNoResponsesTitle')}
                description={t('microclimates.liveNoResponsesDescription')}
              />
            ) : (
              <>
                <ParticipationTracker
                  current={live.responseCount}
                  target={live.targetParticipantCount}
                  locale={locale}
                  // Its own heading, not `liveParticipation` again. The KPI row above
                  // already carries that title, so reusing it rendered "Live
                  // Participation" twice on the page, over two blocks showing much the
                  // same numbers -- which reads as a duplicated section rather than as
                  // a summary followed by its progress bar.
                  title={t('microclimates.liveProgressTitle')}
                />

                <div className="flex flex-wrap items-center gap-panel-gap">
                  <Counter
                    value={live.responseCount}
                    label={t('microclimates.kpiResponses')}
                    locale={locale}
                  />
                  <span className="flex items-center gap-inline">
                    <span className="text-fg-secondary">{t('microclimates.kpiEngagement')}</span>
                    <Badge variant="secondary">
                      {engagementLabel(t, live.engagementLevel)}
                    </Badge>
                  </span>
                </div>

                <LiveResponseTrend
                  responseCount={live.responseCount}
                  title={t('microclimates.liveTrendTitle')}
                />
              </>
            )}

            {/* No `title` on the panel: the <H2> above already carries it, and
                passing both drew "Live Word Cloud" twice — the same duplication
                fixed on the results page. `MicroclimateWordPanel.title` is optional
                precisely so a caller with its own heading can leave it off. */}
            <H2>{t('microclimates.liveWordCloud')}</H2>
            <MicroclimateWordPanel
              words={live.wordCloud}
              responseCount={live.responseCount}
            />

            <H2>{t('microclimates.sentimentAnalysis')}</H2>
            <MicroclimateSentimentNotice />
          </div>
        )}
      </RealTimeChartContainer>
    </div>
  )
}

/**
 * The headline counters.
 *
 * `targetParticipantCount` can be zero — nothing in `CreateAsync` requires it to be
 * positive — so the participation rate is omitted rather than shown as 0%. A rate
 * over an invented denominator is worse than no rate, and `ComputeEngagementLevel`
 * makes the same call server side by returning "medium" instead of dividing by zero.
 */
function liveKpis(
  live: LiveResults,
  t: (key: string, params?: Record<string, string | number>) => string,
  resultsHref: string,
): Kpi[] {
  const kpis: Kpi[] = [
    {
      id: 'responses',
      label: t('microclimates.kpiResponses'),
      value: live.responseCount,
      icon: MessageSquare,
      // The ForMaps KPI card's "Continue →" — the one card here with a genuine next
      // step. The live page is a running count; the settled breakdown of what those
      // responses said is the results page, and this is the only route out of the
      // band to it. The other three cards are re-cuts of the same number and get no
      // link: a card that offers one is asserting the destination adds something.
      action: { label: t('microclimates.results'), href: resultsHref },
    },
    {
      id: 'target',
      label: t('microclimates.kpiTarget'),
      value: live.targetParticipantCount,
      icon: Users,
    },
    {
      id: 'outstanding',
      label: t('microclimates.kpiOutstanding'),
      // Never negative: an anonymous link can be answered by more people than were
      // expected, and "-3 yet to respond" is not a fact about anything.
      value: Math.max(0, live.targetParticipantCount - live.responseCount),
      icon: UserMinus,
    },
  ]

  const rate = participationPercent(live.responseCount, live.targetParticipantCount)
  if (rate !== null) {
    kpis.push({
      id: 'participation',
      label: t('microclimates.kpiParticipation'),
      value: rate,
      format: { kind: 'percentage' },
      icon: Percent,
    })
  }

  return kpis
}
