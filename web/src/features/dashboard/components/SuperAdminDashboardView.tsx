import { useCallback } from 'react'
import { Building2, ClipboardList, MessageSquare, Users } from 'lucide-react'
import { getSuperAdminDashboard } from '../api/dashboard'
import { useDashboardData } from '../useDashboardData'
import DashboardState from './DashboardState'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { KPIDisplay, type Kpi } from '../../../components/charts'
import { EmptyState, H2, Table } from '../../../components/ui'

/**
 * The platform overview — every tenant, and the only dashboard that crosses tenant lines.
 *
 * There is no company filter and no company picker here on purpose: this is the one view
 * whose subject genuinely is "all of them". A SuperAdmin who has selected a company in the
 * header switcher gets the company dashboard instead — see `DashboardPage`.
 *
 * `GET /dashboard/super-admin` refuses every other role outright, so this component can
 * never be rendered with somebody else's data in it; there is nothing to hide client-side.
 */
export default function SuperAdminDashboardView() {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  // Stable, because `useDashboardData` depends on it — see the note there.
  const load = useCallback(() => getSuperAdminDashboard(baseUrl), [baseUrl])
  const { data, loading, failed, error, reload } = useDashboardData(load)

  const kpis: Kpi[] = [
    {
      id: 'companies',
      label: t('dashboard.totalCompanies'),
      value: data?.companyCount ?? 0,
      icon: Building2,
      action: { label: t('navigation.companies'), href: '/admin/companies' },
    },
    {
      id: 'users',
      label: t('dashboard.totalUsers'),
      value: data?.userCount ?? 0,
      icon: Users,
    },
    {
      id: 'activeUsers',
      label: t('dashboard.activeUsers'),
      value: data?.activeUserCount ?? 0,
      icon: Users,
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
  ]

  return (
    <div>
      <PageTopBar
        title={t('dashboard.superAdminTitle')}
        description={t('dashboard.superAdminDescription')}
      />

      <DashboardState loading={loading} failed={failed} error={error} onRetry={reload}>
        <KPIDisplay
          kpis={kpis}
          title={t('dashboard.overview')}
          columns={3}
          locale={locale}
        />

        <H2>{t('dashboard.companyPerformance')}</H2>
        {data && data.companies.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <th>{t('dashboard.companyName')}</th>
                <th>{t('navigation.users')}</th>
                <th>{t('dashboard.activeSurveys')}</th>
                <th>{t('dashboard.completedResponses')}</th>
                <th>{t('dashboard.added')}</th>
              </tr>
            </thead>
            <tbody>
              {data.companies.map((company) => (
                <tr key={company.id}>
                  <td>{company.name}</td>
                  <td>{company.userCount}</td>
                  <td>{company.activeSurveyCount}</td>
                  <td>{company.completedResponseCount}</td>
                  <td>{new Date(company.createdAt).toLocaleDateString(locale)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState
            title={t('dashboard.noCompaniesYet')}
            description={t('dashboard.startByAddingFirstCompany')}
          />
        )}
      </DashboardState>
    </div>
  )
}
