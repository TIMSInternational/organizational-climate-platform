import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import {
  ClimateMap,
  KpiTile,
  WordCloud,
  formatMetric,
  type ClimateMapSelection,
  type MetricFormat,
} from '../../../components/charts'
import {
  Button,
  EmptyState,
  H2,
  LoadingRegion,
  NetworkError,
  SkeletonText,
  Table,
} from '../../../components/ui'
import { cn } from '../../../lib/cn'
import { downloadBlobFile } from '../../../lib/downloadBlobFile'
import { downloadTextFile } from '../../../lib/downloadTextFile'
import { getSurveyResultsPdf, surveyResultsPdfFileName } from '../api/surveyExport'
import { getSurveyAnalytics, type SurveyAnalyticsResponse } from '../api/surveyResults'
import ClimateDetailPanel from '../components/ClimateDetailPanel'
import QuestionDistributionRow from '../components/QuestionDistributionRow'
import QuestionResultCard from '../components/QuestionResultCard'
import ResultsContentLanguageNotice from '../components/ResultsContentLanguageNotice'
import ResultsSuppressionNotice from '../components/ResultsSuppressionNotice'
import SegmentBreakdownPanel from '../components/SegmentBreakdownPanel'
import StandingChip from '../components/StandingChip'
import {
  EMPTY_QUESTION_FILTER,
  distributionStripModel,
  filterQuestions,
  isOpenEnded,
  questionCategories,
  questionTypes,
  type QuestionFilter,
} from '../surveyResultsView'
import {
  UNCATEGORISED_DIMENSION,
  buildClimateMap,
  climateDetail,
  climateFindings,
  dimensionKeyOf,
  openTextThemes,
  surveyDimensionStandings,
  surveyQuestionStandings,
  withheldWordCount,
} from '../surveyResultsMap'
import {
  buildBreakdownCsv,
  buildQuestionResultsCsv,
  resultsFileName,
  type CsvLabels,
} from '../surveyResultsCsv'

/**
 * One decimal, everywhere a score is printed on this page.
 *
 * `surveyResultsMap.ts` rounds every mean it produces to one decimal (`round1`),
 * so that is the precision of the data. `formatMetric`'s default — as many places
 * as the number needs, capped at one — put `4` and `3.8` in the same grid column,
 * and a column of readings that do not line up is not an instrument.
 */
const SCORE_DECIMALS = 1
const SCORE_FORMAT: MetricFormat = { kind: 'number', decimals: SCORE_DECIMALS }

