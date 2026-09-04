import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { KpiTile, PieChart, type Kpi, type PieSlice } from '../../../components/charts'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  EmptyState,
  H2,
  LoadingRegion,
  NetworkError,
  SkeletonText,
  Table,
} from '../../../components/ui'
import {
  getLiveResults,
  getMicroclimate,
  type LiveResults,
  type MicroclimateDetail,
} from '../api/microclimates'
import { getMicroclimateCsv, microclimateCsvFileName } from '../api/microclimateExport'
import { downloadBlobFile } from '../../../lib/downloadBlobFile'
import MicroclimateContentNotice from '../components/MicroclimateContentNotice'
import MicroclimateSentimentNotice from '../components/MicroclimateSentimentNotice'
import MicroclimateWordPanel from '../components/MicroclimateWordPanel'
import { participationPercent } from '../microclimatePrivacy'
import {
  engagementLabel,
  questionTypeLabel,
  statusBadgeVariant,
  statusLabel,
} from '../microclimateVocabulary'
import { KpiRow } from '../../dashboard/components/dashboardGrammar'

/**
 * #129 — what one microclimate found.
 *
 * ## Which of the endpoints the issue names exist (measured 2026-09-03)
 *
 * #129 lists `/microclimates/{id}/analytics`, `/microclimates/analytics` and
 * `/microclimates/{id}/insights`. The first two are not in
 * `src/ClimateProject.Api/Endpoints/`. The third IS — `MicroclimateEndpoints.cs` maps
 * `GET /{id}/insights` — but it answers `generated: false`,
 * `reason: "no_insight_generator_configured"` on every call, because no inference client
 * exists anywhere in `src/`; `MicroclimateSentimentNotice` already says so on this page,
 * and drawing a panel for a response that is always empty would be a second way of
 * saying it. This page is composed from the two reads that carry data — the detail and
 * the live results — plus the one export the server does render:
 * `GET /{id}/export/csv` (`microclimateExport.ts`), which had no caller in the web until
 * the Export CSV action below.
 *
 * ## Why there is no per-question breakdown, and why that is said out loud
 *
 * **Individual microclimate responses are never stored.** `SubmitResponseAsync` is a
 * read-modify-write on the aggregate row: it increments `ResponseCount`, recomputes
 * `EngagementLevel` and merges word counts into `LiveResults.WordCloudData`. There is
 * no `microclimate_responses` table and no per-question storage — the endpoint says
 * so itself, in as many words ("no natural per-response row to insert into").
 *
 * So the entire analysable dataset for a microclimate is five numbers and a word
 * list. Charting a per-question distribution would mean inventing one. The page
 * renders what exists and states the absence, because an admin who does not know
 * this will go looking for a drill-down that was never collected — and because
 * `/surveys/{id}/results` genuinely has it, which is the useful thing to say next.
 *
 * ## Axis rule
 *
 * Bars are zero-anchored (the word frequencies — `BarChart` omits a `domain`, so
 * recharts' zero baseline stands) and the donut is a part-to-whole of one population.
 * The only fitted axis in this lane is the live trend line, where the movement is the
 * point.
 *
 * ## Not polled
 *
 * A results page is a page load. `/live-results` is the poll endpoint, but polling it
 * behind static per-question content would show a counter ticking above panels that
 * never move. The live view is where a moving number belongs.
 */
