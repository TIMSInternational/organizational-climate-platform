import { Link } from 'react-router'
import type { DashboardSurveySummary } from '../api/dashboard'
import { useTranslation } from '../../../i18n'
import { EmptyState, Table } from '../../../components/ui'
import { statusLabel } from '../../surveys/surveyVocabulary'

interface DashboardSurveyTableProps {
  surveys: readonly DashboardSurveySummary[]
  /**
   * Whether to link each row to the survey's admin detail page.
   *
   * **Off by default, and the default is the load-bearing part.** `GET /surveys/{id}` is
   * gated on `SurveyEndpoints.CanAdminister` — SuperAdmin, or a CompanyAdmin on their own
   * tenant — so a leader or supervisor following that link lands on a 403. This table is
   * shared by the company dashboard (whose viewer can administer) and the department
   * dashboard (whose viewer cannot), so linking unconditionally would put a guaranteed
   * dead end on one of the two pages that use it.
   */
  canOpenSurvey?: boolean
}

/**
 * The ongoing-surveys table, shared by the company and department dashboards.
 *
 * Shared because those two views show the *same* projection of the same rows — one scoped
 * to a tenant and one to a department — and the scoping happens on the server, not here.
 * Two copies would be two places for the response/target columns to disagree.
 *
 * Deliberately NOT shared with the employee dashboard: that one renders
 * `DashboardPendingSurvey`, which carries no response count, because telling a respondent
 * how many colleagues have already answered is the figure that turns an anonymous survey
 * into a headcount.
 */
export default function DashboardSurveyTable({
  surveys,
  canOpenSurvey = false,
}: DashboardSurveyTableProps) {
  const { t, locale } = useTranslation()

  if (surveys.length === 0) {
    return (
      <EmptyState
        title={t('dashboard.noOngoingSurveys')}
        description={t('dashboard.startGatheringInsights')}
      />
    )
  }

  return (
    <Table>
      <thead>
        <tr>
          <th>{t('surveys.surveyName')}</th>
          <th>{t('common.status')}</th>
          <th>{t('dashboard.responses')}</th>
          <th>{t('dashboard.target')}</th>
          <th>{t('surveys.closesOn')}</th>
        </tr>
      </thead>
      <tbody>
        {surveys.map((survey) => (
          <tr key={survey.id}>
            <td>
              {canOpenSurvey ? (
                <Link to={`/surveys/${survey.id}`}>{survey.title ?? t('surveys.untitled')}</Link>
              ) : (
                survey.title ?? t('surveys.untitled')
              )}
            </td>
            <td>{statusLabel(t, survey.status)}</td>
            <td>{survey.responseCount}</td>
            {/* An em dash, not "0": a survey with no invitation total has no target, and
                printing zero would read as "nobody was invited". */}
            <td>{survey.targetAudienceCount ?? '—'}</td>
            <td>{new Date(survey.endDate).toLocaleDateString(locale)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
