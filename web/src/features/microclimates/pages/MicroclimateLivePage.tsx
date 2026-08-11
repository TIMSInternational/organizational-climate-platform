import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import {
  KpiTile,
  RealTimeChartContainer,
  bandStatus,
  formatMetric,
  participationBand,
} from '../../../components/charts'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  EmptyState,
  LoadingRegion,
  NetworkError,
  Progress,
  SkeletonText,
} from '../../../components/ui'
import {
  getLiveResults,
  getMicroclimate,
  type LiveResults,
  type MicroclimateDetail,
} from '../api/microclimates'
import LiveOpenAnswers from '../components/LiveOpenAnswers'
import LiveResponseTrend from '../components/LiveResponseTrend'
import MicroclimateContentNotice from '../components/MicroclimateContentNotice'
import MicroclimateSentimentNotice from '../components/MicroclimateSentimentNotice'
import { MINIMUM_RESPONDENTS, participationPercent } from '../microclimatePrivacy'
import { statusBadgeVariant, statusLabel } from '../microclimateVocabulary'

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
 * #128 — a microclimate while it is happening, redesigned as an instrument.
 *
 * ## The shape of the screen
 *
 * A live view answers three questions in order, so it is laid out in that order:
 *
 * 1. **What is fixed about this session** — the plate. Opened, closes, how many
 *    questions, whether answers are anonymous, and where the disclosure floor
 *    sits. None of it moves while the session runs, so it is fetched once and sits
 *    above the moving parts rather than being mixed in with them.
 * 2. **What the reading is right now** — four flat tiles across, then the meter.
 * 3. **What it is doing** — the trend, then what people wrote.
 *
 * Every *reading* is set in `font-mono tabular-nums`; prose stays in the sans
 * face. That is the one typographic rule that makes this read as a measuring
 * device, and it is why the KPI row is `KpiTile` (whose value carries the mono
 * classes) rather than `KPIDisplay` (a card grid whose figures are sans, and
 * which drew an icon per card — decoration on a screen whose whole job is the
 * numbers).
 *
 * ## Polling every four seconds, never a socket
 *
 * `usePolling` — inside `RealTimeChartContainer` — owns the loop. A `GET` every
 * few seconds reuses the exact authorisation and error handling every other
 * request has, and recovers from a dropped network by simply succeeding next
 * time; a socket costs a persistent connection per viewer, a server-side fan-out
 * and reconnect-and-backfill logic to arrive at the same answer.
 *
 * The panel header carries the freshness readout, which is the honest form of a
 * "LIVE" pill: the timestamp of the last *successful* fetch is always on screen,
 * and a failed poll flips the badge to "updates stalled" while leaving the last
 * good numbers up. `isStale` is `consecutiveFailures > 0 && data !== null`, so the
 * badge cannot read "stalled" before anything has ever loaded — and, in the other
 * direction, it reads "Live" during the window before the first poll returns,
 * which is why nothing on this page (or in its tests) treats that badge as proof
 * that polling happened. The tiles are that proof: they are only rendered from a
 * poll result.
 *
 * ## Detail once, results on the loop
 *
 * The title, the schedule and the questions do not change while a session runs, so
 * they are fetched once. Only `/live-results` is polled, which is the cheap endpoint
 * — a single row read plus a JSON parse, no question join.
 *
 * ## The three non-live states are designed, not a blank panel
 *
 * A draft has not opened yet: the page says when it will. A closed session will
 * never move again: the page says so and points at the results. Only `active`
 * polls at all, so a page left open on a closed session is not quietly hitting the
 * API every four seconds.
 *
 * ## Two figures the redesign deliberately removed
 *
 * **`engagementLevel`.** `MicroclimateEndpoints.ComputeEngagementLevel` (line 524)
 * bands the *same* `responseCount / targetParticipantCount` ratio the
 * participation tile already shows, at 0.3 and 0.7. So a session at 64.6% rendered
 * "Participation 64.6% · Good" beside "Engagement: Medium" — two verdicts on one
 * ratio, disagreeing, with nothing on screen to say they were the same number
 * twice. One ratio, one verdict: `participation.ts`'s bands, which are the ones
 * with a label a reader can act on.
 *
 * **The `Counter` and `ParticipationTracker` blocks.** Between them they restated
 * responses, invited and outstanding a second and third time, in the sans face,
 * under a heading that repeated the panel's. What `ParticipationTracker` adds over
 * the tiles is the bar, so the bar is what survives — drawn here from
 * `participationBand`/`bandStatus`, the same policy module it uses, so the band
 * boundaries are not re-derived.
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
    <div className="flex flex-col gap-panel-gap">
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
        <Alert variant="info" role="status">
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
        <Alert role="status">
          <AlertTitle>{t('microclimates.liveClosedTitle')}</AlertTitle>
          <AlertDescription>{t('microclimates.liveClosedDescription')}</AlertDescription>
        </Alert>
      )}

      <SessionPlate microclimate={microclimate} respondUrl={respondUrl} isActive={isActive} />

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
            <LiveReadings live={live} />
            <ParticipationMeter
              current={live.responseCount}
              target={live.targetParticipantCount}
            />

            {live.responseCount === 0 ? (
              // A designed state, not a blank panel. The tiles above still read
              // "0" against "48", which identifies nobody and is exactly the
              // number that says whether to keep chasing.
              <EmptyState
                title={t('microclimates.liveNoResponsesTitle')}
                description={t('microclimates.liveNoResponsesDescription')}
              />
            ) : (
              <LiveResponseTrend
                responseCount={live.responseCount}
                title={t('microclimates.liveTrendTitle')}
              />
            )}

            <LiveOpenAnswers words={live.wordCloud} responseCount={live.responseCount} />

            <section className="flex flex-col gap-inline">
              {/* `h4`, not `H2`: this block sits inside the live panel, whose own
                  heading is the `h3` `RealTimeChartContainer` renders, under the
                  page's `h1`. It was an `<h2>` before, which put a level-2
                  heading inside a level-3 section and drew it at 20px — larger
                  than the panel heading it belongs to. The redesign's section
                  headings are a size *below* the block they sit in. */}
              <h4 className="m-0 text-lg font-semibold text-fg-primary">
                {t('microclimates.sentimentAnalysis')}
              </h4>
              <MicroclimateSentimentNotice />
            </section>
          </div>
        )}
      </RealTimeChartContainer>
    </div>
  )
}

