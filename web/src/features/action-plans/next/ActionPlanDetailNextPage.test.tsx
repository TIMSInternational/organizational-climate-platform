import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { TranslationProvider } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../company-context'
import { clearCompanyNameCache } from '../../../company-context/useCompanyName'
import { tokenFor } from '../../../test/jwtFixture'
import {
  getActionPlan,
  listActionPlans,
  recordProgress,
  updateActionPlan,
  type ActionPlanDetail,
} from '../api/actionPlans'
import { listActionPlanTemplates } from '../api/actionPlanTemplates'
import { listDepartments } from '../../org-structure/api/departments'
import { getUser } from '../../org-structure/api/users'
import { listSurveys, type SurveyListItem } from '../../surveys/api/surveys'
import { getClimateTrends, type ClimateTrendsResponse } from '../../surveys/api/climateTrends'
import ActionPlanDetailNextPage from './ActionPlanDetailNextPage'
import es from '../../../i18n/es.json'

const copy = es.actionPlans.next

vi.mock('../api/actionPlans', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/actionPlans')>()),
  getActionPlan: vi.fn(),
  listActionPlans: vi.fn(),
  updateActionPlan: vi.fn(),
  recordProgress: vi.fn(),
}))
vi.mock('../api/actionPlanTemplates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/actionPlanTemplates')>()),
  listActionPlanTemplates: vi.fn(),
}))
vi.mock('../../org-structure/api/departments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../org-structure/api/departments')>()),
  listDepartments: vi.fn(),
}))
vi.mock('../../org-structure/api/users', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../org-structure/api/users')>()),
  getUser: vi.fn(),
}))
vi.mock('../../surveys/api/surveys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../surveys/api/surveys')>()),
  listSurveys: vi.fn(),
}))
vi.mock('../../surveys/api/climateTrends', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../surveys/api/climateTrends')>()),
  getClimateTrends: vi.fn(),
}))

const COMPANY = 'c1'
const OPS = 'ops'

/** The tenant's plan as `GET /action-plans/{id}` answered on 11 Sep, ids shortened. */
const plan: ActionPlanDetail = {
  id: 'p1',
  title: 'Reducir la carga de trabajo en Operaciones',
  description: 'Atiende el hallazgo del T3 en Operaciones.',
  companyId: COMPANY,
  departmentId: OPS,
  createdBy: 'u-ana',
  dueDate: '2026-10-15T02:05:50.278+00:00',
  status: 'not_started',
  priority: 'high',
  tags: ['clima', 'demo'],
  templateId: null,
  kpis: [],
  objectives: [],
  fallbackFields: [],
}

const q3: SurveyListItem = {
  id: 'q3',
  title: 'Encuesta de Clima Q3',
  companyId: COMPANY,
  type: 'periodic',
  status: 'closed',
  language: 'es',
  startDate: '2026-07-16T00:00:00Z',
  endDate: '2026-08-06T00:00:00Z',
  responseCount: 24,
  targetAudienceCount: 24,
  questionCount: 6,
  createdAt: '2026-07-01T00:00:00Z',
}

function trendsWith(ops: { respondentCount: number; isSuppressed: boolean; scores: (number | null)[] }): ClimateTrendsResponse {
  return {
    companyId: COMPANY,
    groupBy: 'department',
    surveys: [{ surveyId: 'q3', title: 'Encuesta de Clima Q3', status: 'closed', endDate: '2026-08-06T00:00:00Z', completedCount: 24, isSuppressed: false }],
    dimensions: [
      { key: 'trust', surveyCount: 1 },
      { key: 'workload', surveyCount: 1 },
    ],
    groups: [
      { key: OPS, label: 'Operaciones', points: [{ surveyId: 'q3', ...ops }] },
      { key: 'sales', label: 'Ventas', points: [{ surveyId: 'q3', respondentCount: 8, isSuppressed: false, scores: [3.6, 3.1] }] },
    ],
    suppressedGroupCount: 0,
    minimumGroupSize: 5,
    generatedAt: '2026-09-10T00:00:00Z',
  }
}

