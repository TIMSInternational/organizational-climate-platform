import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import DashboardPage from './DashboardPage'
import { TranslationProvider } from '../../../i18n'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../company-context'
import { setToken } from '../../../auth/token'
import type {
  CompanyAdminDashboard,
  DepartmentAdminDashboard,
  EmployeeDashboard,
  SuperAdminDashboard,
} from '../api/dashboard'

/** A well-formed unsigned JWT, so `readSessionClaims` reads the role rather than bailing. */
function tokenFor(role: string, companyId = 'c1'): string {
  return `header.${btoa(JSON.stringify({ role, companyId }))}.signature`
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

function superAdminPayload(): SuperAdminDashboard {
  return {
    companyCount: 3,
    userCount: 40,
    activeUserCount: 38,
    surveyCount: 9,
    activeSurveyCount: 4,
    responseCount: 120,
    completedResponseCount: 100,
    companies: [
      {
        id: 'c1',
        name: 'Acme Corporation',
        userCount: 12,
        activeSurveyCount: 2,
        completedResponseCount: 30,
        createdAt: '2026-01-15T00:00:00Z',
      },
    ],
  }
}

function companyPayload(): CompanyAdminDashboard {
  return {
    companyId: 'c1',
    companyName: 'Acme Corporation',
    userCount: 12,
    activeUserCount: 11,
    departmentCount: 2,
    surveyCount: 3,
    activeSurveyCount: 1,
    draftSurveyCount: 1,
    responseCount: 20,
    completedResponseCount: 18,
    openActionPlanCount: 2,
    overdueActionPlanCount: 1,
    ongoingSurveys: [
      {
        id: 's1',
        title: 'Company-wide pulse',
        status: 'active',
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-02-01T00:00:00Z',
        responseCount: 7,
        targetAudienceCount: 12,
      },
    ],
    departments: [{ id: 'd1', name: 'Engineering', memberCount: 6, completedResponseCount: 5 }],
  }
}

function departmentPayload(): DepartmentAdminDashboard {
  return {
    departmentId: 'd1',
    departmentName: 'Engineering',
    companyId: 'c1',
    memberCount: 6,
    activeMemberCount: 6,
    activeSurveyCount: 1,
    completedResponseCount: 5,
    openActionPlanCount: 2,
    overdueActionPlanCount: 1,
    // No `targetAudienceCount`, because the payload has none: see
    // `DashboardDepartmentSurveySummary`. `responseCount` here is THIS department's, and it
    // agrees with `completedResponseCount` above, which is the agreement the company-wide
    // column used to break.
    activeSurveys: [
      {
        id: 's1',
        title: 'Company-wide pulse',
        status: 'active',
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-02-01T00:00:00Z',
        responseCount: 5,
      },
    ],
  }
}

function employeePayload(overrides: Partial<EmployeeDashboard> = {}): EmployeeDashboard {
  return {
    name: 'Ana',
    companyId: 'c1',
    departmentId: 'd1',
    departmentName: 'Engineering',
    pendingSurveyCount: 1,
    completedSurveyCount: 3,
    unreadNotificationCount: 2,
    nextDeadline: '2026-02-01T00:00:00Z',
    pendingSurveys: [
      {
        id: 's1',
        title: 'Company-wide pulse',
        type: 'general_climate',
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-02-01T00:00:00Z',
        questionCount: 8,
      },
    ],
    ...overrides,
  }
}

function renderDashboard() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/dashboard']}>
        <CompanyContextProvider>
          <DashboardPage />
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

/** The path of the single request the page made. */
function requestedPath(): string {
  const [url] = vi.mocked(fetch).mock.calls[0] as [string]
  return url
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  /**
   * The acceptance criterion "each endpoint returns only that role's permitted data" is
   * enforced on the server and tested there. What THIS file has to prove is the other half:
   * that a role is sent to its own endpoint and not to somebody else's. A dispatch bug here
   * does not leak anything — the server would refuse — but it does hand every employee a
   * 403 on the page they now land on after login.
   */
  it('asks for the platform overview for a super_admin who has selected no company', async () => {
    setToken(tokenFor('super_admin', ''))
    vi.mocked(fetch).mockResolvedValue(jsonResponse(superAdminPayload()))

    renderDashboard()

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(requestedPath()).toContain('/dashboard/super-admin')
    expect(await screen.findByText('Acme Corporation')).toBeTruthy()
  })

  /**
   * #124's rule, applied to this page: a SuperAdmin's effective company is their explicit
   * selection and never their claim. Having made one, the tenant dashboard is the more
   * useful answer than the platform one — and `GET /dashboard/company-admin` accepts an
   * explicit companyId from this role for exactly that.
   */
  it('asks for the tenant dashboard once a super_admin has picked a company', async () => {
    setToken(tokenFor('super_admin', ''))
    window.localStorage.setItem(COMPANY_CONTEXT_STORAGE_KEY, 'c9')
    vi.mocked(fetch).mockResolvedValue(jsonResponse(companyPayload()))

    renderDashboard()

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(requestedPath()).toContain('/dashboard/company-admin?companyId=c9')
  })

  it('asks for the tenant dashboard for a company_admin, and sends no company id', async () => {
    // The absence is the point. A CompanyAdmin's scope is their claim, decided by the
    // server; a client that helpfully sent its own idea of the tenant would be choosing
    // a scope, which is the shape the endpoint refuses.
    setToken(tokenFor('company_admin', 'c1'))
    vi.mocked(fetch).mockResolvedValue(jsonResponse(companyPayload()))

    renderDashboard()

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(requestedPath()).toContain('/dashboard/company-admin')
    expect(requestedPath()).not.toContain('companyId')
    // The redesign moved the tenant's name off the `<h1>` and into the eyebrow above it:
    // the page is always "Dashboard", and what changes between two visits is which
    // company it is about. The assertion that the name reaches the screen at all is the
    // part that matters, and it is kept.
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeTruthy()
    expect(screen.getByText('Acme Corporation')).toBeTruthy()
  })

  it.each(['leader', 'supervisor'])(
    'asks for the department dashboard for a %s, and sends no department id',
    async (role) => {
      setToken(tokenFor(role, 'c1'))
      vi.mocked(fetch).mockResolvedValue(jsonResponse(departmentPayload()))

      renderDashboard()

      await waitFor(() => expect(fetch).toHaveBeenCalled())
      expect(requestedPath()).toContain('/dashboard/department-admin')
      expect(requestedPath()).not.toContain('departmentId')
      expect(await screen.findByRole('heading', { level: 1, name: 'Engineering' })).toBeTruthy()
    },
  )

  /**
   * `GET /surveys/{id}` is gated on `CanAdminister` — SuperAdmin or a CompanyAdmin on their
   * own tenant. A leader following a survey link from their dashboard would therefore land
   * on a 403, so the shared table only links when its viewer can administer. Asserted from
   * both sides, because the failure is invisible until somebody clicks.
   */
  it('does not link a department leader to a survey page their role is refused', async () => {
    setToken(tokenFor('leader', 'c1'))
    vi.mocked(fetch).mockResolvedValue(jsonResponse(departmentPayload()))

    renderDashboard()

    expect(await screen.findByText('Company-wide pulse')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Company-wide pulse' })).toBeNull()
  })

  /**
   * A department's page shows department figures, in the table as well as in the KPIs.
   *
   * `Survey.TargetAudienceCount` is the tenant's invited headcount and `Survey.ResponseCount`
   * is bumped once per completed response anywhere in the company, so both used to appear on
   * a six-person team's page as "Responses 140 / Target 200" beneath that team's own
   * "Completed responses 5". The server now sends a department-scoped count and no target at
   * all, and the table must not print a column for the figure it was not given.
   */
  it('shows a department leader no tenant-wide target column', async () => {
    setToken(tokenFor('leader', 'c1'))
    vi.mocked(fetch).mockResolvedValue(jsonResponse(departmentPayload()))

    renderDashboard()

    expect(await screen.findByText('Company-wide pulse')).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Responses' })).toBeTruthy()
    expect(screen.queryByRole('columnheader', { name: 'Target' })).toBeNull()
    // Every body row has one cell fewer than the header would need for a target.
    const headers = screen.getAllByRole('columnheader').length
    const cells = screen.getAllByRole('row')[1].querySelectorAll('td').length
    expect(cells).toBe(headers)
  })

  it('still shows the company dashboard both participation columns, which are its own scope', async () => {
    setToken(tokenFor('company_admin', 'c1'))
    vi.mocked(fetch).mockResolvedValue(jsonResponse(companyPayload()))

    renderDashboard()

    expect(await screen.findByRole('columnheader', { name: 'Target' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: '12' })).toBeTruthy()
  })

  it('does link a company_admin to the survey page, which their role can load', async () => {
    setToken(tokenFor('company_admin', 'c1'))
    vi.mocked(fetch).mockResolvedValue(jsonResponse(companyPayload()))

    renderDashboard()

    const link = await screen.findByRole('link', { name: 'Company-wide pulse' })
    expect(link.getAttribute('href')).toBe('/surveys/s1')
  })

  /* -------------------------------------------------------------------------
   * The redesigned company dashboard. Exercised through the page, because a test
   * that rendered the view directly would not prove the role that reaches it does.
   * ---------------------------------------------------------------------- */

  /**
   * The hero. `companyPayload` is 18 completed responses over 12 people (150 per 100) for
   * the tenant, and 5 over 6 (83) for Engineering — so the cell has to say *below*, not
   * merely paint a colour, and the target it names has to be the organisation's own rate
   * rather than a constant.
   */
  it('plots each department against the organisation on the climate map', async () => {
    setToken(tokenFor('company_admin', 'c1'))
    vi.mocked(fetch).mockResolvedValue(jsonResponse(companyPayload()))

    renderDashboard()

    expect(await screen.findByRole('rowheader', { name: 'Engineering' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: /83.*below the target of 150/ })).toBeTruthy()
  })

  /**
   * The suppression principle, both halves of it.
   *
   * Finance has 3 completed responses from 40 people — under the floor — so its cell is
   * drawn as protected rather than left empty, and neither its rate (8 per 100) nor the
   * count behind it may appear anywhere. It must also not be counted among the
   * departments below target: one hatched row plus a below-target count of two would tell
   * the reader that row's polarity, which is exactly what the hatch withholds.
   */
  it('draws a department under the anonymity floor as protected and keeps it out of the prose', async () => {
    setToken(tokenFor('company_admin', 'c1'))
    const payload = companyPayload()
    payload.departments = [
      ...payload.departments,
      { id: 'd2', name: 'Finance', memberCount: 40, completedResponseCount: 3 },
    ]
    vi.mocked(fetch).mockResolvedValue(jsonResponse(payload))

    renderDashboard()

    const cell = await screen.findByRole('img', { name: /Finance/ })
    expect(cell.getAttribute('aria-label')).toContain('protected')
    // Neither the withheld rate nor the count behind it.
    expect(cell.getAttribute('aria-label')).not.toContain('3')
    expect(screen.queryByText('8')).toBeNull()
    // Engineering alone is behind; Finance is not counted even though it is further back.
    expect(screen.getByText(/Engineering is behind the organisation/)).toBeTruthy()
    expect(screen.queryByText(/Finance is behind the organisation/)).toBeNull()
  })

  /** The finding, its evidence, and the two things to do about it. */
  it('names the department furthest behind, with its evidence and two actions', async () => {
    setToken(tokenFor('company_admin', 'c1'))
    vi.mocked(fetch).mockResolvedValue(jsonResponse(companyPayload()))

    renderDashboard()

    expect(await screen.findByText(/Engineering is behind the organisation/)).toBeTruthy()
    expect(
      screen.getByText(/5 of 6 people in Engineering have completed a survey/),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Create Action Plan' }).getAttribute('href')).toBe(
      '/action-plans',
    )
    expect(screen.getByRole('link', { name: 'View responses' }).getAttribute('href')).toBe(
      '/surveys',
    )
  })

  /**
   * The cleared state is rendered, not omitted. An empty panel where the finding goes
   * reads as "not measured", which is the opposite of what has happened.
   */
  it('says so when no department is behind the organisation', async () => {
    setToken(tokenFor('company_admin', 'c1'))
    const payload = companyPayload()
    payload.departments = [{ id: 'd1', name: 'Engineering', memberCount: 6, completedResponseCount: 9 }]
    vi.mocked(fetch).mockResolvedValue(jsonResponse(payload))

    renderDashboard()

    expect(
      await screen.findByText("No department is behind the organisation's response rate"),
    ).toBeTruthy()
  })

  it('offers three quick actions that all land somewhere that exists', async () => {
    setToken(tokenFor('company_admin', 'c1'))
    vi.mocked(fetch).mockResolvedValue(jsonResponse(companyPayload()))

    renderDashboard()

    expect(
      (await screen.findByRole('link', { name: /From a template or blank/ })).getAttribute('href'),
    ).toBe('/surveys/new')
    expect(screen.getByRole('link', { name: /Run a microclimate/ }).getAttribute('href')).toBe(
      '/microclimates/new',
    )
    expect(screen.getByRole('link', { name: /Compare with a benchmark you saved/ }).getAttribute('href')).toBe(
      '/analytics/benchmarks',
    )
  })

  /**
   * The cycle. Every survey on this payload has status `active` — the endpoint filters on
   * it — so the step's state comes from its own window instead, which is what keeps the
   * done / current / future distinction alive. `companyPayload`'s survey closed on
   * 2026-02-01, so it is a settled step and reads "closed", not "closes".
   */
  it('places each running survey in the cycle by its own dates', async () => {
    setToken(tokenFor('company_admin', 'c1'))
    vi.mocked(fetch).mockResolvedValue(jsonResponse(companyPayload()))

    renderDashboard()

    const cycle = await screen.findByRole('list', { name: 'Steps of the survey cycle' })
    expect(within(cycle).getByText('Company-wide pulse')).toBeTruthy()
    expect(within(cycle).getByText(/^closed /)).toBeTruthy()
    expect(within(cycle).getByText('Open action plans')).toBeTruthy()
  })

  it('gives a plain employee their own dashboard, with a real way to answer each survey', async () => {
    setToken(tokenFor('employee', 'c1'))
    vi.mocked(fetch).mockResolvedValue(jsonResponse(employeePayload()))

    renderDashboard()

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(requestedPath()).toContain('/dashboard/employee')
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome back, Ana' })).toBeTruthy()
    expect(screen.getByText('Company-wide pulse')).toBeTruthy()
    // The row links somewhere that exists, which is the difference between this page and
    // the listing it replaces as a landing destination.
    expect(screen.getByRole('link', { name: 'Answer' }).getAttribute('href')).toBe(
      '/surveys/s1/respond',
    )
  })

  /**
   * The default branch, and the reason it is the employee view rather than an admin one.
   *
   * `/dashboard/employee` reads no role claim at all — it resolves the caller's own user
   * row — so an unrecognised role gets a page about themselves. Defaulting the other way
   * would produce a landing page that 403s, which is exactly what routing everyone here
   * was meant to stop.
   */
  it('falls back to the per-user dashboard for a role it has never heard of', async () => {
    setToken(tokenFor('auditor', 'c1'))
    vi.mocked(fetch).mockResolvedValue(jsonResponse(employeePayload()))

    renderDashboard()

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(requestedPath()).toContain('/dashboard/employee')
  })

  it('says so, and offers a retry, when the dashboard cannot be loaded', async () => {
    setToken(tokenFor('employee', 'c1'))
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'Service unavailable' }), { status: 503 }),
    )

    renderDashboard()

    expect(await screen.findByText('Unable to fetch dashboard data')).toBeTruthy()
    // The server's own message, not a generic one: "check your connection" would send
    // someone chasing a network problem that is not there.
    expect(screen.getByText('Service unavailable')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('tells an employee with nothing outstanding that there is nothing outstanding', async () => {
    setToken(tokenFor('employee', 'c1'))
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        employeePayload({ pendingSurveyCount: 0, pendingSurveys: [], nextDeadline: null }),
      ),
    )

    renderDashboard()

    expect(await screen.findByText('Nothing is waiting for you')).toBeTruthy()
    // No deadline banner when there is no deadline -- an empty one would read as an
    // outstanding obligation.
    expect(screen.queryByText(/The next survey closes on/)).toBeNull()
  })
})
