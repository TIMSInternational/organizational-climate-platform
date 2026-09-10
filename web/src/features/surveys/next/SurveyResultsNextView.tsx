import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, ChevronDown, Download, MoreHorizontal } from 'lucide-react'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { KpiTile, WordCloud, formatMetric, type ClimateMapSelection } from '../../../components/charts'
import {
  Button,
  Chip,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../components/ui'
import type { ViewerCapabilities } from '../../../auth/viewerCapabilities'
import { calendarDayLong } from '../../../lib/calendarDay'
import { cn } from '../../../lib/cn'
import { downloadBlobFile } from '../../../lib/downloadBlobFile'
import { downloadTextFile } from '../../../lib/downloadTextFile'
import { dimensionLabel } from '../dimensionLabel'
import {
  getSurveyResultsCsv,
  getSurveyResultsPdf,
  surveyResultsCsvFileName,
  surveyResultsPdfFileName,
} from '../api/surveyExport'
import { UNCATEGORISED_DIMENSION } from '../surveyResultsMap'
import { buildBreakdownCsv, buildQuestionResultsCsv, resultsFileName, type CsvLabels } from '../surveyResultsCsv'
import ResultsContentLanguageNotice from '../components/ResultsContentLanguageNotice'
import ResultsSuppressionNotice from '../components/ResultsSuppressionNotice'
import type { SurveyResultsNextModel } from './model'
import ResultsCellPanel from './ResultsCellPanel'
import ResultsClimateGrid from './ResultsClimateGrid'
import SurveyResultsQuestions from './SurveyResultsQuestions'
import {
  CLIMATE_TARGET,
  belowTarget,
  cellDetail,
  companyMean,
  companyScores,
  groupRows,
  hasOpenText,
  legibleGroups,
  openTextWords,
  whereToLookFirst,
  withheldWords,
  type ResultsFinding,
} from './derive'
import { tintOf } from './tint'

/** The id the open cell's `aria-controls` names. */
const PANEL_ID = 'results-next-cell-panel'
/** The artboard's `.card`: the card surface, the default hairline, 8px radius, a faint lift. */
const CARD = 'rounded-lg border border-line-default bg-surface-card shadow-sm'
/** Closed states the header says "cerró" for; anything else is still to close. */
const CLOSED_STATUSES = new Set(['closed', 'archived'])

interface SurveyResultsNextViewProps {
  model: SurveyResultsNextModel
  capabilities: ViewerCapabilities
  /** The API base, for the exports the browser cannot build. */
  baseUrl: string
  onError: (message: string) => void
}

/**
 * The redesigned survey results, after the `SurveyResults` artboard.
 *
 * Reads top to bottom the way the design does: four tiles, "where to look first",
 * the map as the hero — ONE grid with the whole company first and a mean and a delta
 * per group — then the opened cell with its question, the same dimension in the
 * other groups and the plan that covers the group. Every figure is measured against
 * the climate target `CLIMATE_TARGET` (3,7), the one the Panel de Control reads, never
 * against the survey's own mean.
 *
 * ## Why the opened cell always opens, and comes into view
 *
 * Measured on #468 against the tenant's real payload (the drill-in "never opened"):
 * `cellDetail` answered for every disclosed cell, so the panel was rendered — but (1)
 * "Ver la pregunta" TOGGLED, so on the finding that is already open (the lowest cell,
 * the one the page lands on, the first card a reader clicks) it closed the panel; and
 * (2) the panel sat under three stacked tables, below the fold, and nothing brought it
 * up — the cell outlined and the reader saw no panel. So a cell or a finding now only
 * ever *opens* its cell (the × closes it), the panel sits directly under the map, and
 * opening scrolls it into view; opened from a finding, focus moves to its heading.
 *
 * ## Three things the artboard did not draw and the page it replaced did
 *
 * Kept below the artboard's end, as `docs/decisions/survey-results-route-swap.md`
 * records: the content-language notice (first), the open-text themes, and every
 * question with its filters (`SurveyResultsQuestions`).
 *
 * ## The four-layer privacy rule, kept
 *
 * A withheld group never yields a number: (1) the grid hatches its row in every cell,
 * mean and delta included, (2) the "other groups" list hatches it, (3) `whereToLookFirst`
 * and `cellDetail` come from `surveyResultsMap.ts`, which produces nothing for a
 * withheld row, and (4) the exports are the page's builders over the same payload,
 * which the server already floored, or the server's own files.
 */
export default function SurveyResultsNextView({ model, capabilities, baseUrl, onError }: SurveyResultsNextViewProps) {
  const { t, locale } = useTranslation()
  // Opens on the lowest disclosed cell, as the artboard does: the reader lands on the
  // cell the findings name first, with its question already under the map.
  const [selection, setSelection] = useState<ClimateMapSelection | null>(() => {
    const first = whereToLookFirst(model)[0]
    return first ? { rowId: first.rowId, dimensionKey: first.dimensionKey } : null
  })
  // A new object per request, so asking for the cell that is already open still
  // brings it back into view.
  const [reveal, setReveal] = useState<{ focus: boolean } | null>(null)
  const [exporting, setExporting] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)

  const climate = model.climate
  const sample = model.sample
  const score = useCallback((value: number) => formatMetric(value, { kind: 'number', decimals: 1 }, locale), [locale])
  const signed = useCallback(
    (value: number, decimals: number) =>
      `${value > 0 ? '+' : ''}${formatMetric(value, { kind: 'number', decimals }, locale)}`,
    [locale],
  )
  const dimensionName = useCallback(
    (key: string) => (key === UNCATEGORISED_DIMENSION ? t('surveyResults.uncategorised') : dimensionLabel(key, t)),
    [t],
  )

  const rows = useMemo(() => groupRows(model), [model])
  const company = useMemo(() => ({ scores: companyScores(model), mean: companyMean(model) }), [model])
  const below = useMemo(() => belowTarget(model), [model])
  const groups = useMemo(() => legibleGroups(model), [model])
  const findings = useMemo(() => whereToLookFirst(model), [model])
  const detail = useMemo(() => (selection ? cellDetail(model, selection) : null), [model, selection])
  const openText = hasOpenText(model)
  const themes = useMemo(() => openTextWords(model), [model])
  const withheld = withheldWords(model)

  // Opening is idempotent: a cell or a finding only ever OPENS its cell. The × is
  // the one way to close it (see the module note on the toggle this replaced).
  const openCell = useCallback((rowId: string, dimensionKey: string, focus: boolean) => {
    setSelection({ rowId, dimensionKey })
    setReveal({ focus })
  }, [])

  useEffect(() => {
    if (!reveal) return
    // `?.`: the suite's DOM has no layout engine and no `scrollIntoView`.
    panelRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
    if (reveal.focus) headingRef.current?.focus({ preventScroll: true })
  }, [reveal])

  const download = useCallback(
    async (fetchFile: () => Promise<Blob>, fileName: string) => {
      setExporting(true)
      try {
        downloadBlobFile(fileName, await fetchFile())
      } catch (err) {
        onError(err instanceof Error ? err.message : t('errors.generic'))
      } finally {
        setExporting(false)
      }
    },
    [onError, t],
  )

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
  const target = score(CLIMATE_TARGET)
  const isClosed = CLOSED_STATUSES.has(model.status)
  // The closing day, off `GET /surveys/{id}`'s `endDate` — a calendar day, read in UTC.
  const closingDay = model.closesAt ? calendarDayLong(Date.parse(model.closesAt), locale) : null
  const lastResponse = model.summary.lastResponseAt
  const eyebrow = closingDay
    ? t(isClosed ? 'surveyResults.next.eyebrowClosedOn' : 'surveyResults.next.eyebrowClosesOn', { name, date: closingDay })
    : lastResponse
      ? t('surveyResults.next.eyebrowClosed', { name, date: calendarDayLong(Date.parse(lastResponse), locale) })
      : t('surveyResults.next.eyebrowOpen', { name })
  const sampleChip = sample.isSample ? <Chip tone="warning" label={t('dashboard.next.sampleChip')} /> : null
  const protectedGroups = rows.filter((row) => row.isProtected).map((row) => row.name)
  const completedPercent = Math.round(model.summary.completionRate)
  const deltaInk = (value: number) => (value >= 0 ? 'text-accent-green-ink' : 'text-accent-red-ink')

  return (
    <div>
      <PageTopBar
        title={t('surveyResults.next.title', { name })}
        eyebrow={eyebrow}
        description={t('surveyResults.next.descriptionWave', { wave: sample.previousCode })}
        breadcrumbs={[
          { label: t('surveys.title'), href: '/surveys' },
          { label: name, href: `/surveys/${model.surveyId}` },
          { label: t('surveys.results') },
        ]}
        // `!isSuppressed` alone gates the exports. The page admits a viewer through
        // `seesWholeCompany` (SurveyResultsNextPage.tsx), and `capabilitiesFor` derives
        // `canExport` from the same "admin with a company" shape
        // (viewerCapabilities.ts:163), so `canExport` is true for everyone who reaches
        // this line — a term no test could turn false, so it is not written here.
        // The suppression half is not cosmetic: below the whole-survey floor
        // `questions` and `breakdowns` arrive empty, and a download holding a header
        // row and nothing else invites the reader to conclude the data was lost.
        actions={
          !model.isSuppressed ? (
            <>
              <Button
                variant="primary"
                disabled={exporting}
                onClick={() =>
                  download(
                    () => getSurveyResultsPdf(baseUrl, model.surveyId, locale),
                    surveyResultsPdfFileName(model.surveyId),
                  )
                }
              >
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
                        // Every dimension the server returned, not only the map's: the
                        // reader cannot see from the header that a file was narrowed.
                        buildBreakdownCsv(model.breakdowns, csvLabels),
                      )
                    }
                  >
                    {t('surveyResults.exportBreakdown')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {/* "···": the rest of `surveyExport.ts` — the server's long-format CSV,
                  through the same authorized fetch + Blob as the PDF. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label={t('surveyResults.next.moreExports')}>
                    <MoreHorizontal aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    disabled={exporting}
                    onSelect={() =>
                      download(
                        () => getSurveyResultsCsv(baseUrl, model.surveyId, locale),
                        surveyResultsCsvFileName(model.surveyId),
                      )
                    }
                  >
                    {t('surveyResults.next.exportServerCsv')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-section">
        {/* Before any number: the reader is about to quote these questions, and a
            question they cannot read in their own language is one they may summarise
            wrongly. Renders nothing when the content is in the language asked for. */}
        <ResultsContentLanguageNotice
          language={model.language}
          resolvedLocale={model.resolvedLocale}
          fallbackFields={model.fallbackFields}
        />

        <section aria-labelledby="results-next-tiles" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <h2 id="results-next-tiles" className="sr-only">
            {t('surveyResults.next.tilesHeading')}
          </h2>
          <KpiTile
            label={t('surveyResults.next.climateLabelWave', { wave: model.code })}
            value={company.mean}
            format={{ kind: 'number', decimals: 2 }}
            locale={locale}
            unit={t('surveyResults.next.climateUnit', { target })}
            sub={
              company.mean !== null && (
                <span className="flex flex-wrap items-center gap-1.5" data-testid="climate-delta">
                  <span className={deltaInk(sample.averageDelta)}>
                    {t('surveyResults.next.climateVsWave', {
                      delta: signed(sample.averageDelta, 2),
                      wave: sample.previousCode,
                    })}
                    {sample.risesInARow >= 2 &&
                      ` · ${t('dashboard.next.risesInARow', { count: sample.risesInARow })}`}
                  </span>
                  {sampleChip}
                </span>
              )
            }
          />
          <KpiTile
            label={t('surveyResults.next.participationLabel')}
            value={model.summary.responseCount}
            locale={locale}
            unit={t('surveyResults.next.participationSub', { percent: completedPercent })}
            sub={
              <span className="text-fg-label">
                {[
                  closingDay &&
                    t(isClosed ? 'surveyResults.next.closedOn' : 'surveyResults.next.closesOn', { date: closingDay }),
                  model.summary.invitedCount === null
                    ? t('surveyResults.next.participationNoInvited')
                    : t('surveyResults.next.participationInvited', { invited: model.summary.invitedCount }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            }
          />
          <KpiTile
            label={t('surveyResults.next.groupsLabel')}
            value={groups.legible}
            locale={locale}
            unit={t('surveyResults.next.groupsSub', { total: groups.total })}
            sub={
              <span className="text-fg-label">
                {protectedGroups.length === 0
                  ? t('surveyResults.next.groupsAllReadable', { floor: model.minimumGroupSize })
                  : t('surveyResults.next.groupsProtected', {
                      groups: protectedGroups.join(', '),
                      floor: model.minimumGroupSize,
                    })}
              </span>
            }
          />
          <KpiTile
            label={t('surveyResults.next.belowTargetLabel')}
            value={climate ? below.length : null}
            locale={locale}
            unit={t('surveyResults.next.belowSub')}
            sub={
              below.length === 0 ? (
                <span className="text-fg-label">{t('surveyResults.next.belowTargetNone', { target })}</span>
              ) : (
                <span className="text-accent-red-ink" data-testid="below-target">
                  {below.map((entry) => `${dimensionName(entry.key)} ${score(entry.score)}`).join(' · ')}
                </span>
              )
            }
          />
        </section>

        {model.isSuppressed || !climate ? (
          <ResultsSuppressionNotice reason={null} minimumGroupSize={model.minimumGroupSize} />
        ) : (
          <>
            <section aria-labelledby="results-next-where" className="flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div className="flex items-baseline gap-2.5">
                  <h2 id="results-next-where" className="mb-0 text-2xl">
                    {t('surveyResults.next.whereHeading')}
                  </h2>
                  <span className="font-mono text-sm tabular-nums text-fg-label">{findings.length}</span>
                </div>
                {findings.length > 0 && (
                  <p className="m-0 text-sm text-fg-label">
                    {findings.length === 1
                      ? t('surveyResults.next.whereSubOne')
                      : findings.length === 2
                        ? t('surveyResults.next.whereSubTwo')
                        : t('surveyResults.next.whereSubThree')}
                  </p>
                )}
              </div>
              {findings.length === 0 ? (
                <p className="m-0 text-sm text-fg-secondary">{t('surveyResults.next.whereNoneTarget', { target })}</p>
              ) : (
                // Three across from `xl`; at 1024 three columns cut every name, so they stack.
                <ul className="m-0 grid list-none gap-3 p-0 xl:grid-cols-3" data-testid="findings">
                  {findings.map((finding) => (
                    <li
                      key={`${finding.rowId}:${finding.dimensionKey}`}
                      className={cn(CARD, 'flex min-w-0 flex-col gap-2 px-3.5 py-3')}
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className="flex h-7 w-11 shrink-0 items-center justify-center rounded font-mono text-sm tabular-nums"
                          style={tintOf(finding.band)}
                        >
                          {score(finding.score)}
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-base font-semibold text-fg-primary">
                            {finding.rowName} · {dimensionName(finding.dimensionKey)}
                          </span>
                          <span className="text-xs text-fg-label">{reasonOf(finding, t, score)}</span>
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        {finding.plan === undefined ? (
                          <span className="text-xs text-fg-label">{t('surveyResults.next.plansUnavailable')}</span>
                        ) : finding.plan === null ? (
                          <span className="text-xs text-fg-label">{t('surveyResults.next.planNone')}</span>
                        ) : (
                          // Plans carry a department, not a dimension: the plan covers
                          // the GROUP, and the sentence says no more than that.
                          <span className="inline-flex items-center gap-1 text-xs text-accent-green-ink">
                            <Check aria-hidden="true" className="size-3" />
                            {t('surveyResults.next.planCovers')}
                            {finding.plan.status === 'not_started' && ` · ${t('surveyResults.next.planNoProgress')}`}
                          </span>
                        )}
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto p-0 text-sm text-fg-secondary hover:text-fg-primary"
                          onClick={() => openCell(finding.rowId, finding.dimensionKey, true)}
                        >
                          {t('surveyResults.next.viewQuestion')}
                          <ArrowRight aria-hidden="true" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="results-next-map" className={cn(CARD, 'flex min-w-0 flex-col gap-3 px-5 pt-4 pb-4.5')}>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 id="results-next-map" className="mb-0 text-2xl">
                  {t('surveyResults.next.mapHeadingWave', { wave: model.code })}
                </h2>
                <p className="m-0 text-sm text-fg-label">
                  {climate.target === null
                    ? t('surveyResults.climateAllProtected', { minimum: climate.threshold })
                    : t('surveyResults.next.mapSubTarget', { target })}
                </p>
              </div>
              <ResultsClimateGrid
                dimensions={climate.dimensions.map((entry) => ({ key: entry.key, name: dimensionName(entry.key) }))}
                rows={rows}
                company={company}
                sample={sample}
                threshold={climate.threshold}
                selection={selection}
                panelId={PANEL_ID}
                onSelectCell={(rowId, dimensionKey) => openCell(rowId, dimensionKey, false)}
              />
              {/* The chip for the grid's one sample — the "Frente a Q2" deltas — on the
                  note that explains them. */}
              <p className="m-0 flex flex-wrap items-center gap-1.5 text-xs text-fg-label" data-testid="delta-note">
                {sampleChip}
                {t('surveyResults.next.deltaNote', { wave: sample.previousCode })}
              </p>
            </section>

            {detail && (
              <div ref={panelRef} className="scroll-mt-4">
                <ResultsCellPanel
                  id={PANEL_ID}
                  headingRef={headingRef}
                  detail={detail}
                  dimensionName={dimensionName}
                  code={model.code}
                  threshold={climate.threshold}
                  sample={sample}
                  capabilities={capabilities}
                  onClose={() => setSelection(null)}
                />
              </div>
            )}

            {/* Gated on the survey HAVING open-text questions, not on the themes being
                non-empty: a survey whose every word fell under the word floor keeps the
                section and says so — withheld rendered as absent is the familiar mistake. */}
            {openText && (
              <section aria-labelledby="results-next-themes" className={cn(CARD, 'flex flex-col gap-3 p-panel')}>
                <div className="flex flex-wrap items-baseline justify-between gap-inline">
                  <h2 id="results-next-themes" className="mb-0 text-2xl">
                    {t('surveyResults.themesTitle')}
                  </h2>
                  <p className="m-0 max-w-prose text-sm text-fg-secondary">{t('surveyResults.themesIntro')}</p>
                </div>
                {themes.length > 0 && (
                  <WordCloud data={themes} colorBy="category" title={t('surveyResults.themesChartTitle')} />
                )}
                {withheld > 0 && (
                  <p className="m-0 max-w-prose text-sm text-fg-secondary">
                    {t('surveyResults.wordsWithheld', { count: withheld })}
                  </p>
                )}
              </section>
            )}

            <SurveyResultsQuestions questions={model.questions} dimensionName={dimensionName} />
          </>
        )}
      </div>
    </div>
  )
}

type Translate = (key: string, params?: Record<string, string | number>) => string

/** The one-line reason under a finding's name — derived in `whereToLookFirst`, worded here. */
function reasonOf(finding: ResultsFinding, t: Translate, score: (value: number) => string): string {
  switch (finding.reason) {
    case 'lowest':
      return t('surveyResults.next.reasonLowest', { shortfall: score(finding.shortfall) })
    case 'second-same-group':
      return t('surveyResults.next.reasonSecond')
    case 'third-same-group':
      return t('surveyResults.next.reasonThird')
    case 'only-red-outside':
      return t('surveyResults.next.reasonOnlyRedOutside', { group: finding.outsideOf ?? '' })
    case 'lowest-outside':
      return t('surveyResults.next.reasonLowestOutside', { group: finding.outsideOf ?? '' })
    default:
      return t('surveyResults.next.reasonShortfall', { shortfall: score(finding.shortfall) })
  }
}