/**
 * The four readings, as the redesign's flat four-across strip.
 *
 * Every value is `KpiTile`'s, i.e. mono with tabular figures — which is the point
 * of using it: a figure that changes width as it ticks from 9 to 10 is the thing
 * tabular figures exist to prevent, and on this screen the figures tick every four
 * seconds.
 *
 * The participation tile is *omitted* rather than shown as 0% when there is no
 * target: nothing in `CreateAsync` requires `targetParticipantCount` to be
 * positive, and a rate over an invented denominator is worse than no rate.
 */
function LiveReadings({ live }: { live: LiveResults }) {
  const { t, locale } = useTranslation()
  const rate = participationPercent(live.responseCount, live.targetParticipantCount)

  return (
    <div className="grid grid-cols-2 gap-inline lg:grid-cols-4">
      <KpiTile
        label={t('microclimates.kpiResponses')}
        value={live.responseCount}
        locale={locale}
      />
      <KpiTile
        label={t('microclimates.kpiTarget')}
        value={live.targetParticipantCount}
        locale={locale}
      />
      <KpiTile
        label={t('microclimates.kpiOutstanding')}
        // Never negative: an anonymous link can be answered by more people than
        // were expected, and "-3 yet to respond" is not a fact about anything.
        value={Math.max(0, live.targetParticipantCount - live.responseCount)}
        locale={locale}
      />
      {rate !== null && (
        <KpiTile
          label={t('microclimates.kpiParticipation')}
          value={rate}
          // Whole percent, matching the meter below. `formatMetric` defaults to
          // one decimal for a non-integer, so the default rendered "64.6%" here
          // beside the meter's rounded "65%" — the same ratio, printed twice, in
          // two different numbers, with nothing on screen to say they were the
          // same measurement.
          format={{ kind: 'percentage', decimals: 0 }}
          locale={locale}
        />
      )}
    </div>
  )
}

/**
 * Participation as a bar, with the band named in words beside it.
 *
 * The band and its status come from `charts/participation.ts` — the same policy
 * module `ParticipationTracker` uses — so the boundaries are consulted, not
 * re-derived. The mapping from status to a class stays here in `.tsx` on purpose:
 * `styles/utilityExistence.test.ts` sweeps `className` attributes in `.tsx` and
 * cannot follow a class name out of a `.ts` helper, so a typo in one would be
 * exactly as invisible as the four dead classes that guard was written to catch.
 *
 * The rate is rounded once and then used for the label, the band and the bar
 * alike: banding on the raw ratio while displaying a rounded one makes them
 * disagree at the boundary — 190 of 480 is 39.58%, which displays as the "40%"
 * threshold for Fair while banding as Low.
 */
