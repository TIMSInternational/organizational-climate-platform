import { useCallback } from 'react'
import { ClipboardList, MessageSquare, Network, Target, Users } from 'lucide-react'
import { getCompanyAdminDashboard } from '../api/dashboard'
import { useDashboardData } from '../useDashboardData'
import DashboardState from './DashboardState'
import DashboardSurveyTable from './DashboardSurveyTable'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { KPIDisplay, type Kpi } from '../../../components/charts'
import { EmptyState, H2, Table } from '../../../components/ui'

interface CompanyAdminDashboardViewProps {
  /**
   * Sent only for a SuperAdmin, who has no tenant of their own and must name one. For a
   * CompanyAdmin this is `undefined` and the **server** decides the scope from their claim
   * — sending an id from the client would be a scope the client chose, which is the shape
   * this endpoint refuses (a CompanyAdmin naming another tenant gets a 403).
   */
  companyId?: string
}

/**
 * One company's overview: its people, its surveys, its departments and its action plans.
 *
 * Reached by a CompanyAdmin always, and by a SuperAdmin who has picked a tenant in the
 * header switcher — see `DashboardPage`.
 */
export default function CompanyAdminDashboardView({ companyId }: CompanyAdminDashboardViewProps) {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  const load = useCallback(
    () => getCompanyAdminDashboard(baseUrl, { companyId, lang: locale }),
    [baseUrl, companyId, locale],
  )
  const { data, loading, failed, error, reload } = useDashboardData(load)

  const kpis: Kpi[] = [
    {
      id: 'employees',
      label: t('dashboard.totalEmployees'),
      value: data?.userCount ?? 0,
      icon: Users,
    },
    {
      id: 'departments',
      label: t('navigation.departments'),
      value: data?.departmentCount ?? 0,
      icon: Network,
      action: { label: t('navigation.departments'), href: '/departments' },
    },
    {
      id: 'activeSurveys',
      label: t('dashboard.activeSurveys'),
      value: data?.activeSurveyCount ?? 0,
      icon: ClipboardList,
      action: { label: t('navigation.surveys'), href: '/surveys' },
    },
    {
      id: 'completedResponses',
      label: t('dashboard.completedResponses'),
      value: data?.completedResponseCount ?? 0,
      icon: MessageSquare,
    },
    {
      id: 'openActionPlans',
      label: t('dashboard.openActionPlans'),
      value: data?.openActionPlanCount ?? 0,
      icon: Target,
      action: { label: t('navigation.actionPlans'), href: '/action-plans' },
    },
    {
      id: 'overdueActionPlans',
      label: t('dashboard.overdueActionPlans'),
      value: data?.overdueActionPlanCount ?? 0,
      // Up is bad. Without this the card paints a rising overdue count green, which is
      // the exact defect `higherIsBetter` exists for.
      higherIsBetter: false,
      icon: Target,
      action: { label: t('navigation.actionPlans'), href: '/action-plans' },
    },
  ]

  return (
    <div>
      <PageTopBar
        title={data?.companyName ?? t('dashboard.companyDashboard')}
        description={t('dashboard.organizationInsights')}
      />

      <DashboardState loading={loading} failed={failed} error={error} onRetry={reload}>
        <KPIDisplay kpis={kpis} title={t('dashboard.overview')} columns={3} locale={locale} />

        <H2>{t('dashboard.currentOngoingSurveys')}</H2>
        {/* Linked: this view's two roles are exactly the two `CanAdminister` admits, so
            `/surveys/{id}` resolves for them. The department view deliberately does not
            pass this — see the prop. */}
        <DashboardSurveyTable surveys={data?.ongoingSurveys ?? []} canOpenSurvey />

        <H2>{t('dashboard.departmentAnalytics')}</H2>
        {data && data.departments.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <th>{t('departments.name')}</th>
                <th>{t('dashboard.teamMembers')}</th>
                <th>{t('dashboard.completedResponses')}</th>
              </tr>
            </thead>
            <tbody>
              {data.departments.map((department) => (
                <tr key={department.id}>
                  <td>{department.name}</td>
                  <td>{department.memberCount}</td>
                  <td>{department.completedResponseCount}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState
            title={t('dashboard.noDepartmentsYet')}
            description={t('dashboard.organizeDepartments')}
          />
        )}
      </DashboardState>
    </div>
  )
}
