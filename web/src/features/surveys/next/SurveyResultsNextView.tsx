import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ArrowRight, Check, ChevronDown, Download, MoreHorizontal, ShieldCheck, X } from 'lucide-react'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import {
  ClimateMap,
  KpiTile,
  ProtectedCell,
  formatMetric,
  type ClimateMapSelection,
  type MetricFormat,
} from '../../../components/charts'
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  H2,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui'
import type { ViewerCapabilities } from '../../../auth/viewerCapabilities'
import { downloadBlobFile } from '../../../lib/downloadBlobFile'
import { downloadTextFile } from '../../../lib/downloadTextFile'
import { dimensionLabel } from '../dimensionLabel'
import { getSurveyResultsPdf, surveyResultsPdfFileName } from '../api/surveyExport'
import { UNCATEGORISED_DIMENSION } from '../surveyResultsMap'
import { buildBreakdownCsv, buildQuestionResultsCsv, resultsFileName, type CsvLabels } from '../surveyResultsCsv'
import ResultsSuppressionNotice from '../components/ResultsSuppressionNotice'
import type { SurveyResultsNextModel } from './model'
import {
  belowReference,
  cellDetail,
  companyScores,
  groupRows,
  legibleGroups,
  lowShare,
  whereToLookFirst,
  type ResultsDistributionPoint,
} from './derive'

const SCORE: MetricFormat = { kind: 'number', decimals: 1 }
const PANEL = 'rounded-lg border border-line-light bg-surface-panel p-panel'

interface SurveyResultsNextViewProps {
  model: SurveyResultsNextModel
  capabilities: ViewerCapabilities
  /** The API base, for the one export the browser cannot build. */
  baseUrl: string
  onError: (message: string) => void
}

/**
 * The redesigned survey results, after the `SurveyResults` artboard.
 *
 * Reads top to bottom the way the design does: four tiles, "where to look first",
 * the map as the hero with a whole-company row and per-group means, then the opened
 * cell with its question, the same dimension in the other groups and the plan that
 * covers the group. The one action `capabilities` gates is the "create a plan" link
 * (`canCreateActionPlan`); the exports are gated by suppression alone, for the reason
 * given at `actions` below, so nothing here is offered to a viewer the server would
 * refuse.
 *
 * ## The four-layer privacy rule, kept
 *
 * A withheld group never yields a number: (1) `ClimateMap` hatches its row, (2) the
 * per-group means table and the "other groups" list print `ProtectedCell` for it,
 * (3) `whereToLookFirst` and `cellDetail` come from `surveyResultsMap.ts`, which
 * produces nothing for a withheld row, and (4) the exports are the current page's
 * builders over the same payload, which the server already floored.
 */