/**
 * Where an administrator reads what a survey found.
 *
 * ## What the page answers, in the order it answers it
 *
 * The reader's question is "what is going on, and what do I do about it", and both
 * halves are answered before anything has to be scrolled:
 *
 * 1. **Participation.** A strip of four to six flat tiles — the count depends on
 *    whether the survey carries an invitation list, and the anonymity floor is
 *    always the last reading — with every reading in mono and tabular figures.
 *    They are the context for everything below, not the subject, which is why
 *    they are `KpiTile` and not the `KPIDisplay` card grid; see `KpiTile` on the
 *    distinction between the two.
 * 2. **The climate map**, beside the findings it produces. Score by group and by
 *    dimension against the survey's own average, diverging, with withheld groups
 *    hatched in place. The findings column names the worst cells in words and
 *    drills straight into the group each one came from — the reading and the thing
 *    to do about it, side by side.
 * 3. Then the detail, coarse to fine: dimension scores for the whole survey,
 *    open-text themes, the group breakdown, the per-question distributions.
 *
 * ## One request, not two
 *
 * `/surveys/{id}/analytics` returns the per-question half and the segment half of the
 * **same** `SurveyAggregate` in one round trip. Fetching `/results` and `/statistics`
 * separately would aggregate the same response set twice and, worse, could return two
 * payloads computed a moment apart — so the participation counter beside the
 * distributions could disagree with the one beside the breakdowns while both were
 * individually correct. That is the class of bug #121 restructured its whole backend to
 * make impossible; undoing it in the client would be an odd way to spend it.
 *
 * `/real-time-stats` is deliberately not used here. It is the poll endpoint, cheap
 * because it never touches `question_responses`, and this page is a page load that
 * renders per-question distributions — polling it would show a counter refreshing above
 * charts that never move.
 *
 * The same reasoning is why the climate map's target is derived from this payload
 * rather than fetched from the benchmark API: a second round trip for one number
 * would reintroduce exactly the two-aggregations-one-page problem above.
 * `surveyResultsMap.ts` documents what the target is instead.
 *
 * ## Suppression is rendered, never resolved away
 *
 * Three floors reach this page and they are shown differently, because they mean
 * different things:
 *
 * - **The whole survey below `MinimumRespondents`.** `isSuppressed` is true, `questions`
 *   and `breakdowns` are empty, `summary` is populated. The page renders the
 *   participation counters — which identify nobody and are the number that tells an admin
 *   whether to keep chasing — plus an explanation, and no per-question section at all. An
 *   empty section next to "4 responses" would read as a bug and send someone looking for
 *   the raw data.
 * - **A group below `MinimumSegmentRespondents`, in the map.** It keeps its row and
 *   every cell renders hatched and locked through `ProtectedCell`, which `ClimateMap`
 *   does itself. Never an empty row, which reads as missing data rather than as a
 *   guarantee being enforced, and never the response count behind it.
 * - **The same group, in the breakdown table.** Handled in `SegmentBreakdownPanel`:
 *   the row stays, marked withheld, and never as a zero.
 * - **Every group below that floor at once.** The section still renders: the same
 *   grid, every row protected, and copy saying that is what happened. Dropping the
 *   section would be the worst version of the mistake above — the breakdown table
 *   further down still lists those groups as withheld, so the page would be saying
 *   the groups exist in one place and that group-level climate was never measured
 *   in another. `buildClimateMap` returns a map with a `null` target for it.
 *
 * ## Filters and drill-down
 *
 * The question filters (category, type) and the breakdown dimension selector are client
 * side, over a payload the page already holds. That is not a shortcut: every filtered
 * view is a subset of an aggregation the server already suppressed, so no filter
 * combination can narrow the data below a floor the server enforced. Refetching per
 * filter would re-aggregate the whole response set for each keystroke *and* would need
 * the floor re-checked per request.
 *
 * ## `useCallback` on the loader
 *
 * The web lint budget is `--max-warnings 10` and it is exactly full, so a new
 * `exhaustive-deps` warning fails CI. `t` is stable per locale.
 */
