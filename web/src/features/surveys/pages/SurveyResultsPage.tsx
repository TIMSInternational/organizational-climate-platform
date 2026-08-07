import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { KPIDisplay, ParticipationTracker, type Kpi } from '../../../components/charts'
import {
  Button,
  EmptyState,
  H2,
  LoadingRegion,
  NetworkError,
  SkeletonText,
} from '../../../components/ui'
import { downloadTextFile } from '../../../lib/downloadTextFile'
import { getSurveyAnalytics, type SurveyAnalyticsResponse } from '../api/surveyResults'
import QuestionResultCard from '../components/QuestionResultCard'
import ResultsContentLanguageNotice from '../components/ResultsContentLanguageNotice'
import ResultsSuppressionNotice from '../components/ResultsSuppressionNotice'
import SegmentBreakdownPanel from '../components/SegmentBreakdownPanel'
import {
  EMPTY_QUESTION_FILTER,
  filterQuestions,
  questionCategories,
  questionTypes,
  type QuestionFilter,
} from '../surveyResultsView'
import {
  buildBreakdownCsv,
  buildQuestionResultsCsv,
  resultsFileName,
  type CsvLabels,
} from '../surveyResultsCsv'

/**
 * Where an administrator reads what a survey found.
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
 * ## Suppression is rendered, never resolved away
 *
 * Two floors reach this page and they are shown differently, because they mean different
 * things:
 *
 * - **The whole survey below `MinimumRespondents`.** `isSuppressed` is true, `questions`
 *   and `breakdowns` are empty, `summary` is populated. The page renders the
 *   participation counters — which identify nobody and are the number that tells an admin
 *   whether to keep chasing — plus an explanation, and no per-question section at all. An
 *   empty section next to "4 responses" would read as a bug and send someone looking for
 *   the raw data.
 * - **A segment below `MinimumSegmentRespondents`.** Handled in `SegmentBreakdownPanel`:
 *   the row stays, marked withheld, and never as a zero.
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

  const questionLabel = useCallback(
    (question: { order: number }) => t('surveyResults.questionShort', { order: question.order }),
    [t],
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
            <>
              <ResultsContentLanguageNotice
                language={payload.language}
                resolvedLocale={payload.resolvedLocale}
                fallbackFields={payload.fallbackFields}
              />

              <H2>{t('surveyResults.participation')}</H2>
              <KPIDisplay
                kpis={participationKpis(payload, t)}
                locale={locale}
                title={t('surveyResults.participation')}
              />
              {payload.summary.invitedCount !== null && (
                <ParticipationTracker
                  current={payload.summary.completedCount}
                  target={payload.summary.invitedCount}
                  locale={locale}
                  title={t('surveyResults.participation')}
                />
              )}

              {payload.isSuppressed ? (
                <ResultsSuppressionNotice
                  reason={payload.suppressionReason}
                  minimumGroupSize={payload.minimumGroupSize}
                />
              ) : (
                <>
                  <H2>{t('surveyResults.questions')}</H2>
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
                    <Button
                      onClick={() =>
                        downloadTextFile(
                          resultsFileName(payload, 'questions'),
                          'text/csv',
                          buildQuestionResultsCsv(visibleQuestions, csvLabels),
                        )
                      }
                    >
                      {t('surveyResults.exportQuestions')}
                    </Button>
                  </div>

                  {visibleQuestions.length === 0 ? (
                    <EmptyState
                      title={t('surveyResults.noQuestionsMatch')}
                      description={t('surveyResults.noQuestionsMatchDescription')}
                    />
                  ) : (
                    <div className="grid gap-panel-gap">
                      {visibleQuestions.map((question) => (
                        <QuestionResultCard
                          key={question.questionId}
                          question={question}
                          shortLabel={questionLabel(question)}
                        />
                      ))}
                    </div>
                  )}

                  <H2>{t('surveyResults.breakdowns')}</H2>
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
                        <Button
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
                      </div>

                      <SegmentBreakdownPanel
                        breakdown={activeBreakdown}
                        questions={questions}
                        completedCount={payload.summary.completedCount}
                        minimumGroupSize={payload.minimumGroupSize}
                        questionLabel={questionLabel}
                        selectedKey={selectedSegment}
                        onSelect={setSelectedSegment}
                      />
                    </>
                  )}
                </>
              )}
            </>
          )}
        </LoadingRegion>
      )}
    </div>
  )
}

/**
 * The headline counters.
 *
 * Returned even when the survey is below the disclosure floor: a response count
 * identifies nobody, and it is precisely the number that tells an admin whether to keep
 * chasing responses. `invitedCount` and `participationRate` are omitted rather than
 * zeroed when the survey carries no target audience — a participation rate with an
 * invented denominator is worse than no participation rate.
 */
function participationKpis(
  payload: SurveyAnalyticsResponse,
  t: (key: string, params?: Record<string, string | number>) => string,
): Kpi[] {
  const { summary } = payload
  const kpis: Kpi[] = [
    { id: 'responses', label: t('surveyResults.kpiResponses'), value: summary.responseCount },
    { id: 'completed', label: t('surveyResults.kpiCompleted'), value: summary.completedCount },
    {
      id: 'completionRate',
      label: t('surveyResults.kpiCompletionRate'),
      value: summary.completionRate,
      format: { kind: 'percentage' },
    },
  ]

  if (summary.invitedCount !== null) {
    kpis.unshift({
      id: 'invited',
      label: t('surveyResults.kpiInvited'),
      value: summary.invitedCount,
    })
  }
  if (summary.participationRate !== null) {
    kpis.push({
      id: 'participationRate',
      label: t('surveyResults.kpiParticipationRate'),
      value: summary.participationRate,
      format: { kind: 'percentage' },
    })
  }

  return kpis
}
