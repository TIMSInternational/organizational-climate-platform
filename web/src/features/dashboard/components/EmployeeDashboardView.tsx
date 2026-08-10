import { useCallback } from 'react'
import { Link } from 'react-router'
import { Bell, CheckCircle2, Inbox } from 'lucide-react'
import { getEmployeeDashboard } from '../api/dashboard'
import { useDashboardData } from '../useDashboardData'
import DashboardState from './DashboardState'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { KPIDisplay, type Kpi } from '../../../components/charts'
import { Alert, AlertDescription, Button, EmptyState, H2, Table } from '../../../components/ui'
import { typeLabel } from '../../surveys/surveyVocabulary'

/**
 * The evaluated user's dashboard — the landing experience for a plain employee, and the
 * thing #132 exists most to fix. Until now this role logged in and was sent to a list page.
 *
 * ## Scoped per user, not per role
 *
 * `GET /dashboard/employee` resolves the caller's **own** user row and reports on that row
 * alone; it reads no role claim. So this component is also what a leader or supervisor
 * would see of their own outstanding work — nothing on this payload describes anybody else,
 * which is why it needs no guard of its own.
 *
 * ## Why the pending list carries no response count
 *
 * `DashboardPendingSurvey` deliberately omits it, exactly as `/surveys/my` does. A
 * respondent told how many colleagues have already answered has been handed a headcount of
 * an anonymous survey.
 */
export default function EmployeeDashboardView() {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  const load = useCallback(() => getEmployeeDashboard(baseUrl, locale), [baseUrl, locale])
  const { data, loading, failed, error, reload } = useDashboardData(load)

  const kpis: Kpi[] = [
    {
      id: 'pending',
      label: t('dashboard.pendingSurveys'),
      value: data?.pendingSurveyCount ?? 0,
      // Up is bad: a pending survey is something still owed.
      higherIsBetter: false,
      icon: Inbox,
      action: { label: t('navigation.mySurveys'), href: '/surveys/my' },
    },
    {
      id: 'completed',
      label: t('dashboard.completedSurveys'),
      value: data?.completedSurveyCount ?? 0,
      icon: CheckCircle2,
    },
    {
      id: 'unread',
      label: t('dashboard.unreadNotifications'),
      value: data?.unreadNotificationCount ?? 0,
      higherIsBetter: false,
      icon: Bell,
      action: { label: t('notifications.title'), href: '/notifications' },
    },
  ]

  return (
    <div>
      <PageTopBar
        // The person's own name, when the server knows it. `dashboard.welcomeName` reads
        // as a greeting rather than a report heading, which is right for the one page in
        // this product addressed to an individual rather than to an administrator.
        title={data ? t('dashboard.welcomeName', { name: data.name }) : t('dashboard.myDashboard')}
        description={
          data?.departmentName
            ? t('dashboard.myDashboardInDepartment', { department: data.departmentName })
            : t('dashboard.myDashboardDescription')
        }
      />

      <DashboardState loading={loading} failed={failed} error={error} onRetry={reload}>
        <KPIDisplay kpis={kpis} title={t('dashboard.overview')} columns={3} locale={locale} />

        {data?.nextDeadline && (
          <Alert className="mb-panel-gap">
            <AlertDescription>
              {t('dashboard.nextDeadlineOn', {
                date: new Date(data.nextDeadline).toLocaleDateString(locale),
              })}
            </AlertDescription>
          </Alert>
        )}

        <H2>{t('dashboard.pendingSurveys')}</H2>
        {data && data.pendingSurveys.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <th>{t('surveys.surveyName')}</th>
                <th>{t('surveys.surveyType')}</th>
                <th>{t('surveys.questions')}</th>
                <th>{t('surveys.closesOn')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {data.pendingSurveys.map((survey) => (
                <tr key={survey.id}>
                  <td>{survey.title ?? t('surveys.untitled')}</td>
                  <td>{typeLabel(t, survey.type)}</td>
                  <td>{survey.questionCount}</td>
                  <td>{new Date(survey.endDate).toLocaleDateString(locale)}</td>
                  <td>
                    {/* A real destination: `/surveys/:id/respond` is registered and is
                        authorized per user by the respond endpoint itself. */}
                    <Button asChild size="sm">
                      <Link to={`/surveys/${survey.id}/respond`}>{t('dashboard.respondNow')}</Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState
            title={t('dashboard.noPendingSurveys')}
            description={t('dashboard.noPendingSurveysDescription')}
          />
        )}
      </DashboardState>
    </div>
  )
}