function ParticipationMeter({ current, target }: { current: number; target: number }) {
  const { t, locale } = useTranslation()
  const rate = participationPercent(current, target)

  if (rate === null) {
    return <p className="m-0 text-sm text-fg-secondary">{t('charts.noParticipationTarget')}</p>
  }

  const displayRate = Math.round(rate)
  const band = participationBand(displayRate)
  const status = bandStatus(band)

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

  return (
    <section className="flex flex-col gap-inline">
      <div className="flex flex-wrap items-baseline justify-between gap-inline">
        <span className="text-2xs font-semibold uppercase tracking-label text-fg-tertiary">
          {t('microclimates.liveProgressTitle')}
        </span>
        {/* The colour never carries the verdict on its own — the band is spelled
            out beside it, and the percentage is the reading, so it is mono. */}
        <span className="flex items-baseline gap-inline text-sm">
          <span className={`font-medium ${textTone}`}>{bandLabel}</span>
          <span className="font-mono tabular-nums text-fg-primary">
            {formatMetric(displayRate, { kind: 'percentage', decimals: 0 }, locale)}
          </span>
        </span>
      </div>
      <Progress
        // Already whole, so `aria-valuenow` is not read out digit by digit.
        value={Math.max(0, Math.min(100, displayRate))}
        indicatorClassName={fillTone}
        aria-label={t('charts.participationProgress', {
          current: formatMetric(current, { kind: 'number' }, locale),
          target: formatMetric(target, { kind: 'number' }, locale),
        })}
      />
    </section>
  )
}

/**
 * The session's fixed facts — the plate on the front of the instrument.
 *
 * Everything here comes off the one-shot detail fetch and none of it moves while
 * the session runs, which is why it sits above the polled panel instead of inside
 * it: a value that never changes, redrawn every four seconds inside a block
 * labelled "live", teaches the reader to distrust the block.
 *
 * The disclosure floor is stated here rather than only appearing at the moment
 * something is withheld. An admin watching a session with four responses should
 * be able to see *why* the wording is not there yet without the page having to
 * tell them how many responses there are.
 *
 * The respondent link is selectable text rather than a copy button: the clipboard
 * API is blocked outside a secure context and silently no-ops in several embedded
 * browsers, and a copy button that does nothing is worse than a link somebody can
 * read out or select.
 */
function SessionPlate({
  microclimate,
  respondUrl,
  isActive,
}: {
  microclimate: MicroclimateDetail
  respondUrl: string
  isActive: boolean
}) {
  const { t, locale } = useTranslation()

  return (
    <section className="flex flex-col gap-inline rounded-lg border border-line-light bg-surface-icon-box p-3">
      {/* Five across only from `lg`. At 900px wide the five-column form put the
          two localised timestamps into two lines each while the three short facts
          beside them sat on one, which reads as a broken row rather than as a
          plate. Measured by rendering at 900. */}
      <dl className="m-0 grid grid-cols-2 gap-inline sm:grid-cols-3 lg:grid-cols-5">
        <Fact label={t('microclimates.liveOpenedAt')}>
          {new Date(microclimate.startTime).toLocaleString(locale)}
        </Fact>
        <Fact label={t('microclimates.liveClosesAt')}>
          {new Date(microclimate.endTime).toLocaleString(locale)}
        </Fact>
        <Fact label={t('microclimates.liveQuestionsAsked')}>
          {formatMetric(microclimate.questions.length, { kind: 'number' }, locale)}
        </Fact>
        {/* Not a reading, so not mono: it is a word, and setting a word in the
            figure face is what makes tabular figures stop meaning anything. */}
        <Fact label={t('microclimates.liveRespondingAs')} mono={false}>
          {microclimate.anonymousResponses
            ? t('microclimates.anonymousShort')
            : t('microclimates.identifiedShort')}
        </Fact>
        <Fact label={t('microclimates.liveDisclosureFloor')}>
          {formatMetric(MINIMUM_RESPONDENTS, { kind: 'number' }, locale)}
        </Fact>
      </dl>

      {isActive && microclimate.anonymousResponses && (
        <div className="flex flex-col gap-1">
          <span className="text-2xs font-semibold uppercase tracking-label text-fg-tertiary">
            {t('microclimates.liveRespondLink')}
          </span>
          <code className="break-all rounded-md border border-line-default bg-surface-input px-2 py-1 text-sm">
            {respondUrl}
          </code>
        </div>
      )}
    </section>
  )
}

/** One fact on the plate. A definition pair, so the association is real markup. */
function Fact({
  label,
  mono = true,
  children,
}: {
  label: string
  mono?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-2xs font-semibold uppercase tracking-label text-fg-tertiary">
        {label}
      </dt>
      <dd className={`m-0 text-sm text-fg-primary ${mono ? 'font-mono tabular-nums' : ''}`}>
        {children}
      </dd>
    </div>
  )
}
