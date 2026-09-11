import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import TeamDashboardPage from './TeamDashboardPage'
import { TranslationProvider } from '../../../../i18n'
import { CompanyContextProvider } from '../../../../company-context'
import { setToken } from '../../../../auth/token'
import { tokenFor } from '../../../../test/jwtFixture'
import { NO_DEPARTMENT_MESSAGE, NO_USER_RECORD_MESSAGE, type DepartmentAdminDashboard } from '../../api/dashboard'
import en from '../../../../i18n/en.json'

/**
 * The page `/dashboard` hands a `leader` and a `supervisor`: which requests each role makes,
 * which view it draws, and what it draws when the department read says there is no team.
 * The fetch stub answers by URL, with a fresh `Response` per call.
 */

const DEPARTMENT = 'd-ing'
const TRACKING = 'http://tracking.test'

function department(): DepartmentAdminDashboard {
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
        startDate: '2026-09-03T02:03:39Z',
        endDate: '2026-10-10T02:03:39Z',
        responseCount: 3,
      },
    ],
    climate: null,
  }
}

type Route = { status?: number; body: unknown }

function serve(routes: Record<string, Route>): void {
  vi.mocked(fetch).mockImplementation((input) => {
    const url = String(input)
    const hit = Object.entries(routes).find(([fragment]) => url.includes(fragment))
    const { status = 200, body } = hit ? hit[1] : { status: 404, body: { message: 'no stub' } }
    return Promise.resolve(new Response(JSON.stringify(body), { status }))
  })
}

function requested(): string[] {
  return vi.mocked(fetch).mock.calls.map(([input]) => String(input))
}

function renderPage(role: 'leader' | 'supervisor', nodoId = DEPARTMENT) {
  setToken(tokenFor({ sub: 'me', name: 'Luis Mora', role, companyId: 'c1', nodoId }))
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/dashboard']}>
        <CompanyContextProvider>
          <TeamDashboardPage role={role} />
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

const board = { nodoExternalId: DEPARTMENT, conteos: { rojo: 0, amarillo: 0, verde: 0 }, planes: [] }

describe('TeamDashboardPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.stubEnv('VITE_TRACKING_API_BASE_URL', TRACKING)
  })

  afterEach(() => {
    cleanup()
    window.localStorage.clear()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it("draws a leader's panel from the department read and their own nodo's board, naming no department", async () => {
    serve({ '/dashboard/department-admin': { body: department() }, '/api/tablero-seguimiento': { body: board } })

    renderPage('leader')

    expect(await screen.findByRole('heading', { level: 2, name: en.dashboard.next.leader.whereHeading })).toBeTruthy()
    const urls = requested()
    const departmentRead = urls.find((url) => url.includes('/dashboard/department-admin'))
    expect(departmentRead).toBeDefined()
    expect(departmentRead).not.toContain('departmentId')
    const boardRead = urls.find((url) => url.includes('/api/tablero-seguimiento'))
    expect(boardRead?.startsWith(TRACKING)).toBe(true)
    expect(boardRead).not.toContain('nodoId')
    // One role dashboard endpoint, its own; no supervisor's reads.
    expect(urls.filter((url) => url.includes('/dashboard/'))).toHaveLength(1)
    expect(urls.some((url) => url.includes('/api/mis-tareas'))).toBe(false)
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('reads no board for a leader who leads no nodo', async () => {
    serve({ '/dashboard/department-admin': { body: department() } })

    renderPage('leader', 'unassigned-c1')

    expect(await screen.findByText(en.dashboard.next.leader.plansCountsOnly)).toBeTruthy()
    expect(requested().some((url) => url.includes('/api/tablero-seguimiento'))).toBe(false)
  })

  it("draws a supervisor's proposal from the department read, her own surveys and her own tasks — never the leader's board", async () => {
    serve({
      '/dashboard/department-admin': { body: department() },
      '/surveys/my': { body: { surveys: [] } },
      '/api/mis-tareas': { body: [] },
    })

    renderPage('supervisor')

    expect(await screen.findByRole('note')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: en.dashboard.next.supervisor.coverageHeading })).toBeTruthy()
    const urls = requested()
    expect(urls.some((url) => url.includes('/surveys/my'))).toBe(true)
    expect(urls.some((url) => url.includes('/api/mis-tareas'))).toBe(true)
    expect(urls.some((url) => url.includes('/api/tablero-seguimiento'))).toBe(false)
    expect(urls.filter((url) => url.includes('/dashboard/'))).toHaveLength(1)
    // Not the leader's panel.
    expect(screen.queryByRole('heading', { name: en.dashboard.next.leader.compareHeading })).toBeNull()
  })

  it.each(['leader', 'supervisor'] as const)(
    'sends a %s with no department to the employee Home, with a standing note saying why',
    async (role) => {
      serve({
        '/dashboard/department-admin': { status: 400, body: { message: NO_DEPARTMENT_MESSAGE } },
        '/dashboard/employee/last-outcome': { body: null },
        '/dashboard/employee': {
          body: {
            name: 'Luis Mora',
            companyId: 'c1',
            departmentId: null,
            departmentName: null,
            pendingSurveyCount: 0,
            completedSurveyCount: 0,
            unreadNotificationCount: 0,
            nextDeadline: null,
            pendingSurveys: [],
          },
        },
        '/surveys/my': { body: { surveys: [] } },
        '/api/': { body: [] },
      })

      renderPage(role)

      const notice = await screen.findByRole('status', { name: '' }).catch(() => null)
      const title = await screen.findByText(en.dashboard.noDepartmentTitle)
      expect(title.closest('[role="status"]') ?? notice).toBeTruthy()
      expect(screen.getByText(en.dashboard.noDepartmentBody)).toBeTruthy()
      expect(screen.queryByRole('alert')).toBeNull()
    },
  )

  it('says the one true thing when the token has no user record, and offers no retry', async () => {
    serve({ '/dashboard/department-admin': { status: 400, body: { message: NO_USER_RECORD_MESSAGE } } })

    renderPage('leader')

    expect(await screen.findByText(en.dashboard.noUserRecordTitle)).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.common.retry })).toBeNull()
  })

  it('shows the error band with a retry that asks again when the department read fails', async () => {
    serve({ '/dashboard/department-admin': { status: 500, body: { message: 'Database unavailable' } } })

    renderPage('leader')

    const retry = await screen.findByRole('button', { name: en.common.retry })
    const before = requested().filter((url) => url.includes('/dashboard/department-admin')).length
    serve({ '/dashboard/department-admin': { body: department() }, '/api/tablero-seguimiento': { body: board } })
    fireEvent.click(retry)
    expect(await screen.findByRole('heading', { level: 2, name: en.dashboard.next.leader.whereHeading })).toBeTruthy()
    await waitFor(() =>
      expect(requested().filter((url) => url.includes('/dashboard/department-admin')).length).toBeGreaterThan(before),
    )
  })
})
