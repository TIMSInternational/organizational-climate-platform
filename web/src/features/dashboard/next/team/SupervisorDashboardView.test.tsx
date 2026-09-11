import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import SupervisorDashboardView from './SupervisorDashboardView'
import { composeSupervisorDashboard, type TrackingRead } from './compose'
import type { DepartmentAdminDashboard } from '../../api/dashboard'
import type { MySurveyListItem } from '../../../surveys/api/surveys'
import type { PlanAccion } from '../../../tracking/api/trackingApi'
import { TranslationProvider } from '../../../../i18n'
import { CompanyContextProvider } from '../../../../company-context'
import { setToken } from '../../../../auth/token'
import { tokenFor } from '../../../../test/jwtFixture'
import en from '../../../../i18n/en.json'

/**
 * The supervisor's Panel de Control — a proposal — drawn from a model composed the way the
 * hook composes it. Payloads shaped from Grupo Meridiano's supervisor on 11 Sep 2026
 * (`scripts/shot-fixtures/supervisor-meridiano.json`).
 */

const copy = en.dashboard.next.supervisor
const DEPARTMENT = '5bfdb04e-8847-4baa-89c8-d4411654a129'

function department(responseCount = 3): DepartmentAdminDashboard {
  return {
    departmentId: DEPARTMENT,
    departmentName: 'Ingeniería',
    companyId: 'c1',
    memberCount: 14,
    activeMemberCount: 14,
    activeSurveyCount: 1,
    completedResponseCount: 22,
    openActionPlanCount: 1,
    overdueActionPlanCount: 0,
    activeSurveys: [
      {
        id: 'q4',
        title: 'Encuesta de Clima Q4 (abierta)',
        status: 'active',
        startDate: '2026-09-03T02:03:39.148+00:00',
        endDate: '2026-10-10T02:03:39.148+00:00',
        responseCount,
      },
    ],
    climate: null,
  }
}

const plan: PlanAccion = {
  id: 'plan-2',
  planCode: 'PA-2026-00002',
  nodoExternalId: DEPARTMENT,
  liderExternalId: '',
  hallazgoExternalId: null,
  descripcionQue: 'Publicar el rol de fines de semana con dos semanas de antelación',
  metodologiaComo: 'Calendario compartido.',
  responsableEjecucionExternalId: 'someone-else',
  fechaCreacion: '2026-09-10',
  fechaCompromiso: '2026-09-15',
  porcentajeAvance: 0,
  estadoSemaforo: 'Verde',
  cicloEncuestaExternalId: null,
  fechaUltimaActualizacion: '2026-09-10',
  cumplido: false,
  involucradosExternalIds: ['someone-else', 'sofia'],
}

const owed: MySurveyListItem = {
  id: 'q4',
  title: 'Encuesta de Clima Q4 (abierta)',
  description: null,
  type: 'periodic',
  startDate: '2026-09-03T02:03:39.148+00:00',
  endDate: '2026-10-10T02:03:39.148+00:00',
  questionCount: 6,
  anonymous: false,
  timeLimitMinutes: null,
}

interface Options {
  responseCount?: number
  misTareas?: TrackingRead<PlanAccion[]>
  mySurveys?: MySurveyListItem[] | null
  /** Who is looking. A `leader` on the plan's nodo is the one reader the server lets record. */
  role?: string
}

