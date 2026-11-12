import type { ResultBands, ResultScale } from '../../../components/charts'
import { useMemo, useState } from 'react'
import { useTranslation } from '../../../i18n'
import { EmptyState, H2 } from '../../../components/ui'
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
import { UNCATEGORISED_DIMENSION, dimensionKeyOf, surveyQuestionStandings } from '../surveyResultsMap'

interface SurveyResultsQuestionsProps {
  questions: readonly SurveyQuestionResult[]
  /** Already-translated display text for a category key — the view's own lookup, so the chip and the filter agree. */
  dimensionName: (key: string) => string
  /** The company's result scale, which each 1–5 question's average is read on. */
  scale?: ResultScale
  /** The company's result bands: a 1–5 question's mean is named in its area (glyph + name). */
  bands?: ResultBands
}

/** The native select at the Input primitive's geometry: 36px, the control edge, 15px. */
const SELECT =
  'h-9 rounded-md border border-line-control bg-surface-input px-3 text-base text-fg-primary pointer-coarse:h-11 hover:border-line-hover'
/** The field label (ui/label): 13px semibold above its control. */
const FIELD = 'flex flex-col gap-1.5 text-sm font-semibold text-fg-primary'

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
export default function SurveyResultsQuestions({ questions, dimensionName, scale = 'mean', bands }: SurveyResultsQuestionsProps) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<QuestionFilter>(EMPTY_QUESTION_FILTER)

  const categories = useMemo(() => questionCategories(questions), [questions])
  const types = useMemo(() => questionTypes(questions), [questions])
  const visible = useMemo(() => filterQuestions(questions, filter), [questions, filter])
  const standings = useMemo(() => surveyQuestionStandings(questions), [questions])

  // `order` is the 0-based position the builder stores; a reader counts from 1 ("P1", not "P0").
  const shortLabel = (question: SurveyQuestionResult) => t('surveyResults.questionShort', { order: question.order + 1 })

  return (
    <section aria-labelledby="results-next-questions" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <H2 id="results-next-questions" className="mb-0 text-2xl">
          {t('surveyResults.questions')}
        </H2>
        <p className="m-0 max-w-measure text-sm text-fg-secondary">{t('surveyResults.questionsIntro')}</p>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <label className={FIELD}>
          {t('surveyResults.filterCategory')}
          <select
            className={SELECT}
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
        <label className={FIELD}>
          {t('surveyResults.filterType')}
          <select className={SELECT} value={filter.type} onChange={(event) => setFilter({ ...filter, type: event.target.value })}>
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
        <div className="grid gap-3" data-testid="question-list">
          {visible.map((question) => {
            const strip = distributionStripModel(question)
            const dimensionKey = dimensionKeyOf(question)
            return strip ? (
              <QuestionDistributionRow
                key={question.questionId}
                question={question}
                strip={strip}
                standings={standings}
                shortLabel={shortLabel(question)}
                dimensionName={dimensionName(dimensionKey)}
                uncategorised={dimensionKey === UNCATEGORISED_DIMENSION}
                scale={scale}
                bands={bands}
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