export default function SurveyResultsNextView({ model, capabilities, baseUrl, onError }: SurveyResultsNextViewProps) {
  const { t, locale } = useTranslation()
  // Opens on the lowest disclosed cell, as the artboard does: the reader lands on the
  // cell the findings name first, with its question already under the map.
  const [selection, setSelection] = useState<ClimateMapSelection | null>(() => {
    const first = whereToLookFirst(model)[0]
    return first ? { rowId: first.rowId, dimensionKey: first.dimensionKey } : null
  })
  const [exporting, setExporting] = useState(false)

  const climate = model.climate
  const reference = climate?.target ?? null
  const score = useCallback((value: number) => formatMetric(value, SCORE, locale), [locale])
  const signed = useCallback(
    (value: number) => `${value > 0 ? '+' : ''}${formatMetric(value, SCORE, locale)}`,
    [locale],
  )
  const dimensionName = useCallback(
    (key: string) => (key === UNCATEGORISED_DIMENSION ? t('surveyResults.uncategorised') : dimensionLabel(key, t)),
    [t],
  )
  const shortDate = useCallback(
    // A date-only ISO string is a calendar day, not an instant: format it in UTC so a
    // due date of the 15th does not print as the 14th west of Greenwich.
    (iso: string) =>
      new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: iso.length === 10 ? 'UTC' : undefined }).format(
        new Date(iso),
      ),
    [locale],
  )

  const rows = useMemo(() => groupRows(model), [model])
  const company = useMemo(() => companyScores(model), [model])
  const below = useMemo(() => belowReference(model), [model])
  const groups = useMemo(() => legibleGroups(model), [model])
  const findings = useMemo(() => whereToLookFirst(model), [model])
  const detail = useMemo(() => (selection ? cellDetail(model, selection) : null), [model, selection])

  const openCell = useCallback((rowId: string, dimensionKey: string) => {
    setSelection((current) =>
      current && current.rowId === rowId && current.dimensionKey === dimensionKey ? null : { rowId, dimensionKey },
    )
  }, [])

  const downloadPdf = useCallback(async () => {
    setExporting(true)
    try {
      downloadBlobFile(surveyResultsPdfFileName(model.surveyId), await getSurveyResultsPdf(baseUrl, model.surveyId, locale))
    } catch (err) {
      onError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setExporting(false)
    }
  }, [baseUrl, model.surveyId, locale, onError, t])

  const csvLabels: CsvLabels = {
    questionOrder: t('surveyResults.csvQuestionOrder'),
    questionText: t('surveyResults.csvQuestionText'),
    questionType: t('surveyResults.csvQuestionType'),
    optionValue: t('surveyResults.csvOptionValue'),
    optionLabel: t('surveyResults.csvOptionLabel'),
    count: t('surveyResults.kpiResponses'),
    percentage: t('surveyResults.csvPercentage'),
    average: t('surveyResults.csvAverage'),
    dimension: t('surveyResults.csvDimension'),
    segment: t('surveyResults.segment'),
    respondents: t('surveyResults.respondents'),
    participationRate: t('surveyResults.participationRate'),
    withheld: t('surveyResults.withheld'),
    notApplicable: t('surveyResults.notApplicable'),
    unsegmented: t('surveyResults.unsegmented'),
  }
  const csvPayload = { surveyId: model.surveyId }

  const name = model.name ?? t('surveyResults.untitled')
  const lastResponse = model.summary.lastResponseAt
  const sample = model.sample
  const sampleChip = sample.isSample ? <Badge variant="warning">{t('dashboard.next.sampleChip')}</Badge> : null
  const protectedGroups = rows.filter((row) => row.isProtected).map((row) => row.name)
  const completedPercent = Math.round(model.summary.completionRate)

  return (
    <div>
      <PageTopBar
        title={t('surveyResults.next.title', { name })}
        eyebrow={
          lastResponse
            ? t('surveyResults.next.eyebrowClosed', { name, date: shortDate(lastResponse) })
            : t('surveyResults.next.eyebrowOpen', { name })
        }
        description={t('surveyResults.next.description')}
        breadcrumbs={[
          { label: t('surveys.title'), href: '/surveys' },
          { label: name, href: `/surveys/${model.surveyId}` },
          { label: t('surveys.results') },
        ]}
        badge={sample.isSample ? { text: t('dashboard.next.sampleChip'), variant: 'warning' } : undefined}
        // `!isSuppressed` alone gates the exports. The page admits a viewer through
        // `seesWholeCompany` (SurveyResultsNextPage.tsx), and `capabilitiesFor` derives
        // `canExport` from the same "admin with a company" shape
        // (viewerCapabilities.ts:163), so `canExport` is true for everyone who reaches
        // this line — a term no test could turn false, so it is not written here.
        // The suppression half is not cosmetic: below the whole-survey floor
        // `questions` and `breakdowns` arrive empty (the current page's guard says the
        // same), and a download holding a header row and nothing else invites the
        // reader to conclude the data was lost rather than withheld.
        actions={
          !model.isSuppressed ? (
            <>
              <Button variant="primary" disabled={exporting} onClick={downloadPdf}>
                <Download aria-hidden="true" />
                {t('surveyResults.next.exportPdf')}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    <Download aria-hidden="true" />
                    {t('surveyResults.next.exportCsv')}
                    <ChevronDown aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() =>
                      downloadTextFile(
                        resultsFileName(csvPayload, 'questions'),
                        'text/csv',
                        buildQuestionResultsCsv(model.questions, csvLabels),
                      )
                    }
                  >
                    {t('surveyResults.exportQuestions')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      downloadTextFile(
                        resultsFileName(csvPayload, 'breakdown'),
                        'text/csv',
                        buildBreakdownCsv(model.breakdown ? [model.breakdown] : [], csvLabels),
                      )
                    }
                  >
                    {t('surveyResults.exportBreakdown')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" aria-label={t('surveyResults.next.moreActions')}>
                    <MoreHorizontal aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <Link to={`/surveys/${model.surveyId}/results`}>{t('surveyResults.next.openClassic')}</Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-section">
        <section aria-labelledby="results-next-tiles" className="grid gap-panel-gap sm:grid-cols-2 xl:grid-cols-4">
          <h2 id="results-next-tiles" className="sr-only">
            {t('surveyResults.next.tilesHeading')}
          </h2>
          <KpiTile
            label={t('surveyResults.next.climateLabel')}
            value={reference}
            format={SCORE}
            locale={locale}
            sub={
              <span className="flex flex-col gap-1">
                <span>{t('surveyResults.next.climateSub')}</span>
                {reference !== null && (
                  <span className="flex flex-wrap items-center gap-1">
                    {t('surveyResults.next.climateVs', {
                      delta: signed(sample.averageDelta),
                      wave: sample.previousCode,
                      count: sample.risesInARow,
                    })}
                    {sampleChip}
                  </span>
                )}
              </span>
            }
          />
          <KpiTile
            label={t('surveyResults.next.participationLabel')}
            value={model.summary.responseCount}
            locale={locale}
            sub={
              <span className="flex flex-col gap-1">
                <span>{t('surveyResults.next.participationSub', { percent: completedPercent })}</span>
                <span>
                  {model.summary.invitedCount === null
                    ? t('surveyResults.next.participationNoInvited')
                    : t('surveyResults.next.participationInvited', { invited: model.summary.invitedCount })}
                </span>
              </span>
            }
          />
          <KpiTile
            label={t('surveyResults.next.groupsLabel')}
            value={groups.legible}
            locale={locale}
            sub={
              <span className="flex flex-col gap-1">
                <span>{t('surveyResults.next.groupsSub', { total: groups.total })}</span>
                <span>
                  {protectedGroups.length === 0
                    ? t('surveyResults.next.groupsAllReadable', { floor: model.minimumGroupSize })
                    : t('surveyResults.next.groupsProtected', {
                        groups: protectedGroups.join(', '),
                        floor: model.minimumGroupSize,
                      })}
                </span>
              </span>
            }
          />
          <KpiTile
            label={t('surveyResults.next.belowLabel')}
            value={below.length}
            locale={locale}
            sub={
              <span className="flex flex-col gap-1">
                <span>{t('surveyResults.next.belowSub')}</span>
                <span>
                  {below.length === 0
                    ? t('surveyResults.next.belowNone')
                    : below.map((entry) => `${dimensionName(entry.key)} ${score(entry.score)}`).join(' · ')}
                </span>
              </span>
            }
          />
        </section>

        {model.isSuppressed || !climate ? (
          <ResultsSuppressionNotice reason={null} minimumGroupSize={model.minimumGroupSize} />
        ) : (
          <>
            <section aria-labelledby="results-next-where" className="flex flex-col gap-panel-gap">
              <div className="flex flex-wrap items-baseline justify-between gap-inline">
                <H2 id="results-next-where">{t('surveyResults.next.whereHeading')}</H2>
                <p className="text-sm text-fg-secondary">
                  {t('surveyResults.next.whereSub', { count: findings.length })}
                </p>
              </div>
              {findings.length === 0 ? (
                <p className="text-sm text-fg-secondary">{t('surveyResults.next.whereNone')}</p>
              ) : (
                <ul className="grid list-none gap-panel-gap p-0 md:grid-cols-3">
                  {findings.map((finding, index) => (
                    <li key={`${finding.rowId}:${finding.dimensionKey}`} className={`${PANEL} flex flex-col gap-2`}>
                      <div className="flex items-start gap-3">
                        <span className="rounded-md bg-current/10 px-2 py-1 font-mono text-sm tabular-nums">
                          {score(finding.score)}
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <span className="font-semibold">
                            {finding.rowName} · {dimensionName(finding.dimensionKey)}
                          </span>
                          <span className="text-sm text-fg-secondary">
                            {index === 0
                              ? t('surveyResults.next.findingLowest', { shortfall: score(finding.shortfall) })
                              : t('surveyResults.next.findingShortfall', { shortfall: score(finding.shortfall) })}
                          </span>
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="flex items-center gap-1 text-fg-secondary">
                          {finding.plan === undefined
                            ? t('surveyResults.next.plansUnavailable')
                            : finding.plan === null
                              ? t('surveyResults.next.planNone')
                              : (
                                  <>
                                    <Check aria-hidden="true" className="size-4" />
                                    {t('surveyResults.next.planCovers')}
                                  </>
                                )}
                        </span>
                        <Button variant="link" size="sm" onClick={() => openCell(finding.rowId, finding.dimensionKey)}>
                          {t('surveyResults.next.viewQuestion')}
                          <ArrowRight aria-hidden="true" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="results-next-map" className={`${PANEL} flex flex-col gap-panel-gap`}>
              <div className="flex flex-wrap items-baseline justify-between gap-inline">
                <H2 id="results-next-map">{t('surveyResults.next.mapHeading')}</H2>
                <p className="text-sm text-fg-secondary">
                  {reference === null
                    ? t('surveyResults.climateAllProtected', { minimum: climate.threshold })
                    : t('surveyResults.next.mapSub', { target: score(reference) })}
                </p>
              </div>

              {/* The whole-company row: one mean per column, with the sample delta under it. */}
              <div>
                <Table className="text-sm">
                  <TableCaption className="sr-only">{t('surveyResults.next.wholeCompany')}</TableCaption>
                  <TableHeader>
                    <TableRow className="text-left text-xs uppercase tracking-wide text-fg-secondary">
                      <TableHead scope="col" className="py-1 pr-3 font-medium">
                        {t('surveyResults.next.wholeCompany')}
                      </TableHead>
                      {climate.dimensions.map((dimension) => (
                        <TableHead key={dimension.key} scope="col" className="px-2 py-1 text-center font-medium">
                          {dimensionName(dimension.key)}
                        </TableHead>
                      ))}
                      <TableHead scope="col" className="px-2 py-1 text-center font-medium">
                        {t('surveyResults.next.groupMean')}
                      </TableHead>
                      <TableHead scope="col" className="px-2 py-1 text-center font-medium">
                        <span className="inline-flex items-center gap-1">
                          {t('surveyResults.next.vsWave', { wave: sample.previousCode })}
                          {sampleChip}
                        </span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow className="font-semibold">
                      <TableHead scope="row" className="py-2 pr-3 text-left">
                        {t('surveyResults.next.wholeCompany')}
                      </TableHead>
                      {climate.dimensions.map((dimension, index) => {
                        const value = company[index]
                        const delta = sample.dimensionDeltas[dimension.key]
                        return (
                          <TableCell key={dimension.key} className="px-2 py-2 text-center font-mono tabular-nums">
                            {value === null ? '—' : score(value)}
                            {value !== null && delta !== undefined && (
                              <span className="block text-xs font-normal text-fg-secondary">{signed(delta)}</span>
                            )}
                          </TableCell>
                        )
                      })}
                      <TableCell className="px-2 py-2 text-center font-mono tabular-nums">
                        {reference === null ? '—' : score(reference)}
                      </TableCell>
                      <TableCell className="px-2 py-2 text-center font-mono tabular-nums">
                        {reference === null ? '—' : signed(sample.averageDelta)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              <ClimateMap
                dimensions={climate.dimensions.map((entry) => ({ key: entry.key, label: dimensionName(entry.key) }))}
                rows={climate.rows}
                target={climate.target}
                deadBandAt={climate.deadBandAt}
                extremeAt={climate.extremeAt}
                threshold={climate.threshold}
                decimals={1}
                size="large"
                onSelectCell={reference === null ? undefined : openCell}
                selection={selection}
              />

              {/* Per-group mean and "vs Q2", protected rows hatched exactly as the map hatches them. */}
              <div>
                <Table className="text-sm" data-testid="group-means">
                  <TableCaption className="sr-only">{t('surveyResults.next.groupMean')}</TableCaption>
                  <TableHeader>
                    <TableRow className="text-left text-xs uppercase tracking-wide text-fg-secondary">
                      <TableHead scope="col" className="py-1 pr-3 font-medium">
                        {t('surveyResults.next.groupHeading')}
                      </TableHead>
                      <TableHead scope="col" className="px-2 py-1 text-center font-medium">
                        {t('surveyResults.next.groupMean')}
                      </TableHead>
                      <TableHead scope="col" className="px-2 py-1 text-center font-medium">
                        {t('surveyResults.next.vsWave', { wave: sample.previousCode })}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id} data-testid={`group-row-${row.id}`}>
                        <TableHead scope="row" className="py-2 pr-3 text-left font-medium">
                          {row.name}
                        </TableHead>
                        <TableCell className="px-2 py-2 text-center font-mono tabular-nums">
                          <ProtectedCell responses={row.isProtected ? 0 : row.responses} threshold={climate.threshold}>
                            {row.mean === null ? '—' : score(row.mean)}
                          </ProtectedCell>
                        </TableCell>
                        <TableCell className="px-2 py-2 text-center text-fg-secondary">
                          {row.isProtected ? '—' : t('surveyResults.next.noPrevious', { wave: sample.previousCode })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="max-w-prose text-xs text-fg-secondary">
                {t('surveyResults.next.deltaNote', { wave: sample.previousCode })}
              </p>
            </section>

            {detail && (
              <section aria-labelledby="results-next-cell" className={`${PANEL} flex flex-col gap-panel-gap`}>
                <div className="flex items-start justify-between gap-inline">
                  <div className="flex flex-col gap-1">
                    <p className="text-xs uppercase tracking-wide text-fg-secondary">
                      {t('surveyResults.next.cellHeading')}
                    </p>
                    <H2 id="results-next-cell">
                      {detail.rowName} · {dimensionName(detail.dimensionKey)}
                    </H2>
                    {detail.score !== null && reference !== null && (
                      <p className="text-sm text-fg-secondary">
                        {detail.score < reference
                          ? t('surveyResults.next.cellBelow', {
                              score: score(detail.score),
                              shortfall: score(reference - detail.score),
                            })
                          : t('surveyResults.next.cellAbove', {
                              score: score(detail.score),
                              excess: score(detail.score - reference),
                            })}
                      </p>
                    )}
                  </div>
                  <Button variant="outline" size="sm" aria-label={t('common.close')} onClick={() => setSelection(null)}>
                    <X aria-hidden="true" />
                  </Button>
                </div>

                <div className="grid gap-panel-gap xl:grid-cols-[2fr_1fr_1fr]">
                  <div className="flex flex-col gap-panel-gap">
                    {detail.questions.map((question) => (
                      <div key={question.questionId} className="flex flex-col gap-3">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="flex flex-wrap items-center gap-1 font-semibold">
                              {t('surveyResults.next.groupDistribution', {
                                dimension: dimensionName(detail.dimensionKey),
                                group: detail.rowName,
                              })}
                              {sampleChip}
                            </span>
                            <span className="font-mono tabular-nums">
                              {question.groupScore === null ? '—' : score(question.groupScore)}
                            </span>
                          </div>
                          <DistributionStrip points={sample.groupDistribution} />
                          <p className="text-xs text-fg-secondary">
                            {t('surveyResults.next.groupDistributionSub', { low: lowShare(sample.groupDistribution) })}
                          </p>
                        </div>
                        <div className="flex flex-col gap-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-semibold">{t('surveyResults.next.companyDistribution')}</span>
                            <span className="font-mono tabular-nums">{score(question.surveyScore)}</span>
                          </div>
                          <DistributionStrip points={question.surveyDistribution} />
                          <p className="text-xs text-fg-secondary">
                            {t('surveyResults.next.companyDistributionSub', {
                              responses: question.surveyAnswered,
                              low: lowShare(question.surveyDistribution),
                            })}
                          </p>
                          {question.text && <p className="text-sm text-fg-secondary">{question.text}</p>}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-col gap-2">
                    <p className="text-xs uppercase tracking-wide text-fg-secondary">
                      {t('surveyResults.next.othersHeading', { dimension: dimensionName(detail.dimensionKey) })}
                    </p>
                    <ul className="flex list-none flex-col gap-1 p-0 text-sm" data-testid="others-in-dimension">
                      {detail.others.map((other) => (
                        <li key={other.id} className="flex items-center justify-between gap-2" data-testid={`other-${other.id}`}>
                          <span>{other.name}</span>
                          <span className="font-mono tabular-nums">
                            <ProtectedCell responses={other.isProtected ? 0 : climate.threshold} threshold={climate.threshold}>
                              {other.score === null ? '—' : score(other.score)}
                            </ProtectedCell>
                          </span>
                        </li>
                      ))}
                    </ul>
                    {detail.others.some((other) => other.isProtected) && (
                      <p className="text-xs text-fg-secondary">
                        {t('surveyResults.next.othersProtected', {
                          groups: detail.others.filter((other) => other.isProtected).map((other) => other.name).join(', '),
                          floor: climate.threshold,
                        })}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <p className="text-xs uppercase tracking-wide text-fg-secondary">
                      {t('surveyResults.next.doingHeading')}
                    </p>
                    {detail.plan === undefined ? (
                      <p className="text-sm text-fg-secondary">{t('surveyResults.next.plansUnavailable')}</p>
                    ) : detail.plan === null ? (
                      <p className="text-sm text-fg-secondary">{t('surveyResults.next.doingNone')}</p>
                    ) : (
                      <p className="text-sm">
                        {t('surveyResults.next.doingPlan', { plan: detail.plan.name, date: shortDate(detail.plan.dueAt) })}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {detail.plan ? (
                        <Button variant="outline" size="sm" asChild>
                          <Link to={`/action-plans/${detail.plan.id}`}>{t('surveyResults.next.openPlan')}</Link>
                        </Button>
                      ) : (
                        capabilities.canCreateActionPlan &&
                        detail.plan === null && (
                          <Button variant="outline" size="sm" asChild>
                            <Link to="/action-plans/new">{t('surveyResults.next.createPlan')}</Link>
                          </Button>
                        )
                      )}
                    </div>
                    <p className="flex items-start gap-2 rounded-md border border-line-light p-3 text-xs text-fg-secondary">
                      <ShieldCheck aria-hidden="true" className="size-4 shrink-0" />
                      {t('surveyResults.next.openTextNote', { group: detail.rowName, floor: climate.threshold })}
                    </p>
                  </div>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * A 1–5 distribution as one stacked bar, low to high, darker toward the high end.
 * Built on `currentColor` so it takes the theme from its container rather than
 * naming a colour of its own.
 */
function DistributionStrip({ points }: { points: readonly ResultsDistributionPoint[] }) {
  const max = Math.max(1, ...points.map((point) => point.position))
  return (
    <div className="flex h-5 w-full overflow-hidden rounded-sm text-fg-secondary" role="img" aria-hidden="true">
      {points.map((point) => (
        <span
          key={point.position}
          className="flex items-center justify-center bg-current text-[10px] font-mono tabular-nums"
          style={{ width: `${point.percentage}%`, opacity: 0.25 + 0.7 * ((point.position - 1) / Math.max(1, max - 1)) }}
        >
          {point.percentage >= 12 && <span className="text-surface-panel">{Math.round(point.percentage)}</span>}
        </span>
      ))}
    </div>
  )
}