function renderSupervisor({ responseCount = 3, misTareas = { status: 'ok', value: [plan] }, mySurveys = [owed], role = 'supervisor' }: Options = {}) {
  setToken(tokenFor({ sub: 'sofia', name: 'Sofía Vargas', role, companyId: 'c1', nodoId: DEPARTMENT }))
  // The one seam: the capability the page reads is the one the model is composed with.
  const mayRecord = (target: { nodoExternalId: string }) => role === 'leader' && target.nodoExternalId === DEPARTMENT
  const model = composeSupervisorDashboard({
    department: department(responseCount),
    mySurveys,
    misTareas,
    trackingOn: misTareas.status !== 'off',
    mayRecord,
    viewer: { personaExternalId: 'sofia', name: 'Sofía Vargas' },
    asOf: '2026-09-11T15:00:00.000Z',
  })
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/dashboard']}>
        <CompanyContextProvider>
          <SupervisorDashboardView model={model} />
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

function card(headingName: string): HTMLElement {
  const section = screen.getByRole('heading', { level: 2, name: headingName }).closest('section')
  if (!section) throw new Error(`no section around "${headingName}"`)
  return section
}

describe('SupervisorDashboardView', () => {
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('says it is a proposal, in the eyebrow and in a note, before anything else', () => {
    renderSupervisor()

    expect(screen.getByRole('heading', { level: 1, name: en.dashboard.next.title })).toBeTruthy()
    expect(screen.getByText(`${copy.proposal} · Ingeniería · ${en.users.supervisor}`)).toBeTruthy()
    const note = screen.getByRole('note')
    expect(note.textContent).toContain(copy.proposalLead)
    expect(note.textContent).toContain(copy.proposalBody.replace('{floor}', '5'))
  })

  /**
   * Three people have answered, of fourteen. The artboard hatches both boxes: "who has not"
   * is eleven, and eleven beside the team's fourteen gives the three back by subtraction.
   */
  it('hatches who answered under the floor, and who has not with it, printing neither', () => {
    renderSupervisor()

    const coverage = card(copy.coverageHeading)
    expect(within(coverage).getByRole('img', { name: copy.respondedHiddenLabel.replace('{floor}', '5') })).toBeTruthy()
    expect(within(coverage).getByRole('img', { name: copy.remainingHiddenLabel.replace('{floor}', '5') })).toBeTruthy()
    expect(coverage.textContent).not.toMatch(/(^|\D)(3|11)(\D|$)/)
    expect(within(coverage).getByText('14')).toBeTruthy()
    expect(within(coverage).getByText(/^Encuesta de Clima Q4 · closes Oct 10$/)).toBeTruthy()
  })

  it('prints both counts once the team passes the floor', () => {
    renderSupervisor({ responseCount: 9 })

    const coverage = card(copy.coverageHeading)
    expect(within(coverage).getByText('9', { selector: '[data-slot="coverage-responded"]' })).toBeTruthy()
    expect(within(coverage).getByText('5', { selector: '[data-slot="coverage-remaining"]' })).toBeTruthy()
    expect(within(coverage).queryByRole('img')).toBeNull()
  })

  /**
   * `PlanAccessHandler`: the responsable and the involucrados READ a plan; only the node's
   * leader (or an administrator) records its progress. So the plan she executes opens, and
   * offers no "Registrar avance" the service would refuse.
   */
  it('lists the plans she executes, each opening, with no Registrar avance', () => {
    renderSupervisor()

    const plans = card(copy.plansHeading)
    expect(within(plans).getByRole('heading', { level: 3, name: /Publicar el rol de fines de semana/ })).toBeTruthy()
    expect(within(plans).getByText('PA-2026-00002')).toBeTruthy()
    expect(within(plans).getByRole('link', { name: en.dashboard.next.openPlan }).getAttribute('href')).toBe('/tracking/planes/plan-2')
    expect(within(plans).queryByRole('link', { name: en.dashboard.next.logProgress })).toBeNull()
    expect(within(plans).getByText(copy.plansNext.replace('{days}', '4'))).toBeTruthy()
  })

  it('offers Registrar avance where the capability allows it — the seam, not the role name, decides', () => {
    renderSupervisor({ role: 'leader' })

    const plans = card(copy.plansHeading)
    expect(within(plans).getByRole('link', { name: en.dashboard.next.logProgress }).getAttribute('href')).toBe('/tracking/planes/plan-2')
  })

  it('lists her tasks soonest first: the plan she follows, then the survey she owes', () => {
    renderSupervisor()

    const tasks = card(copy.tasksHeading)
    expect(within(tasks).getByText(copy.tasksPendingMany.replace('{count}', '2'))).toBeTruthy()
    const rows = [...tasks.querySelectorAll<HTMLElement>('[data-slot="supervisor-task"]')]
    expect(rows.map((row) => row.dataset.kind)).toEqual(['follow-plan', 'answer-survey'])
    expect(rows[0]?.textContent).toContain(copy.taskFollow.replace('{code}', 'PA-2026-00002'))
    expect(rows[1]?.textContent).toContain(copy.taskAnswer.replace('{survey}', 'Encuesta de Clima Q4'))
  })

  it('offers no export, no reminder and no plan to create, and wears no sample chip', () => {
    renderSupervisor()

    expect(screen.queryByRole('button', { name: en.dashboard.next.export })).toBeNull()
    expect(screen.queryByRole('button', { name: en.dashboard.next.sendReminder })).toBeNull()
    expect(screen.queryByRole('link', { name: en.dashboard.next.sendReminder })).toBeNull()
    expect(screen.queryByText(en.dashboard.next.leader.createPlan)).toBeNull()
    expect(screen.queryByText(en.dashboard.next.sampleChip)).toBeNull()
  })

  it('says plan tracking is off where there is no tracking service, and keeps the surveys she owes', () => {
    renderSupervisor({ misTareas: { status: 'off' } })

    expect(within(card(copy.plansHeading)).getByText(copy.plansOff)).toBeTruthy()
    expect(within(card(copy.tasksHeading)).getByText(copy.tasksPendingOne)).toBeTruthy()
  })

  it('says the surveys she owes could not be read rather than claiming there are none', () => {
    renderSupervisor({ mySurveys: null })

    expect(within(card(copy.tasksHeading)).getByText(copy.tasksSurveysUnread)).toBeTruthy()
  })
})