export default function MicroclimateResultsPage() {
  const { t, locale } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  const [microclimate, setMicroclimate] = useState<MicroclimateDetail | null>(null)
  const [live, setLive] = useState<LiveResults | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setLoadError(null)
    try {
      // Both in one round trip's worth of wall clock, and both required: the counts
      // come from `/live-results` and the questions from the detail, so fetching them
      // in sequence would show half a page for as long as the second request takes.
      const [detail, results] = await Promise.all([
        getMicroclimate(baseUrl, id, locale),
        getLiveResults(baseUrl, id),
      ])
      setMicroclimate(detail)
      setLive(results)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [baseUrl, id, locale, t])

  useEffect(() => {
    void reload()
  }, [reload])

  // The one artefact this page does not build in the browser: the server's CSV, which
  // carries the suppression decision as a reason code rather than re-deriving it here. A
  // failure lands in an inline alert on the page, not in a silent no-op — a download button
  // that does nothing reads as a broken build — and not in the load-error branch, which
  // would replace a page that loaded fine.
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const downloadCsv = useCallback(async () => {
    if (!id) return
    setExporting(true)
    setExportError(null)
    try {
      // The UI locale is a request: the server renders the headings in the locale the
      // reader is reading, the same contract the detail's `resolvedLocale` carries.
      downloadBlobFile(microclimateCsvFileName(id), await getMicroclimateCsv(baseUrl, id, locale))
    } catch {
      setExportError(t('microclimates.failedToExportData'))
    } finally {
      setExporting(false)
    }
  }, [baseUrl, id, locale, t])

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

  if (loading || !microclimate || !live) {
    return (
      <LoadingRegion loading label={t('common.loading')}>
        <SkeletonText lines={6} />
      </LoadingRegion>
    )
  }

  const title = microclimate.title ?? t('microclimates.untitled')
  const outstanding = Math.max(0, live.targetParticipantCount - live.responseCount)

  const slices: PieSlice[] = [
    { key: 'responded', name: t('microclimates.resultsResponded'), value: live.responseCount },
    { key: 'outstanding', name: t('microclimates.resultsOutstanding'), value: outstanding },
  ]

  return (
    <div>
      <PageTopBar
        title={title}
        description={t('microclimates.resultsDescription')}
        badge={{
          text: statusLabel(t, microclimate.status),
          variant: statusBadgeVariant(microclimate.status),
        }}
        breadcrumbs={[
          { label: t('navigation.microclimates'), href: '/microclimates' },
          { label: title, href: `/microclimates/${microclimate.id}` },
          { label: t('microclimates.results') },
        ]}
        actions={
          <>
            {microclimate.status === 'active' ? (
              <Button asChild variant="outline">
                <Link to={`/microclimates/${microclimate.id}/live`}>
                  {t('microclimates.viewLive')}
                </Link>
              </Button>
            ) : null}
            {/* Rendered for every reader of this route on purpose: `roleCapabilities.ts`
                authorises `/microclimates/:id/results` by `GET /microclimates/{id}/export`
                itself, so anyone who can see this page is someone the export accepts. */}
            <Button variant="outline" disabled={exporting} onClick={downloadCsv}>
              {t('microclimates.exportCsv')}
            </Button>
          </>
        }
      />

      {exportError ? (
        <Alert variant="destructive" role="alert" className="mt-panel-gap">
          <AlertTitle>{t('microclimates.exportCsvFailedTitle')}</AlertTitle>
          <AlertDescription>{exportError}</AlertDescription>
        </Alert>
      ) : null}

      <MicroclimateContentNotice
        language={microclimate.language}
        resolvedLocale={microclimate.resolvedLocale}
        fallbackFields={microclimate.fallbackFields}
      />

      <H2>{t('microclimates.participationRate')}</H2>
      {/* The redesign's flat strip, not the old `KPIDisplay` card grid. The numbers here
          are context for the split below them rather than the content of the screen, which
          is exactly the split `charts/KpiTile.tsx` draws between the two. `KpiRow` fixes
          the column count at four; the old `columns` prop is what let callers produce the
          ragged rows it exists to prevent. */}
      <KpiRow>
        {resultsKpis(live, t).map((kpi) => (
          <KpiTile
            key={kpi.id}
            label={kpi.label}
            value={kpi.value}
            format={kpi.format}
            locale={locale}
          />
        ))}
      </KpiRow>

      <div className="mt-panel-gap flex flex-wrap items-center gap-inline">
        <span className="text-fg-secondary">{t('microclimates.kpiEngagement')}</span>
        <Badge variant="secondary">{engagementLabel(t, live.engagementLevel)}</Badge>
      </div>

      <H2>{t('microclimates.resultsSplitTitle')}</H2>
      {live.targetParticipantCount === 0 ? (
        // A part-to-whole chart with no whole is not a chart. Said rather than drawn
        // as a single 100% wedge, which would claim full participation.
        <EmptyState
          title={t('charts.noParticipationTarget')}
          description={t('microclimates.targetParticipantsHint')}
        />
      ) : (
        <PieChart data={slices} donut />
      )}

      <H2>{t('microclimates.resultsWordsTitle')}</H2>
      <p className="mb-panel-gap mt-0 text-fg-secondary">
        {t('microclimates.resultsWordsDescription')}
      </p>
      <MicroclimateWordPanel
        words={live.wordCloud}
        responseCount={live.responseCount}
        variant="bars"
      />

      <H2>{t('microclimates.resultsQuestionsTitle')}</H2>
      {microclimate.questions.length === 0 ? (
        <EmptyState title={t('microclimates.resultsNoQuestions')} />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t('common.order')}</th>
              <th>{t('surveys.questionText')}</th>
              <th>{t('common.type')}</th>
              <th>{t('common.required')}</th>
            </tr>
          </thead>
          <tbody>
            {microclimate.questions.map((question) => (
              <tr key={question.id}>
                <td>{question.order}</td>
                <td>{question.text ?? t('microclimates.untitled')}</td>
                <td>{questionTypeLabel(t, question.type)}</td>
                <td>{question.required ? t('common.yes') : t('common.no')}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {/* Stated, not omitted: an admin who does not know responses are aggregated
          rather than stored will keep looking for the drill-down. */}
      <Alert role="status" className="mt-panel-gap">
        <AlertTitle>{t('microclimates.resultsNoBreakdownTitle')}</AlertTitle>
        <AlertDescription>{t('microclimates.resultsNoBreakdownDescription')}</AlertDescription>
      </Alert>

      <H2>{t('microclimates.sentimentAnalysis')}</H2>
      <MicroclimateSentimentNotice />
    </div>
  )
}

/** Same shape and the same omission rule as the live view's counters. */
function resultsKpis(
  live: LiveResults,
  t: (key: string, params?: Record<string, string | number>) => string,
): Kpi[] {
  const kpis: Kpi[] = [
    { id: 'responses', label: t('microclimates.kpiResponses'), value: live.responseCount },
    { id: 'target', label: t('microclimates.kpiTarget'), value: live.targetParticipantCount },
    {
      id: 'outstanding',
      label: t('microclimates.kpiOutstanding'),
      value: Math.max(0, live.targetParticipantCount - live.responseCount),
    },
  ]

  const rate = participationPercent(live.responseCount, live.targetParticipantCount)
  if (rate !== null) {
    kpis.push({
      id: 'participation',
      label: t('microclimates.kpiParticipation'),
      value: rate,
      format: { kind: 'percentage' },
    })
  }

  return kpis
}
