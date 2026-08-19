import { X } from 'lucide-react'
import { useTranslation } from '../../../i18n'
import { formatMetric, type MetricFormat } from '../../../components/charts'
import { Button, H3, Table } from '../../../components/ui'
import StandingChip from './StandingChip'
import type { ClimateDetail } from '../surveyResultsMap'

/**
 * What one cell of the climate map is made of — the questions behind it.
 *
 * ## What this panel is for
 *
 * The map answers "which group is behind, and on what". The obvious next question
 * is "behind on *what exactly*", and until now the reader had to scroll to the
 * per-question section and hold a department in their head while reading figures
 * computed over everybody. This panel answers it in place: the questions inside
 * the opened dimension, each with the group's own mean beside the whole survey's.
 *
 * ## Every number here was already on the page
 *
 * `climateDetail` projects over the same `SurveyAnalyticsResponse` the map was
 * built from — `segments[].questions[]` carries a per-question mean for every
 * disclosed group, and the page has fetched it since #121. So opening a cell costs
 * **no request**, and cannot show a number that disagrees with the grid above it:
 * the dimension score printed here is the cell, produced by the same
 * `segmentDimensionScore` call.
 *
 * ## What a question is measured against, and why it is not the map's target
 *
 * The map's target is the mean of every group × dimension cell — the right
 * baseline for "is this group behind the organisation on this construct". A
 * *question* is compared instead against **the whole survey's mean for that same
 * question**, because questions are not equally easy: a question everybody scores
 * low on makes every group look behind against a cross-question target, and the
 * group that is genuinely unusual on it disappears into the pattern. Comparing
 * like with like is what makes a row here worth reading.
 *
 * `deadBandAt` and `extremeAt` are the map's, so a chip in this panel and a cell
 * in the grid mean the same thing by the same amount of colour.
 *
 * ## The floor never reaches this component
 *
 * There is no suppression grammar here, and that is deliberate rather than an
 * omission: a withheld group has no cell to open (`ClimateMap` does not make one a
 * button), `climateDetail` returns `null` for it against the map's own predicate,
 * and the server sent it `questions: []` in the first place. This panel renders
 * only what three layers above it have already agreed is disclosed. Adding a
 * "protected" state here would be inventing a fourth place for the rule to drift.
 */
export interface ClimateDetailPanelProps {
  detail: ClimateDetail
  /** Already-translated dimension name, resolved by the page. */
  dimensionName: (key: string) => string
  /** The question's own text, already resolved for the reader's locale. */
  questionText: (questionId: string) => string
  /** The map's bands, so a chip here matches a cell there. */
  deadBandAt: number
  extremeAt: number
  /** The decimals every score on this screen is printed to. */
  format: MetricFormat
  onClose: () => void
  /** Ties the panel back to the cell that opened it. */
  id?: string
}

export default function ClimateDetailPanel({
  detail,
  dimensionName,
  questionText,
  deadBandAt,
  extremeAt,
  format,
  onClose,
  id,
}: ClimateDetailPanelProps) {
  const { t, locale } = useTranslation()
  const wholeRow = detail.dimensionKey === null
  const score = (value: number) => formatMetric(value, format, locale)

  return (
    <section
      id={id}
      aria-label={t('surveyResults.climateDetailLabel', { group: detail.rowLabel })}
      className="rounded-lg border border-line-light bg-surface-icon-box p-panel"
    >
      <div className="mb-panel-gap flex items-start justify-between gap-3">
        <div className="min-w-0">
          <H3 className="mb-0">
            {wholeRow
              ? detail.rowLabel
              : t('surveyResults.climateDetailHeading', {
                  group: detail.rowLabel,
                  dimension: dimensionName(detail.dimensionKey as string),
                })}
          </H3>
          {/* States the baseline in words. A panel of numbers with no stated
              comparison is the failure the map's own caption exists to prevent. */}
          <p className="mb-0 mt-1 max-w-prose text-sm text-fg-secondary">
            {t('surveyResults.climateDetailAgainst')}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          <X aria-hidden="true" />
          {t('common.close')}
        </Button>
      </div>

      {detail.dimensions.map((dimension) => (
        <div key={dimension.key} className="mt-panel-gap first:mt-0">
          {/* The dimension's own name and score are a heading only when the whole
              row is open and there are several of them. With one dimension open
              the panel heading above already names it, and repeating it would be
              the same words twice in twenty pixels. */}
          {wholeRow && (
            <p className="mb-1 flex flex-wrap items-baseline gap-2 text-sm font-medium text-fg-primary">
              {dimensionName(dimension.key)}
              {dimension.score !== null && (
                <span className="font-mono tabular-nums text-fg-secondary">
                  {score(dimension.score)}
                </span>
              )}
            </p>
          )}

          <Table className="text-sm">
            <caption className="sr-only">
              {t('surveyResults.climateDetailCaption', {
                group: detail.rowLabel,
                dimension: dimensionName(dimension.key),
              })}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t('surveyResults.climateDetailQuestion')}</th>
                <th scope="col">{t('surveyResults.climateDetailGroupScore')}</th>
                <th scope="col">{t('surveyResults.climateDetailSurveyScore')}</th>
                <th scope="col">{t('surveyResults.climateDetailAnswers')}</th>
                <th scope="col">{t('surveyResults.standingColumn')}</th>
              </tr>
            </thead>
            <tbody>
              {dimension.questions.map((question) => (
                <tr key={question.questionId}>
                  <th scope="row" className="font-normal">
                    {questionText(question.questionId)}
                  </th>
                  {/* An em dash, not a zero. Nobody in this group answered this
                      question, which is the absence of a measurement — the same
                      distinction the map draws between a withheld cell and an
                      empty one, one level further in. */}
                  <td className="font-mono tabular-nums">
                    {question.score === null ? '—' : score(question.score)}
                  </td>
                  <td className="font-mono tabular-nums text-fg-secondary">
                    {score(question.surveyScore)}
                  </td>
                  <td className="font-mono tabular-nums text-fg-secondary">
                    {question.answeredCount}
                  </td>
                  <td>
                    {question.score === null ? (
                      // No score, so no standing. A chip here would colour a
                      // comparison that was never made.
                      <span className="text-fg-secondary">—</span>
                    ) : (
                      <StandingChip
                        score={question.score}
                        target={question.surveyScore}
                        deadBandAt={deadBandAt}
                        extremeAt={extremeAt}
                        label={t(
                          question.score - question.surveyScore > deadBandAt
                            ? 'surveyResults.standingAbove'
                            : question.score - question.surveyScore < -deadBandAt
                              ? 'surveyResults.standingBelow'
                              : 'surveyResults.standingLevel',
                        )}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      ))}
    </section>
  )
}
