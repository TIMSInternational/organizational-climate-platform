import { useMemo, useState } from 'react'
import { useTranslation } from '../../../i18n'
import { EmptyState } from '../../../components/ui'
import { formatMetric } from '../../../components/charts'
import type { SurveyQuestionResult } from '../api/surveyResults'
import QuestionDistributionRow from '../components/QuestionDistributionRow'
import QuestionResultCard from '../components/QuestionResultCard'
import {
  EMPTY_QUESTION_FILTER,
  distributionStripModel,
  filterQuestions,
  questionCategories,
  questionTypes,
  type QuestionFilter,
} from '../surveyResultsView'
import { UNCATEGORISED_DIMENSION, dimensionKeyOf } from '../surveyResultsMap'
import { CLIMATE_TARGET, questionBand, type TargetBand } from './derive'
import { tintOf } from './tint'

/** The artboard's `.label` over each filter, as the grid's column heads wear it. */
const FILTER_LABEL = 'flex flex-col gap-1 text-2xs font-bold uppercase tracking-label text-fg-label'
/** A compact control on the page's own line and surface, not the browser's default. */
const FILTER_SELECT =
  'h-8 rounded border border-line-default bg-surface-card px-2 text-sm font-normal normal-case tracking-normal text-fg-primary'

interface SurveyResultsQuestionsProps {
  questions: readonly SurveyQuestionResult[]
  /** Already-translated display text for a category key — the view's own lookup, so the chip and the filter agree. */
  dimensionName: (key: string) => string
}

/**
 * Every question of the survey, one row each, under the map — the complete,
 * accessible form of what the map and the opened cell show in part.
 *
 * ## Why it is here when the artboard ends at the opened cell
 *
 * The `SurveyResults` artboard stops at the drill-in, and for its Grupo Meridiano
 * survey — one scale question per dimension, no other type — the cell says everything
 * there is to say. A real survey does not have that shape: a dimension holds several
 * questions, and a multiple-choice, ranking or open-ended question never reaches the
 * map at all, because the server computes a mean for numeric scales only
 * (`surveyResultsMap.ts`, "why only scale questions enter the map"). Without this
 * section those questions would have no on-screen surface, only the questions CSV —
 * a loss the route swap must not make silently. The record is
 * `docs/decisions/survey-results-route-swap.md`; the ruling on whether the artboard
 * absorbs this section or drops it is Federico's, and until it lands the section stays.
 *
 * ## One baseline, one vocabulary
 *
 * Each question's chip reads the climate target (`questionBand`), in the grid's five
 * tints and its three words — "bajo / en / sobre la meta". The current page measured
 * the same chip against the mean of the question means ("Por encima / En la media / Por
 * debajo", `surveyQuestionStandings`); on one screen with one colour scale that was a
 * second baseline wearing the first one's colours, so this page does not use it.
 *
 * ## The filters are client side, over the payload the page already holds
 *
 * Every filtered view is a subset of an aggregation the server already floored, so no
 * combination can narrow the data below the floor, and no keystroke costs a request.
 * The header's questions CSV writes `questions`, never this list: nothing beside that
 * button says a download was narrowed by a select two screens below.
 *
 * The rows are the current page's own components, unchanged: `QuestionDistributionRow`
 * for a scale question (the drawn strip on the climate map's ramp) and
 * `QuestionResultCard` for everything the strip cannot paint honestly —
 * `distributionStripModel` returns `null` exactly where the server refused a mean.
 */
export default function SurveyResultsQuestions({ questions, dimensionName }: SurveyResultsQuestionsProps) {
  const { t, locale } = useTranslation()
  const [filter, setFilter] = useState<QuestionFilter>(EMPTY_QUESTION_FILTER)

  const categories = useMemo(() => questionCategories(questions), [questions])
  const types = useMemo(() => questionTypes(questions), [questions])
  const visible = useMemo(() => filterQuestions(questions, filter), [questions, filter])

  const shortLabel = (question: SurveyQuestionResult) => t('surveyResults.questionShort', { order: question.order })

  return (
    <section aria-labelledby="results-next-questions" className="flex flex-col gap-panel-gap">
      {/* The serif h2 every other section of the page wears. */}
      <h2 id="results-next-questions" className="mb-0 text-2xl">
        {t('surveyResults.questions')}
      </h2>
      <p className="m-0 max-w-prose text-sm text-fg-secondary">
        {t('surveyResults.next.questionsIntroTarget', {
          target: formatMetric(CLIMATE_TARGET, { kind: 'number', decimals: 1 }, locale),
        })}
      </p>
      <div className="flex flex-wrap items-end gap-inline">
        <label className={FILTER_LABEL}>
          {t('surveyResults.filterCategory')}
          <select
            className={FILTER_SELECT}
            value={filter.category}
            onChange={(event) => setFilter({ ...filter, category: event.target.value })}
          >
            <option value="">{t('surveyResults.allCategories')}</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {dimensionName(category)}
              </option>
            ))}
          </select>
        </label>
        <label className={FILTER_LABEL}>
          {t('surveyResults.filterType')}
          <select className={FILTER_SELECT} value={filter.type} onChange={(event) => setFilter({ ...filter, type: event.target.value })}>
            <option value="">{t('surveyResults.allTypes')}</option>
            {types.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title={t('surveyResults.noQuestionsMatch')}
          description={t('surveyResults.noQuestionsMatchDescription')}
        />
      ) : (
        <div className="grid gap-panel-gap" data-testid="question-list">
          {visible.map((question) => {
            const strip = distributionStripModel(question)
            const dimensionKey = dimensionKeyOf(question)
            return strip ? (
              <QuestionDistributionRow
                key={question.questionId}
                question={question}
                strip={strip}
                standings={null}
                chip={question.average === null ? undefined : <TargetChip band={questionBand(question.average)} />}
                shortLabel={shortLabel(question)}
                dimensionName={dimensionName(dimensionKey)}
                uncategorised={dimensionKey === UNCATEGORISED_DIMENSION}
              />
            ) : (
              <QuestionResultCard key={question.questionId} question={question} shortLabel={shortLabel(question)} />
            )
          })}
        </div>
      )}
    </section>
  )
}

/** One question's standing against the target, in the grid's words and tint. */
function TargetChip({ band }: { band: TargetBand }) {
  const { t } = useTranslation()
  const key =
    band === 'far-below' || band === 'below'
      ? 'surveyResults.next.legendBelow'
      : band === 'on'
        ? 'surveyResults.next.legendOn'
        : 'surveyResults.next.legendAbove'
  return (
    <span
      data-testid="question-standing"
      className="inline-flex h-5 items-center rounded px-2 text-xs font-semibold"
      style={tintOf(band)}
    >
      {t(key)}
    </span>
  )
}
