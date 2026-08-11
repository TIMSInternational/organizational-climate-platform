import type { SurveyQuestion } from '../api/surveys'
import { useTranslation } from '../../../i18n'
import { Badge, EmptyState, Table } from '../../../components/ui'
import { questionTypeLabel } from '../surveyVocabulary'

interface SurveyQuestionListProps {
  questions: readonly SurveyQuestion[]
}

/**
 * The survey's structure, read-only.
 *
 * ## Options are shown as `label (value)`, on purpose
 *
 * `value` is the stable, locale-independent key that lands in
 * `question_responses.response_value` and that every later aggregation joins on;
 * `label` is display text resolved for the requested locale. On an *admin* screen
 * both matter — an admin comparing a survey against its duplicate, or against a
 * template it came from, needs to see that the values line up even when the labels
 * are in different languages. Showing only the label would hide the one property
 * that makes cross-survey aggregation work, and would make an option whose label
 * fell back to the other language look like a different option entirely.
 *
 * The respondent-facing form (#106) shows labels only; there, the value is machinery.
 */
export default function SurveyQuestionList({ questions }: SurveyQuestionListProps) {
  const { t } = useTranslation()

  if (questions.length === 0) {
    return (
      <EmptyState
        title={t('surveys.noQuestions')}
        description={t('surveys.noQuestionsDescription')}
      />
    )
  }

  return (
    <Table>
      <thead>
        <tr>
          <th>{t('common.order')}</th>
          <th>{t('surveys.questionText')}</th>
          <th>{t('surveys.questionType')}</th>
          <th>{t('surveys.answerOptions')}</th>
          <th>{t('surveys.required')}</th>
        </tr>
      </thead>
      <tbody>
        {questions.map((question) => (
          <tr key={question.id}>
            {/* A position is a reading, and every reading in this product is set in the
                mono face with tabular figures — which is also what keeps a column of
                them aligned once the list passes question 9. */}
            <td className="font-mono tabular-nums">{question.order + 1}</td>
            <td>{question.text ?? t('surveys.untranslatedQuestion')}</td>
            <td>{questionTypeLabel(t, question.type)}</td>
            <td>
              {question.options && question.options.length > 0 ? (
                <ul>
                  {question.options.map((option) => (
                    <li key={option.value}>
                      {t('surveys.optionLabelAndValue', {
                        label: option.label ?? t('surveys.untranslatedOption'),
                        value: option.value,
                      })}
                    </li>
                  ))}
                </ul>
              ) : question.scaleMin !== null && question.scaleMax !== null ? (
                t('surveys.scaleRange', { min: question.scaleMin, max: question.scaleMax })
              ) : (
                t('common.none')
              )}
            </td>
            <td>
              {question.required ? (
                <Badge variant="secondary">{t('surveys.required')}</Badge>
              ) : (
                <Badge variant="outline">{t('surveys.optional')}</Badge>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
