import type { MySurveyListItem } from '../api/surveys'
import { useTranslation } from '../../../i18n'
import { Badge, EmptyState, Table } from '../../../components/ui'
import { typeLabel } from '../surveyVocabulary'
import { calendarDay } from '../../../lib/calendarDay'

interface MySurveyListProps {
  surveys: readonly MySurveyListItem[]
}

/**
 * The respondent's own list.
 *
 * Every column here comes from `MySurveyListItem`, which is deliberately narrower
 * than the admin projection: no company, no author, no response count, no settings
 * blob and no questions. An employee's inbox needs to know what to open and by when.
 * Reaching for `status` or `responseCount` would typecheck against
 * `SurveyListItem` and render `undefined` at runtime, which is the whole reason the
 * two shapes are separate types in the client.
 *
 * There is intentionally no row-level link: no survey respond page exists yet, and a
 * link to a route that does not resolve is worse for an employee than none. The page
 * says so once, above the table, rather than per row.
 */
export default function MySurveyList({ surveys }: MySurveyListProps) {
  const { t, locale } = useTranslation()

  if (surveys.length === 0) {
    return (
      <EmptyState
        fill
        title={t('surveys.noAssignedSurveys')}
        description={t('surveys.noAssignedSurveysDescription')}
      />
    )
  }

  return (
    <Table>
      <thead>
        <tr>
          <th>{t('surveys.surveyName')}</th>
          <th>{t('surveys.surveyType')}</th>
          <th>{t('surveys.questions')}</th>
          <th>{t('surveys.closesOn')}</th>
          <th>{t('surveys.howItIsAnswered')}</th>
        </tr>
      </thead>
      <tbody>
        {surveys.map((survey) => (
          <tr key={survey.id}>
            <td>
              <span className="grid gap-1">
                <span>{survey.title ?? t('surveys.untitled')}</span>
                {survey.description && (
                  <span className="text-sm text-fg-secondary">{survey.description}</span>
                )}
              </span>
            </td>
            <td>{typeLabel(t, survey.type)}</td>
            <td>{survey.questionCount}</td>
            <td>{calendarDay(Date.parse(survey.endDate), locale)}</td>
            <td>
              <span className="flex flex-wrap gap-inline">
                {/* Anonymity is the single fact a respondent most needs before they
                    answer honestly, so it is a column rather than a detail. */}
                <Badge variant="secondary">
                  {survey.anonymous ? t('surveys.anonymous') : t('surveys.identified')}
                </Badge>
                {survey.timeLimitMinutes !== null && (
                  <Badge variant="outline">
                    {t('surveys.timeLimitMinutes', { minutes: survey.timeLimitMinutes })}
                  </Badge>
                )}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
