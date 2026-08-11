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

/**
 * The status dot of the timeline step whose title is `title`.
 *
 * `JourneyTimeline` draws it as the 22px round span inside the step's `<li>`; it is
 * `aria-hidden`, so it has no role to query by and the geometry is the handle. Filled
 * means settled (completed or error), transparent means still to come or running.
 */
function stepDot(title: HTMLElement): HTMLElement {
  const dot = title.closest('li')?.querySelector('span[style*="border-radius: 11px"]')
  if (!(dot instanceof HTMLElement)) throw new Error('no status dot on that timeline step')
  return dot
}

/** The path of the single request the page made. */
function requestedPath(): string {
  const [url] = vi.mocked(fetch).mock.calls[0] as [string]
  return url
}

/** The ambient zone, so a case that sets its own can put it back. */
const AMBIENT_TZ = process.env.TZ

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    window.localStorage.clear()
    vi.unstubAllGlobals()
    if (AMBIENT_TZ === undefined) delete process.env.TZ
    else process.env.TZ = AMBIENT_TZ
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

    const finding = await screen.findByText(/Engineering is behind the organisation/)
    // `textContent`, not `getByText`: the readings inside the sentence are now their
    // own mono spans, so the sentence is several nodes rather than one text node.
    expect(finding.parentElement?.textContent).toContain(
      '5 of 6 people in Engineering have completed a survey',
    )
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

  /**
   * The map has to rank, and at `ClimateMap`'s 10-point default it stops: on an
   * unbounded rate everything more than ten points from target saturates. These two
   * departments are 50 and 61 against an organisation on 125 — eleven points apart and
   * both far past ten — so at the default they painted the identical deep red.
   */
  it('scales the map to this tenant, so two departments behind by different amounts differ', async () => {
    setToken(tokenFor('company_admin', 'c1'))
    const payload = companyPayload()
    payload.userCount = 24
    payload.completedResponseCount = 30
    payload.departments = [
      { id: 'd1', name: 'Marketing', memberCount: 12, completedResponseCount: 6 },
      { id: 'd2', name: 'Customer Support', memberCount: 18, completedResponseCount: 11 },
    ]
    vi.mocked(fetch).mockResolvedValue(jsonResponse(payload))

    const { container } = renderDashboard()

    await screen.findByRole('rowheader', { name: 'Marketing' })
    const fills = [...container.querySelectorAll('td div')].map(
      (cell) => (cell as HTMLElement).style.backgroundColor,
    )
    expect(fills).toHaveLength(2)
    expect(fills[0]).not.toBe(fills[1])
  })

  /**
   * The typographic thesis, on the sentence that carries the most numbers. Every reading
   * is mono with tabular figures and the prose around it is not — `t` hands back one flat
   * string, so without `MonoReadings` these four numbers came out in the sans face.
   */
  it('sets the readings inside the finding in mono and leaves the prose alone', async () => {
    setToken(tokenFor('company_admin', 'c1'))
    vi.mocked(fetch).mockResolvedValue(jsonResponse(companyPayload()))

    renderDashboard()

    const finding = await screen.findByText(/Engineering is behind the organisation/)
    const evidence = finding.nextElementSibling as HTMLElement
    expect(
      [...evidence.querySelectorAll('.font-mono.tabular-nums')].map((node) => node.textContent),
    ).toEqual(['5', '6', '83', '150'])
    // The sentence still reads as one sentence, and the marker never reaches the page.
    expect(evidence.textContent).toBe(
      '5 of 6 people in Engineering have completed a survey — 83 responses per 100 people, against 150 across the organisation.',
    )
  })

  /**
   * The all-clear is a claim, and a claim needs evidence.
   *
   * Every department here is under the anonymity floor, so not one of them has a reading
   * that may be published. "No department is behind" would be a clean bill of health
   * computed from nothing — and it would be false: at 4 responses from 8 people Support
   * is 17 per 100 against an organisation on 50. The page must say it could not measure,
   * and the below-target tile must not read as a confident zero either.
   */
  it('does not declare an all-clear when no department could be measured', async () => {
    setToken(tokenFor('company_admin', 'c1'))
    const payload = companyPayload()
    payload.userCount = 24
    payload.completedResponseCount = 12
    payload.departments = [
      { id: 'd1', name: 'Operations', memberCount: 8, completedResponseCount: 4 },
      { id: 'd2', name: 'Support', memberCount: 6, completedResponseCount: 1 },
    ]
    vi.mocked(fetch).mockResolvedValue(jsonResponse(payload))

    renderDashboard()

    expect(await screen.findByText('No department can be compared yet')).toBeTruthy()
    expect(screen.queryByText("No department is behind the organisation's response rate")).toBeNull()
    // The tile draws an em dash, not a zero: "none are behind" is a finding and
    // "nothing could be read" is the absence of one.
    expect(screen.getByText('No reading yet')).toBeTruthy()
    // And no action plan is offered, because there is no finding to name as its source.
    expect(screen.queryByRole('link', { name: 'Create Action Plan' })).toBeNull()
  })

  /**
   * Departments that exist but hold nobody. Telling this admin to create departments is
   * advice to build what they already have; the module's own honest sentence about
   * memberless departments used to be reachable only from inside the map branch.
   */
  it('does not tell an admin with departments to create departments', async () => {
    setToken(tokenFor('company_admin', 'c1'))
    const payload = companyPayload()
    payload.departmentCount = 2
    payload.departments = [
      { id: 'd1', name: 'Operations', memberCount: 0, completedResponseCount: 0 },
      { id: 'd2', name: 'Support', memberCount: 0, completedResponseCount: 0 },
    ]
    vi.mocked(fetch).mockResolvedValue(jsonResponse(payload))

    renderDashboard()

    expect(await screen.findByText('No department can be measured yet')).toBeTruthy()
    expect(screen.queryByText('No Departments Yet')).toBeNull()
    expect(
      screen.getByText(/Departments with no members yet, and so no reading:/),
    ).toBeTruthy()
  })

  /** A tenant with no departments at all still gets the invitation to create one. */
  it('still tells an admin with no departments to create one', async () => {
    setToken(tokenFor('company_admin', 'c1'))
    const payload = companyPayload()
    payload.departmentCount = 0
    payload.departments = []
    vi.mocked(fetch).mockResolvedValue(jsonResponse(payload))

    renderDashboard()

    expect(await screen.findByText('No Departments Yet')).toBeTruthy()
    expect(screen.queryByText('No department can be measured yet')).toBeNull()
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
   * The cycle, and the rule that a survey is open or closed by its STATUS.
   *
   * `companyPayload`'s survey is `active` with an `endDate` of 2026-02-01, which is in
   * the past. Nothing closes a survey automatically, and `SurveyStatuses.AcceptsResponses`
   * is status-only, so the API is still taking answers for it — the timeline must not
   * call it closed. It says "still open" with the date attached, and the ongoing-surveys
   * table below says "Active" about the same row, which is the agreement that broke.
   */
  it('does not call a survey closed while its status still accepts responses', async () => {
    setToken(tokenFor('company_admin', 'c1'))
    vi.mocked(fetch).mockResolvedValue(jsonResponse(companyPayload()))

    renderDashboard()

    const cycle = await screen.findByRole('list', { name: 'Steps of the survey cycle' })
    expect(within(cycle).getByText('Company-wide pulse')).toBeTruthy()
    expect(within(cycle).getByText(/^still open, past /)).toBeTruthy()
    expect(within(cycle).queryByText(/^closed /)).toBeNull()
    expect(within(cycle).getByText('Open action plans')).toBeTruthy()

    // And the dot, which is the half a reader takes in first. `JourneyTimeline` fills
    // a settled step and leaves a running one hollow, so a green filled tick here would
    // say "closed" even with the words above corrected.
    expect(stepDot(within(cycle).getByText('Company-wide pulse')).style.background).toBe(
      'transparent',
    )
  })

  /**
   * The other half of the same rule: a survey whose status HAS left `active` is closed,
   * and reads that way even though its window is identical to the one above.
   */
  it('does call a survey closed once its status says so', async () => {
    setToken(tokenFor('company_admin', 'c1'))
    const payload = companyPayload()
    payload.ongoingSurveys = [{ ...payload.ongoingSurveys[0], status: 'closed' }]
    vi.mocked(fetch).mockResolvedValue(jsonResponse(payload))

    renderDashboard()

    const cycle = await screen.findByRole('list', { name: 'Steps of the survey cycle' })
    expect(within(cycle).getByText(/^closed /)).toBeTruthy()
    expect(within(cycle).queryByText(/^still open/)).toBeNull()
    // Settled, so the dot is filled rather than hollow.
    expect(stepDot(within(cycle).getByText('Company-wide pulse')).style.background).not.toBe(
      'transparent',
    )
  })

  /**
   * The dates are calendar days held as UTC midnights. Read in a zone west of UTC they
   * slide a day, which put the wrong date on both the timeline and the table beneath it.
   * `endDate` here is 2026-02-01T00:00:00Z, so both must say the first of February
   * whatever zone the reader — or CI — is in.
   */
  it('prints a survey deadline as the calendar day it is, west of UTC', async () => {
    // Set explicitly, not inherited: in UTC this assertion holds either way, so a run
    // in CI's own zone would prove nothing. Restored by the suite's `afterEach`.
    process.env.TZ = 'America/Chicago'
    setToken(tokenFor('company_admin', 'c1'))
    vi.mocked(fetch).mockResolvedValue(jsonResponse(companyPayload()))

    renderDashboard()

    const cycle = await screen.findByRole('list', { name: 'Steps of the survey cycle' })
    expect(within(cycle).getByText(/^still open, past /).textContent).toContain('2/1/2026')
    expect(screen.getByRole('cell', { name: '2/1/2026' })).toBeTruthy()
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
