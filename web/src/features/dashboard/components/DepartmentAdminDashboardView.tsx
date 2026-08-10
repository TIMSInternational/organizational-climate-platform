import { useCallback } from 'react'
import { ClipboardList, MessageSquare, Target, Users } from 'lucide-react'
import { getDepartmentAdminDashboard } from '../api/dashboard'
import { useDashboardData } from '../useDashboardData'
import DashboardState from './DashboardState'
import DashboardSurveyTable from './DashboardSurveyTable'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { KPIDisplay, type Kpi } from '../../../components/charts'
import { H2 } from '../../../components/ui'

/**
 * One department's overview, for the person who runs it.
 *
 * **No department id is sent.** A leader or supervisor's department comes from their own
 * user row on the server, not from this client and not from their token: people move teams,
 * and a token minted before a transfer would keep serving the old team's numbers until it
 * expired. Naming a department here would also be a scope the client chose — the server
 * refuses one that is not the caller's own.
 *
 * `leader` and `supervisor` both land here. This repo has no `department_admin` role; those
 * two are its department-scoped roles, and both run a team.
 */
export default function DepartmentAdminDashboardView() {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  const load = useCallback(
    () => getDepartmentAdminDashboard(baseUrl, { lang: locale }),
    [baseUrl, locale],
  )
  const { data, loading, failed, error, reload } = useDashboardData(load)

  const kpis: Kpi[] = [
    {
      id: 'members',
      label: t('dashboard.teamMembers'),
      value: data?.memberCount ?? 0,
      icon: Users,
    },
    {
      id: 'activeSurveys',
      label: t('dashboard.activeSurveys'),
      value: data?.activeSurveyCount ?? 0,
      icon: ClipboardList,
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
      higherIsBetter: false,
      icon: Target,
      action: { label: t('navigation.actionPlans'), href: '/action-plans' },
    },
  ]

  return (
    <div>
      <PageTopBar
        title={data?.departmentName ?? t('dashboard.departmentDashboard')}
        description={t('dashboard.departmentDashboardDescription')}
      />

      <DashboardState loading={loading} failed={failed} error={error} onRetry={reload}>
        <KPIDisplay kpis={kpis} title={t('dashboard.overview')} columns={3} locale={locale} />

        <H2>{t('dashboard.currentOngoingSurveys')}</H2>
        {/* No target column. `Survey.TargetAudienceCount` is one tenant-wide number the
            author typed in, with no per-department breakdown, so on this page it would sit
            directly beneath the department-scoped "Completed responses" KPI above and
            describe a different population. The responses column here IS
            department-scoped — the server counts this department's rows rather than
            reading the survey's denormalised company-wide tally. */}
        <DashboardSurveyTable surveys={data?.activeSurveys ?? []} showTarget={false} />
      </DashboardState>
    </div>
  )
}
