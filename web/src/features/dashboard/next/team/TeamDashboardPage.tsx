import type { ReactNode } from 'react'
import { AlertTriangle, Info } from 'lucide-react'
import { useTranslation } from '../../../../i18n'
import { PageTopBar } from '../../../../components/layout'
import { Alert, AlertDescription, AlertTitle, LoadingRegion, SkeletonText } from '../../../../components/ui'
import DashboardState from '../../components/DashboardState'
import EmployeeHomeView from '../employee/EmployeeHomeView'
import LeaderDashboardView from './LeaderDashboardView'
import SupervisorDashboardView from './SupervisorDashboardView'
import { useLeaderDashboardModel, useSupervisorDashboardModel, type TeamDashboardState } from './useTeamDashboardModel'

/**
 * `/dashboard` for the two team roles — the redesigned leader and supervisor panels (the
 * canvas's LeaderDashboard and SupervisorDashboard, 10 Sep), which replaced
 * `DepartmentAdminDashboardView` on this route. `DashboardPage` dispatches here for
 * `leader` and `supervisor`, and this page picks the view: the supervisor's is a labelled
 * proposal, the leader's is not.
 *
 * One component per role rather than one with sections hidden, so each role's hook makes
 * only its own requests — the supervisor's page never asks for the leader's board, and the
 * leader's never asks for anyone's task list.
 *
 * The department read decides the frame, exactly as the old view decided it (it stays in
 * the tree as the wiring reference):
 *
 * - **No department** (`GET /dashboard/department-admin` answered "not assigned to a
 *   department", #138): the employee Home, with a standing note saying why — not a red
 *   panel over a Retry that could never succeed. `GET /dashboard/employee` reads no role
 *   claim, so it answers this person too, and a team lead with no team still has surveys
 *   of their own to answer.
 * - **No user record**: the one true sentence, in the reader's language, and no retry —
 *   the employee Home would resolve the same missing row and fail the same way.
 * - **Any other failure**: the shared error band, with a retry.
 */
export default function TeamDashboardPage({ role }: { role: 'leader' | 'supervisor' }) {
  return role === 'supervisor' ? <SupervisorDashboard /> : <LeaderDashboard />
}

function LeaderDashboard() {
  const state = useLeaderDashboardModel()
  return <TeamGate state={state} render={(model) => <LeaderDashboardView model={model} />} />
}

function SupervisorDashboard() {
  const state = useSupervisorDashboardModel()
  return <TeamGate state={state} render={(model) => <SupervisorDashboardView model={model} />} />
}

function TeamGate<M>({ state, render }: { state: TeamDashboardState<M>; render: (model: M) => ReactNode }) {
  const { t } = useTranslation()

  if (state.gate === 'no-department') {
    return (
      <EmployeeHomeView
        notice={
          // `variant="info"` and its default `role="status"`: having no team assigned is a
          // standing condition with a sentence, not an error to interrupt a reader with.
          <Alert variant="info">
            <Info aria-hidden="true" />
            <AlertTitle>{t('dashboard.noDepartmentTitle')}</AlertTitle>
            <AlertDescription>{t('dashboard.noDepartmentBody')}</AlertDescription>
          </Alert>
        }
      />
    )
  }

  if (state.gate === 'no-user-record') {
    return (
      <div>
        <PageTopBar title={t('dashboard.next.title')} />
        <Alert variant="warning">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>{t('dashboard.noUserRecordTitle')}</AlertTitle>
          <AlertDescription>{t('dashboard.noUserRecordBody')}</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (state.gate === 'failed') {
    return (
      <div>
        <PageTopBar title={t('dashboard.next.title')} />
        <DashboardState loading={false} failed error={state.error} onRetry={state.reload}>
          {null}
        </DashboardState>
      </div>
    )
  }

  if (state.model === null) {
    return (
      <div>
        <PageTopBar title={t('dashboard.next.title')} />
        <LoadingRegion loading label={t('dashboard.next.team.loading')}>
          <SkeletonText lines={4} />
        </LoadingRegion>
      </div>
    )
  }

  return <>{render(state.model)}</>
}