export default function SurveyResultsPage() {
  const { t, locale } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  const [payload, setPayload] = useState<SurveyAnalyticsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [filter, setFilter] = useState<QuestionFilter>(EMPTY_QUESTION_FILTER)
  const [dimension, setDimension] = useState<string>('')
  const [selectedSegment, setSelectedSegment] = useState<string | null>(null)
  /** The cell, or the group, whose questions are open under the map. */
  const [climateSelection, setClimateSelection] = useState<ClimateMapSelection | null>(null)

  const reload = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      // The UI locale is a *request*. What comes back may be in the other language, and
      // `ResultsContentLanguageNotice` is what says so.
      setPayload(await getSurveyAnalytics(baseUrl, id, locale))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [baseUrl, id, locale, t])

  useEffect(() => {
    reload()
  }, [reload])

  // Memoised rather than written inline, and not for speed: `payload?.questions ?? []`
  // allocates a fresh array on every render when `payload` is null, which makes every
  // `useMemo` below it a no-op and costs an `exhaustive-deps` warning each. The lint
  // budget is `--max-warnings 10` and it is exactly full, so three warnings is a failing
  // build rather than a style note.
  const questions = useMemo(() => payload?.questions ?? [], [payload])
  const breakdowns = useMemo(() => payload?.breakdowns ?? [], [payload])

  const categories = useMemo(() => questionCategories(questions), [questions])
  const types = useMemo(() => questionTypes(questions), [questions])
  const visibleQuestions = useMemo(() => filterQuestions(questions, filter), [questions, filter])

  const activeBreakdown =
    breakdowns.find((candidate) => candidate.dimension === dimension) ?? breakdowns[0] ?? null

  // The one export that is not built in the browser (#122). The two CSVs above serialise
  // the payload this page already holds; a PDF cannot be, and there was no PDF at all
  // before #122. Failures land in the page's own error banner rather than in a silent
  // no-op, because a download button that does nothing reads as a broken build.
  const [exporting, setExporting] = useState(false)
  const downloadPdf = useCallback(async () => {
    if (!id) return
    setExporting(true)
    try {
      // The UI locale is a request, exactly as it is for the payload: the server renders
      // the document's chrome in the locale the reader is actually reading.
      downloadBlobFile(surveyResultsPdfFileName(id), await getSurveyResultsPdf(baseUrl, id, locale))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setExporting(false)
    }
  }, [baseUrl, id, locale, t])

  const questionLabel = useCallback(
    (question: { order: number }) => t('surveyResults.questionShort', { order: question.order }),
    [t],
  )

  // The sentinel `UNCATEGORISED_DIMENSION` is the one dimension key that is not
  // already display text: it is the empty string, deliberately, so it cannot
  // collide with a real category. Everything else is the author's own wording and
  // is not ours to translate.
  const dimensionName = useCallback(
    (key: string) => (key === UNCATEGORISED_DIMENSION ? t('surveyResults.uncategorised') : key),
    [t],
  )

  const segmentName = useCallback(
    (segment: { label: string | null; key: string }) => segment.label ?? segment.key,
    [],
  )

  const climate = useMemo(
    () =>
      activeBreakdown && payload
        ? buildClimateMap(activeBreakdown, questions, payload.minimumGroupSize, segmentName)
        : null,
    [activeBreakdown, questions, payload, segmentName],
  )
  const findings = useMemo(() => (climate ? climateFindings(climate) : []), [climate])
  // `null` whenever the selection no longer names a disclosed row of the current
  // map — a reload that changed the survey's shape, or a dimension switch that
  // slipped past the reset below. `climateDetail` decides that against the map's
  // own suppression predicate, so the panel and the grid cannot disagree.
  const detail = useMemo(
    () =>
      climate && activeBreakdown && climateSelection
        ? climateDetail(climate, activeBreakdown, questions, climateSelection)
        : null,
    [climate, activeBreakdown, questions, climateSelection],
  )
  const questionText = useCallback(
    (questionId: string) =>
      questions.find((question) => question.questionId === questionId)?.text ??
      t('surveyResults.untranslatedQuestion'),
    [questions, t],
  )
  // Clicking the open cell again closes it, which is what `aria-expanded` on the
  // cell has just told the reader the control does.
  const openCell = useCallback((rowId: string, dimensionKey: string) => {
    setClimateSelection((current) =>
      current && current.rowId === rowId && current.dimensionKey === dimensionKey
        ? null
        : { rowId, dimensionKey },
    )
  }, [])
  const openRow = useCallback((rowId: string) => {
    setClimateSelection((current) =>
      current && current.rowId === rowId && current.dimensionKey === null
        ? null
        : { rowId, dimensionKey: null },
    )
  }, [])
  const standings = useMemo(() => surveyDimensionStandings(questions), [questions])
  const questionStandings = useMemo(() => surveyQuestionStandings(questions), [questions])
  const themes = useMemo(() => openTextThemes(questions), [questions])
  const withheldWords = useMemo(() => withheldWordCount(questions), [questions])
  const hasOpenText = useMemo(() => questions.some(isOpenEnded), [questions])
  const tiles = payload ? participationTiles(payload, t) : []

  // Where a findings click lands the reader. The finding drills into the group's
  // breakdown row — highlight and detail both key off `selectedSegment` — and the
  // scroll is what makes the drill-down visible when the breakdown sits a screen
  // below the findings column.
  const breakdownRef = useRef<HTMLElement | null>(null)
  const openFinding = useCallback((rowId: string) => {
    setSelectedSegment(rowId)
    // Guarded: happy-dom implements scrollIntoView as a no-op, and an older
    // engine without it should degrade to "state changed, no scroll".
    breakdownRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }, [])

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

  if (!id) {
    return <p role="alert">{t('errors.notFound')}</p>
  }

  const heading = payload?.title ?? t('surveyResults.untitled')

  return (
    <div>
      <PageTopBar
        title={heading}
        description={t('surveyResults.description')}
        // `/surveys` and `/surveys/:id` are #109's routes, landing in the same wave.
        // Pointing at them rather than inventing a parent here is what keeps this page
        // reachable from the survey it belongs to; until #109 merges the two upward
        // links have nowhere to go, which is a merge-order artefact and not a design.
        breadcrumbs={[
          { label: t('surveys.title'), href: '/surveys' },
          { label: heading, href: `/surveys/${id}` },
          { label: t('surveys.results') },
        ]}
        // Both exports act on the whole payload — every question and every
        // dimension — which is what lets them sit in the header's action slot
        // beside the title, the `ptb` shape the redesign uses everywhere. A
        // header control has nothing beside it to qualify its scope, so it must
        // not have one: the questions export deliberately writes `questions` and
        // not `visibleQuestions`, because the category and type selects that
        // produce `visibleQuestions` sit 2,180px below this button — measured in
        // Chromium at 1440 against scripts/shot-fixtures/survey-results.json —
        // and nothing up here says the download was narrowed by them. The
        // breakdown export writes `breakdowns`, every dimension, for the same
        // reason. They can only be built once the payload is here, hence the
        // guard rather than a disabled button.
        //
        // `!isSuppressed` as well, and that is not cosmetic: below the whole-survey
        // floor `questions` and `breakdowns` both arrive empty, so both buttons
        // would download a file holding a header row and nothing else. Offering a
        // download of nothing invites the reader to conclude the data was lost
        // rather than withheld — the same mistake as rendering an empty section,
        // which is why the section itself is not rendered either.
        actions={
          payload && !payload.isSuppressed ? (
            <>
              <Button
                variant="outline"
                onClick={() =>
                  downloadTextFile(
                    resultsFileName(payload, 'questions'),
                    'text/csv',
                    buildQuestionResultsCsv(questions, csvLabels),
                  )
                }
              >
                {t('surveyResults.exportQuestions')}
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  downloadTextFile(
                    resultsFileName(payload, 'breakdown'),
                    'text/csv',
                    buildBreakdownCsv(breakdowns, csvLabels),
                  )
                }
              >
                {t('surveyResults.exportBreakdown')}
              </Button>
              <Button variant="outline" disabled={exporting} onClick={downloadPdf}>
                {t('surveyResults.exportPdf')}
              </Button>
            </>
          ) : undefined
        }
      />

      {error ? (
        <NetworkError
          title={t('surveyResults.loadFailed')}
          description={error}
          onRetry={reload}
          retryText={t('common.retry')}
        />
      ) : (
        <LoadingRegion loading={loading} label={t('common.loading')}>
          {loading || !payload ? (
            <SkeletonText lines={6} />
          ) : (
            <div className="flex flex-col gap-section">
              <ResultsContentLanguageNotice
                language={payload.language}
                resolvedLocale={payload.resolvedLocale}
                fallbackFields={payload.fallbackFields}
              />

              <section aria-labelledby="results-participation" className="flex flex-col gap-panel-gap">
                {/* Every block below is a named `<section>`: an accessible name
                    turns each into a landmark a screen-reader user can jump
                    between, which on a page this long is the difference between
                    reading it and scrolling it. */}
                <H2 id="results-participation">{t('surveyResults.participation')}</H2>
                {/* Four across on a wide screen, two on a tablet, one on a phone.
                    The tiles hold a single mono reading each, so they stay
                    readable at any of the three. */}
                {/* The tile count is four, five or six depending on what the
                    survey carries — the anonymity-floor tile is always last —
                    and a row under the wrong column count leaves one tile
                    stranded on a second line. Chosen from the count rather
                    than left to wrap.

                    `ParticipationTracker` is deliberately not here. It prints
                    the completed count under the word "Responses", which on
                    this page is the label of a different number — 187 responses
                    of which 175 completed — so the two surfaces contradicted
                    each other in the screenshot. Its remaining figure,
                    outstanding invitations, is the Invited tile's sub-line. */}
                <div
                  className={cn(
                    'grid gap-panel-gap sm:grid-cols-2',
                    tiles.length === 6
                      ? 'xl:grid-cols-3'
                      : tiles.length === 5
                        ? 'xl:grid-cols-5'
                        : 'xl:grid-cols-4',
                  )}
                >
                  {tiles.map((tile) => (
                    <KpiTile
                      key={tile.id}
                      label={tile.label}
                      value={tile.value}
                      format={tile.format}
                      sub={tile.sub}
                      locale={locale}
                    />
                  ))}
                </div>
              </section>

              {payload.isSuppressed ? (
                <ResultsSuppressionNotice
                  reason={payload.suppressionReason}
                  minimumGroupSize={payload.minimumGroupSize}
                />
              ) : (
                <>
                  {climate && (
                    <section aria-labelledby="results-climate" className="flex flex-col gap-panel-gap">
                      <H2 id="results-climate">{t('surveyResults.climateTitle')}</H2>
                      {/* The map takes the full width and the findings sit under
                          it. It used to be a 2fr/1fr row, which is the right shape
                          for a summary standing beside its evidence — but the
                          evidence is now something you operate rather than only
                          read, and two thirds of a laptop was not enough of it:
                          at 1440 a six-dimension grid gave each column about 90px
                          and each cell a 28px band. Full width buys roughly half
                          as much again per column, which is what pays for the 44px
                          cells the drill-in needs. The findings lose nothing by
                          moving: they are three or four lines, and they now run
                          the width of the page instead of stacking in a column.
                          `min-w-0` stays on the panels because a flex item's
                          automatic minimum size is its content's min-content
                          width: without it the map's widest row pushed the panel
                          to 430px inside a 390px phone viewport, and `Table`'s
                          scroll container never got the chance to scroll.
                          Measured in Chromium at 390, 820, 1024, 1440 and 1920. */}
                      <div className="flex flex-col gap-panel-gap">
                        <div className="min-w-0 rounded-lg border border-line-light bg-surface-panel p-panel">
                          <p className="mb-panel-gap max-w-prose text-sm text-fg-secondary">
                            {climate.target === null
                              ? t('surveyResults.climateAllProtected', {
                                  minimum: climate.threshold,
                                })
                              : t('surveyResults.climateAgainstAverage', {
                                  target: formatMetric(
                                    climate.target,
                                    SCORE_FORMAT,
                                    locale,
                                  ),
                                })}
                          </p>
                          <ClimateMap
                            dimensions={climate.dimensions.map((entry) => ({
                              key: entry.key,
                              label: dimensionName(entry.key),
                            }))}
                            rows={climate.rows}
                            target={climate.target}
                            deadBandAt={climate.deadBandAt}
                            extremeAt={climate.extremeAt}
                            threshold={climate.threshold}
                            // Every score on this page is a one-decimal mean; see
                            // `round1` in `surveyResultsMap.ts`.
                            decimals={SCORE_DECIMALS}
                            // This map is the subject of its section rather than
                            // one reading among several, and its cells are targets
                            // — both of which say `large`.
                            size="large"
                            // Withheld when the floor took every group. Nothing on
                            // that grid can open, and handing it the handlers would
                            // put "and cannot be opened" in the legend beside cells
                            // whose neighbours cannot be opened either — implying a
                            // distinction the grid does not draw.
                            onSelectCell={climate.target === null ? undefined : openCell}
                            onSelectRow={climate.target === null ? undefined : openRow}
                            selection={climateSelection}
                          />
                          {climate.target !== null && (
                            <p className="mt-panel-gap max-w-prose text-sm text-fg-secondary">
                              {t('surveyResults.climateOpenHint')}
                            </p>
                          )}
                          {/* What the grid could not show, said rather than left
                              to be noticed. Both counts are about coverage, not
                              about privacy — the withheld groups are in the grid. */}
                          {climate.omittedDimensions.length > 0 && (
                            <p className="mt-panel-gap max-w-prose text-sm text-fg-secondary">
                              {t('surveyResults.climateDimensionsOmitted', {
                                count: climate.omittedDimensions.length,
                              })}
                            </p>
                          )}
                          {climate.omittedSegments.length > 0 && (
                            <p className="mt-panel-gap max-w-prose text-sm text-fg-secondary">
                              {t('surveyResults.climateGroupsOmitted', {
                                groups: climate.omittedSegments.join(', '),
                              })}
                            </p>
                          )}

                          {/* Inside the map's panel rather than after it: the
                              recessed surface reads as a drawer belonging to the
                              grid above, which is the relationship, and it keeps
                              the cell and its detail on one card. */}
                          {detail && (
                            <div className="mt-panel-gap">
                              <ClimateDetailPanel
                                detail={detail}
                                dimensionName={dimensionName}
                                questionText={questionText}
                                deadBandAt={climate.deadBandAt}
                                extremeAt={climate.extremeAt}
                                format={SCORE_FORMAT}
                                onClose={() => setClimateSelection(null)}
                              />
                            </div>
                          )}
                        </div>

                        <div className="min-w-0 rounded-lg border border-line-light bg-surface-panel p-panel">
                          <h3 className="mb-1 text-lg font-semibold leading-tight">
                            {t('surveyResults.findingsTitle')}
                          </h3>
                          <p className="mb-panel-gap text-sm text-fg-secondary">
                            {t('surveyResults.findingsIntro')}
                          </p>
                          {findings.length === 0 ? (
                            <p className="text-sm text-fg-secondary">
                              {/* Two different facts, and saying the wrong one
                                  would be a claim about the organisation: "no
                                  group is below average" is a finding, while
                                  "every group is protected" is the floor being
                                  enforced. */}
                              {t(
                                climate.target === null
                                  ? 'surveyResults.findingsAllProtected'
                                  : 'surveyResults.findingsNone',
                              )}
                            </p>
                          ) : (
                            <ul className="m-0 flex list-none flex-col gap-2 p-0">
                              {findings.map((finding) => (
                                <li key={`${finding.rowId}-${finding.dimensionKey}`}>
                                  {/* A button, not a link: it drills into the
                                      group inside this page, which is state the
                                      page already holds. */}
                                  {/* `h-auto` and `justify-start`, because
                                      index.css gives every bare `button` the
                                      32px control height and centres it: without
                                      these the three lines below overflow the
                                      box and print over the next finding.
                                      Measured in Chrome at 1440. */}
                                  <button
                                    type="button"
                                    className="flex h-auto w-full flex-col items-start justify-start gap-0.5 rounded-lg border border-line-light bg-surface-icon-box p-3 text-left hover:border-line-hover"
                                    onClick={() => openFinding(finding.rowId)}
                                  >
                                    <span className="text-sm font-semibold text-fg-primary">
                                      {t('surveyResults.findingHeadline', {
                                        group: finding.rowLabel,
                                        dimension: dimensionName(finding.dimensionKey),
                                      })}
                                    </span>
                                    <span className="text-xs text-fg-secondary">
                                      {/* Mono for the two readings, sans for the
                                          words around them. */}
                                      <span className="font-mono tabular-nums">
                                        {formatMetric(finding.score, SCORE_FORMAT, locale)}
                                      </span>
                                      {' — '}
                                      {t('surveyResults.findingShortfall', {
                                        shortfall: formatMetric(
                                          finding.shortfall,
                                          SCORE_FORMAT,
                                          locale,
                                        ),
                                      })}
                                    </span>
                                    <span className="text-xs text-fg-secondary">
                                      {t('surveyResults.findingAction')}
                                    </span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </section>
                  )}

                  {standings && (
                    <section aria-labelledby="results-dimensions" className="flex flex-col gap-panel-gap">
                      <H2 id="results-dimensions">{t('surveyResults.dimensionsTitle')}</H2>
                      <p className="m-0 max-w-prose text-sm text-fg-secondary">
                        {t('surveyResults.dimensionsIntro', {
                          overall: formatMetric(standings.overall, SCORE_FORMAT, locale),
                        })}
                      </p>
                      <Table className="text-sm">
                        <caption className="sr-only">
                          {t('surveyResults.dimensionsTableCaption')}
                        </caption>
                        <thead>
                          <tr>
                            <th scope="col">{t('surveyResults.dimensionColumn')}</th>
                            <th scope="col">{t('surveyResults.questionsColumn')}</th>
                            <th scope="col">{t('surveyResults.scoreColumn')}</th>
                            <th scope="col">{t('surveyResults.standingColumn')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {standings.rows.map((row) => (
                            <tr key={row.key}>
                              <th scope="row">{dimensionName(row.key)}</th>
                              <td className="font-mono tabular-nums">{row.questionCount}</td>
                              <td className="font-mono tabular-nums">
                                {formatMetric(row.score, SCORE_FORMAT, locale)}
                              </td>
                              <td>
                                <StandingChip
                                  score={row.score}
                                  target={standings.overall}
                                  deadBandAt={standings.deadBandAt}
                                  extremeAt={standings.extremeAt}
                                  label={t(
                                    row.score - standings.overall > standings.deadBandAt
                                      ? 'surveyResults.standingAbove'
                                      : row.score - standings.overall < -standings.deadBandAt
                                        ? 'surveyResults.standingBelow'
                                        : 'surveyResults.standingLevel',
                                  )}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </section>
                  )}

                  {/* Gated on the survey HAVING open-text questions, not on the
                      themes being non-empty (the prototype's note 08 read both
                      ways): a survey with no open-text question gets no section —
                      drawing one that would always be empty is designing fiction —
                      while a survey whose every word fell under the word floor
                      keeps its section, saying the words are withheld. Dropping
                      it there would be the familiar mistake: withheld rendered as
                      absent. */}
                  {hasOpenText && (
                    <section aria-labelledby="results-themes" className="flex flex-col gap-panel-gap">
                      <H2 id="results-themes">{t('surveyResults.themesTitle')}</H2>
                      <p className="m-0 max-w-prose text-sm text-fg-secondary">
                        {t('surveyResults.themesIntro')}
                      </p>
                      {themes.length > 0 && (
                        <WordCloud
                          data={themes}
                          colorBy="category"
                          title={t('surveyResults.themesChartTitle')}
                        />
                      )}
                      {withheldWords > 0 && (
                        <p className="m-0 max-w-prose text-sm text-fg-secondary">
                          {t('surveyResults.wordsWithheld', { count: withheldWords })}
                        </p>
                      )}
                    </section>
                  )}

                  <section
                    ref={breakdownRef}
                    aria-labelledby="results-breakdowns"
                    className="flex flex-col gap-panel-gap"
                  >
                    <H2 id="results-breakdowns">{t('surveyResults.breakdowns')}</H2>
                    {activeBreakdown === null ? (
                      <EmptyState
                        title={t('surveyResults.noSegments')}
                        description={t('surveyResults.noSegmentsDescription')}
                      />
                    ) : (
                      <>
                        <div className="flex flex-wrap items-end gap-inline">
                          <label>
                            {t('surveyResults.filterDimension')}
                            <select
                              value={activeBreakdown.dimension}
                              onChange={(event) => {
                                setDimension(event.target.value)
                                // A segment key is only meaningful inside its own
                                // dimension, so carrying the selection across would drill
                                // into a group that does not exist here.
                                setSelectedSegment(null)
                                // The map's open cell keys off the same segment id and
                                // is stale for the same reason.
                                setClimateSelection(null)
                              }}
                            >
                              {breakdowns.map((candidate) => (
                                <option key={candidate.dimension} value={candidate.dimension}>
                                  {candidate.dimension === 'department'
                                    ? t('surveyResults.dimensionDepartment')
                                    : candidate.dimension}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>

                        <SegmentBreakdownPanel
                          breakdown={activeBreakdown}
                          questions={questions}
                          minimumGroupSize={payload.minimumGroupSize}
                          questionLabel={questionLabel}
                          selectedKey={selectedSegment}
                          onSelect={setSelectedSegment}
                        />
                      </>
                    )}
                  </section>

                  <section aria-labelledby="results-questions" className="flex flex-col gap-panel-gap">
                    <H2 id="results-questions">{t('surveyResults.questions')}</H2>
                    {/* What the colour is, before the reader meets it: the strips
                        below read the climate map's own diverging ramp, and one
                        sentence is what makes that one encoding rather than a
                        coincidence of hues. */}
                    <p className="m-0 max-w-prose text-sm text-fg-secondary">
                      {t('surveyResults.questionsIntro')}
                    </p>
                    <div className="flex flex-wrap items-end gap-inline">
                      <label>
                        {t('surveyResults.filterCategory')}
                        <select
                          value={filter.category}
                          onChange={(event) =>
                            setFilter({ ...filter, category: event.target.value })
                          }
                        >
                          <option value="">{t('surveyResults.allCategories')}</option>
                          {categories.map((category) => (
                            <option key={category} value={category}>
                              {category}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        {t('surveyResults.filterType')}
                        <select
                          value={filter.type}
                          onChange={(event) => setFilter({ ...filter, type: event.target.value })}
                        >
                          <option value="">{t('surveyResults.allTypes')}</option>
                          {types.map((type) => (
                            <option key={type} value={type}>
                              {type}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    {visibleQuestions.length === 0 ? (
                      <EmptyState
                        title={t('surveyResults.noQuestionsMatch')}
                        description={t('surveyResults.noQuestionsMatchDescription')}
                      />
                    ) : (
                      <div className="grid gap-panel-gap">
                        {/* One row per scale question, the drawn DistributionStrip
                            form (decision 06) — six full BarCharts measured
                            4,652px for six Likert questions, colour meaning
                            nothing. Everything the strip cannot say honestly —
                            open text, rankings, choice sets whose codes are not
                            readings — keeps the full card: `distributionStripModel`
                            returns null exactly where the server refused a mean,
                            and painting those buckets red-to-blue would claim an
                            order nobody authored. */}
                        {visibleQuestions.map((question) => {
                          const strip = distributionStripModel(question)
                          return strip ? (
                            <QuestionDistributionRow
                              key={question.questionId}
                              question={question}
                              strip={strip}
                              standings={questionStandings}
                              shortLabel={questionLabel(question)}
                              dimensionName={dimensionName(dimensionKeyOf(question))}
                              uncategorised={dimensionKeyOf(question) === UNCATEGORISED_DIMENSION}
                            />
                          ) : (
                            <QuestionResultCard
                              key={question.questionId}
                              question={question}
                              shortLabel={questionLabel(question)}
                            />
                          )
                        })}
                      </div>
                    )}
                  </section>
                </>
              )}
            </div>
          )}
        </LoadingRegion>
      )}
    </div>
  )
}

interface ParticipationTile {
  id: string
  label: string
  value: number
  format?: MetricFormat
  sub?: string
}

/**
 * The headline counters.
 *
 * Returned even when the survey is below the disclosure floor: a response count
 * identifies nobody, and it is precisely the number that tells an admin whether to keep
 * chasing responses. `invitedCount` and `participationRate` are omitted rather than
 * zeroed when the survey carries no target audience — a participation rate with an
 * invented denominator is worse than no participation rate.
 *
 * The tiles carry a sub-line only where there is a real denominator to print.
 * `KpiTile`'s change indicator is deliberately unused: the payload holds no prior
 * period for this survey, and "no change" and "no comparison available" must not
 * look alike.
 */
function participationTiles(
  payload: SurveyAnalyticsResponse,
  t: (key: string, params?: Record<string, string | number>) => string,
): ParticipationTile[] {
  const { summary } = payload
  const tiles: ParticipationTile[] = [
    {
      id: 'responses',
      label: t('surveyResults.kpiResponses'),
      value: summary.responseCount,
      sub: t('surveyResults.kpiPartialSub', { count: summary.partialCount }),
    },
    {
      id: 'completed',
      label: t('surveyResults.kpiCompleted'),
      value: summary.completedCount,
    },
    {
      id: 'completionRate',
      label: t('surveyResults.kpiCompletionRate'),
      value: summary.completionRate,
      format: { kind: 'percentage' },
    },
  ]

  if (summary.invitedCount !== null) {
    tiles.unshift({
      id: 'invited',
      label: t('surveyResults.kpiInvited'),
      value: summary.invitedCount,
      // Clamped at zero rather than shown negative: `completedCount` counts
      // completed responses and `invitedCount` the invitation list, and a survey
      // reopened to people outside the original list can put the first above the
      // second. "-6 still to respond" is not a fact about anything.
      sub: t('surveyResults.kpiOutstandingSub', {
        count: Math.max(0, summary.invitedCount - summary.completedCount),
      }),
    })
  }
  if (summary.participationRate !== null) {
    tiles.push({
      id: 'participationRate',
      label: t('surveyResults.kpiParticipationRate'),
      value: summary.participationRate,
      format: { kind: 'percentage' },
    })
  }

  // The anonymity floor as a reading, stated once, on the page where it bites
  // (decision 04 of the admin round). It sits in the participation strip because
  // it is participation's counterpart: the counts above say who answered, this
  // says what happens to a group where too few did. The value is the server's
  // `minimumGroupSize` — the same number every ProtectedCell on this page
  // enforces — never a client-side constant that could disagree with a company
  // that raised its floor.
  tiles.push({
    id: 'anonymityFloor',
    label: t('surveyResults.kpiFloor'),
    value: payload.minimumGroupSize,
    sub: t('surveyResults.kpiFloorSub'),
  })

  return tiles
}
