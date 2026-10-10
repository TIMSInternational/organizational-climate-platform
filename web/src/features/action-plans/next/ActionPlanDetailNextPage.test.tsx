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
import { getUser, listUsers } from '../../org-structure/api/users'
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
  listUsers: vi.fn(),
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

/** Two closed waves, so a plan raised in the first can be measured against the second. */
function twoWaves({ q2, q3 }: { q2: (number | null)[]; q3: (number | null)[] | null }): ClimateTrendsResponse {
  const base = trendsWith({ respondentCount: 8, isSuppressed: false, scores: q2 })
  return {
    ...base,
    surveys: [
      { surveyId: 'q2', title: 'Encuesta de Clima Q2', status: 'closed', endDate: '2026-05-13T00:00:00Z', completedCount: 22, isSuppressed: false },
      { surveyId: 'q3', title: 'Encuesta de Clima Q3', status: 'closed', endDate: '2026-08-06T00:00:00Z', completedCount: 24, isSuppressed: false },
    ],
    groups: base.groups.map((group) => ({
      ...group,
      points:
        group.key === OPS
          ? [
              { surveyId: 'q2', respondentCount: 8, isSuppressed: false, scores: q2 },
              q3 === null
                ? { surveyId: 'q3', respondentCount: 0, isSuppressed: true, scores: [null, null] }
                : { surveyId: 'q3', respondentCount: 9, isSuppressed: false, scores: q3 },
            ]
          : [
              { surveyId: 'q2', respondentCount: 8, isSuppressed: false, scores: [3.6, 3.1] },
              { surveyId: 'q3', respondentCount: 8, isSuppressed: false, scores: [3.6, 3.1] },
            ],
    })),
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
    vi.mocked(listUsers)
      .mockReset()
      .mockResolvedValue([
        { id: 'u-ana', name: 'Ana Rojas' },
        { id: 'u-luis', name: 'Luis Mora' },
      ] as never)
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

  it('proposes the finding: the lowest cell of the plan’s department in the latest closed wave, in its result band', async () => {
    renderAs({ role: 'company_admin', companyId: COMPANY })
    expect(await screen.findByText('Carga de trabajo')).toBeTruthy()
    expect(screen.getByText('2,4')).toBeTruthy()
    // 2,4 is in the critical area of the company's bands, named in its chip — no "meta".
    expect(await screen.findByText(es.resultBands.name.critical)).toBeTruthy()
    expect(document.body.textContent).not.toContain('meta 3,7')
    expect(screen.getByText(/la celda más baja del mapa/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /Abrir en los resultados de la Q3/ }).getAttribute('href')).toBe('/surveys/q3/results')
    // The department map is the one the grouped read returns, scoped to the plan's company.
    expect(vi.mocked(getClimateTrends).mock.calls[0]?.[1]).toMatchObject({ groupBy: 'department', companyId: COMPANY })
  })

  /**
   * The chip's words are "the plan does not store its finding". Since #532 it does, and the
   * tenant's plan here records neither, so the chip is right for THIS plan and wrong for one
   * raised from a cell — which is the test below.
   */
  it('marks a hand-made plan’s finding as proposed, because the screen really did choose it', async () => {
    renderAs({ role: 'company_admin', companyId: COMPANY })
    expect(await screen.findByText('Carga de trabajo')).toBeTruthy()
    expect(screen.getByText(copy.proposed)).toBeTruthy()
  })

  /**
   * Measured on production, 2026-10-10: a plan titled "… — Carga de trabajo" showed
   * "Reconocimiento 2,6" as its origin, because the row tied at 2,6 and the screen took the
   * lowest rather than the cell the plan recorded. One card, two answers to "about what".
   */
  it('reads the cell the plan recorded rather than the lowest of its row, and drops the proposed chip', async () => {
    vi.mocked(getActionPlan).mockResolvedValue({
      ...plan,
      sourceSurveyId: 'q3',
      tags: ['seguimiento', `department:${OPS}`, 'dimension:trust'],
    })
    renderAs({ role: 'company_admin', companyId: COMPANY })
    // trust is 3,2 and workload 2,4: the row's lowest is workload, the plan's cell is trust.
    expect(await screen.findByText('Confianza')).toBeTruthy()
    expect(screen.getByText('3,2')).toBeTruthy()
    expect(screen.queryByText(copy.proposed)).toBeNull()
  })

  /**
   * O3. The plan knows the cell it was raised from and the later waves know what it reads
   * now; this is the line that joins them. Every number comes from the server's already
   * floored payload, so the protected case below has none to print.
   */
  it('says whether a later wave moved the plan’s own cell', async () => {
    vi.mocked(getActionPlan).mockResolvedValue({
      ...plan,
      sourceSurveyId: 'q2',
      tags: ['seguimiento', `department:${OPS}`, 'dimension:trust'],
    })
    vi.mocked(getClimateTrends).mockResolvedValue(twoWaves({ q2: [2.6, 2.4], q3: [3.1, 2.4] }))
    renderAs({ role: 'company_admin', companyId: COMPANY })
    expect(await screen.findByText(copy.finding.moveLabel)).toBeTruthy()
    expect(screen.getByText('Q2 2,6 → Q3 3,1')).toBeTruthy()
    expect(screen.getByText(/\+0,5/)).toBeTruthy()
  })

  it('withholds the move, and any number with it, when the later wave does not disclose the group', async () => {
    vi.mocked(getActionPlan).mockResolvedValue({
      ...plan,
      sourceSurveyId: 'q2',
      tags: ['seguimiento', `department:${OPS}`, 'dimension:trust'],
    })
    vi.mocked(getClimateTrends).mockResolvedValue(twoWaves({ q2: [2.6, 2.4], q3: null }))
    renderAs({ role: 'company_admin', companyId: COMPANY })
    expect(await screen.findByText(copy.finding.moveProtected.replace('{code}', 'Q2'))).toBeTruthy()
    expect(screen.queryByText(copy.finding.moveLabel)).toBeNull()
    // The Q2 baseline still prints; what is withheld is the later reading, and only it.
    expect(screen.getByText('2,6')).toBeTruthy()
    expect(screen.queryByText('3,1')).toBeNull()
  })

  it('says nothing has closed since, for a plan raised in the latest wave', async () => {
    vi.mocked(getActionPlan).mockResolvedValue({
      ...plan,
      sourceSurveyId: 'q3',
      tags: ['seguimiento', `department:${OPS}`, 'dimension:trust'],
    })
    vi.mocked(getClimateTrends).mockResolvedValue(twoWaves({ q2: [2.6, 2.4], q3: [3.1, 2.4] }))
    renderAs({ role: 'company_admin', companyId: COMPANY })
    expect(await screen.findByText(copy.finding.moveAwaiting.replace('{code}', 'Q3'))).toBeTruthy()
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

  /**
   * `ActionPlan` had no owner column until this change: every plan read "Sin asignar" and the
   * list's "SIN RESPONSABLE n de n" tile counted a field that did not exist.
   */
  it('hands the plan to somebody through the same PUT, and says so in the Ficha', async () => {
    vi.mocked(updateActionPlan).mockResolvedValue({ ...plan, ownerId: 'u-luis', ownerName: 'Luis Mora' })
    renderAs({ role: 'company_admin', companyId: COMPANY })
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(copy.moreActions.replace('{title}', '')) }))
    const menu = await screen.findByRole('menu')
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: 'Luis Mora' }))
    await waitFor(() => expect(vi.mocked(updateActionPlan).mock.calls[0]?.slice(1)).toEqual(['p1', { ownerId: 'u-luis' }]))
    expect(await screen.findByText('Luis Mora')).toBeTruthy()
  })

  /**
   * Taking the plan back has to travel as its own flag. An omitted `ownerId` means "not in
   * this request" to the server — the same thing `status: null` means — so sending undefined
   * here would silently do nothing where the reader asked to unassign.
   */
  it('takes the plan back with an explicit flag rather than an absent owner', async () => {
    vi.mocked(getActionPlan).mockResolvedValue({ ...plan, ownerId: 'u-ana', ownerName: 'Ana Rojas' })
    vi.mocked(updateActionPlan).mockResolvedValue({ ...plan, ownerId: null, ownerName: null })
    renderAs({ role: 'company_admin', companyId: COMPANY })
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(copy.moreActions.replace('{title}', '')) }))
    const menu = await screen.findByRole('menu')
    await userEvent.click(within(menu).getAllByRole('menuitemradio', { name: copy.unassigned })[0]!)
    await waitFor(() => expect(vi.mocked(updateActionPlan).mock.calls[0]?.slice(1)).toEqual(['p1', { clearOwner: true }]))
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