function renderAs(claims: Record<string, unknown>) {
  setToken(tokenFor({ sub: 'u-ana', nodoId: '', name: 'Ana Rojas', ...claims }))
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/action-plans/p1']}>
        <CompanyContextProvider>
          <Routes>
            <Route path="/action-plans/:id" element={<ActionPlanDetailNextPage />} />
          </Routes>
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

describe('ActionPlanDetailNextPage', () => {
  beforeEach(() => {
    // Local noon on 10 Sep: "today" is the 10th in every zone the suite can run in.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 10, 12, 0))
    window.localStorage.clear()
    window.localStorage.setItem('preferredLocale', 'es')
    vi.mocked(getActionPlan).mockReset().mockResolvedValue(plan)
    vi.mocked(listActionPlans)
      .mockReset()
      .mockResolvedValue([
        {
          id: 'p1',
          title: plan.title,
          companyId: COMPANY,
          departmentId: OPS,
          dueDate: plan.dueDate,
          status: 'not_started',
          priority: 'high',
          createdAt: '2026-09-10T02:05:50.280646+00:00',
        },
      ])
    vi.mocked(updateActionPlan).mockReset()
    vi.mocked(recordProgress).mockReset()
    vi.mocked(listActionPlanTemplates).mockReset().mockResolvedValue([])
    vi.mocked(listDepartments)
      .mockReset()
      .mockResolvedValue([
        { id: OPS, companyId: COMPANY, name: 'Operaciones', description: null, parentDepartmentId: null, isActive: true, employeeCount: 6 } as never,
      ])
    vi.mocked(getUser)
      .mockReset()
      .mockResolvedValue({ id: 'u-ana', name: 'Ana Rojas' } as never)
    vi.mocked(listSurveys).mockReset().mockResolvedValue([q3])
    vi.mocked(getClimateTrends)
      .mockReset()
      .mockResolvedValue(trendsWith({ respondentCount: 6, isSuppressed: false, scores: [3.2, 2.4] }))
  })

  afterEach(() => {
    cleanup()
    clearToken()
    clearCompanyNameCache()
    vi.useRealTimers()
    window.localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  })

  it('draws the board for the company administrator: the department eyebrow, the due date counted from today, the author', async () => {
    renderAs({ role: 'company_admin', companyId: COMPANY })
    expect(await screen.findByRole('heading', { level: 1, name: plan.title })).toBeTruthy()
    expect(await screen.findByText('Operaciones · Plan de acción')).toBeTruthy()
    expect(screen.getByText('Vence el 15 de octubre, en 35 días')).toBeTruthy()
    expect(screen.getByText('35')).toBeTruthy()
    expect(await screen.findByText('por Ana Rojas')).toBeTruthy()
    expect(screen.getByRole('button', { name: new RegExp(copy.recordProgress) })).toBeTruthy()
    expect(screen.getByRole('button', { name: new RegExp(copy.changeStatus) })).toBeTruthy()
  })

  it('draws the header’s actions at the canvas’s 34px', async () => {
    renderAs({ role: 'company_admin', companyId: COMPANY })
    const record = await screen.findByRole('button', { name: new RegExp(copy.recordProgress) })
    expect(record.className.split(' ')).toContain('h-control-canvas')
    expect(screen.getByRole('button', { name: new RegExp(copy.changeStatus) }).className.split(' ')).toContain('h-control-canvas')
    expect(screen.getByRole('button', { name: copy.moreActions.replace('{title}', 'Reducir la carga de trabajo en Operaciones') }).className.split(' ')).toContain('size-control-canvas')
  })

  it('never claims the plan has no progress: the server does not return it, and the Bitácora says so', async () => {
    renderAs({ role: 'company_admin', companyId: COMPANY })
    await screen.findByText(copy.log.entryOne)
    expect(screen.queryByText(/Sin avances registrados/)).toBeNull()
    expect(
      screen.getByText(
        (_, node) => node?.tagName === 'SPAN' && node.textContent === `${copy.log.noteBefore} ${copy.log.noteAction}${copy.log.noteAfter}`,
      ),
    ).toBeTruthy()
  })

  it('proposes the finding: the lowest cell of the plan’s department in the latest closed wave, below the target', async () => {
    renderAs({ role: 'company_admin', companyId: COMPANY })
    expect(await screen.findByText('Carga de trabajo')).toBeTruthy()
    expect(screen.getByText('2,4')).toBeTruthy()
    expect(screen.getByText(copy.finding.below)).toBeTruthy()
    expect(screen.getByText(/la celda más baja del mapa/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /Abrir en los resultados de la Q3/ }).getAttribute('href')).toBe('/surveys/q3/results')
    // The department map is the one the grouped read returns, scoped to the plan's company.
    expect(vi.mocked(getClimateTrends).mock.calls[0]?.[1]).toMatchObject({ groupBy: 'department', companyId: COMPANY })
  })

  it('prints no number for a department under the floor, even when the payload carries its scores', async () => {
    vi.mocked(getClimateTrends).mockResolvedValue(trendsWith({ respondentCount: 3, isSuppressed: false, scores: [3.2, 2.4] }))
    renderAs({ role: 'company_admin', companyId: COMPANY })
    expect(await screen.findByText(copy.finding.protected)).toBeTruthy()
    expect(screen.queryByText('2,4')).toBeNull()
    expect(screen.queryByText('Carga de trabajo')).toBeNull()
  })

  it('changes the status through the same PUT the old page sent', async () => {
    vi.mocked(updateActionPlan).mockResolvedValue({ ...plan, status: 'in_progress' })
    renderAs({ role: 'company_admin', companyId: COMPANY })
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(copy.changeStatus) }))
    const menu = await screen.findByRole('menu')
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: copy.status.inProgress }))
    // The base URL is the build's `VITE_API_BASE_URL`, unset under the suite: compare the rest.
    await waitFor(() => expect(vi.mocked(updateActionPlan).mock.calls[0]?.slice(1)).toEqual(['p1', { status: 'in_progress' }]))
    expect(await screen.findAllByText(copy.status.inProgress)).not.toHaveLength(0)
  })

  it('records progress from the dialog and lists the update in the Bitácora', async () => {
    vi.mocked(recordProgress).mockResolvedValue({ id: 'u1', updateDate: '2026-09-10T18:00:00Z', overallNotes: 'Se redistribuyó el turno de noche.', updatedBy: 'u-ana' })
    renderAs({ role: 'company_admin', companyId: COMPANY })
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(copy.recordProgress) }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByRole('textbox'), 'Se redistribuyó el turno de noche.')
    await userEvent.click(within(dialog).getByRole('button', { name: es.actionPlans.recordProgress }))
    await waitFor(() =>
      expect(vi.mocked(recordProgress).mock.calls[0]?.slice(1)).toEqual([
        'p1',
        { overallNotes: 'Se redistribuyó el turno de noche.', kpiUpdates: [], objectiveUpdates: [] },
      ]),
    )
    expect(await screen.findByText(copy.log.entries.replace('{count}', '2'))).toBeTruthy()
    expect(screen.getByText(copy.log.progress)).toBeTruthy()
  })

  it('offers a super administrator the actions with no company chosen: the plan names its own', async () => {
    renderAs({ role: 'super_admin' })
    expect(await screen.findByRole('button', { name: new RegExp(copy.recordProgress) })).toBeTruthy()
  })

  it('offers no action to an administrator of another company, whose PUT the server would refuse', async () => {
    renderAs({ role: 'company_admin', companyId: 'c2' })
    await screen.findByRole('heading', { level: 1, name: plan.title })
    expect(screen.queryByRole('button', { name: new RegExp(copy.recordProgress) })).toBeNull()
    expect(screen.queryByRole('button', { name: new RegExp(copy.changeStatus) })).toBeNull()
  })

  it('refuses a leader before any request is sent', async () => {
    renderAs({ role: 'leader', companyId: COMPANY })
    expect(await screen.findByText(es.actionPlans.accessRestricted)).toBeTruthy()
    expect(getActionPlan).not.toHaveBeenCalled()
  })
})
