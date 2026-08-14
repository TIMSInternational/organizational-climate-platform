import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import DashboardPage from './DashboardPage'
import { TranslationProvider } from '../../../i18n'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../company-context'
import { setToken } from '../../../auth/token'
import type {
  CompanyAdminDashboard,
  DashboardPendingSurvey,
  DepartmentAdminDashboard,
  EmployeeDashboard,
  SuperAdminDashboard,
} from '../api/dashboard'

/** A well-formed unsigned JWT, so `readSessionClaims` reads the role rather than bailing. */
function tokenFor(role: string, companyId = 'c1'): string {
  return `header.${btoa(JSON.stringify({ role, companyId }))}.signature`
}

/**
 * Answers `fetch` from the URL, with a fresh `Response` on every call.
 *
 * Both halves are load-bearing, and each of them replaces a way the previous stub was
 * wrong rather than merely inconvenient.
 *
 * **By URL, not by call order.** The employee's Home makes two requests — its own payload
 * and `LastOutcomePanel`'s `/dashboard/employee/last-outcome` — and the panel is a child,
 * so *its* effect fires first. A stub that answered the first call with the dashboard
 * payload therefore handed the panel a body with no `plansOpenedSince` on it and took the
 * whole page down. Which request lands first is not something the page promises; the URL
 * it asks for is.
 *
 * **A fresh `Response` per call.** A body may be read once, so a single shared instance
 * serves whoever gets there first and hands everybody after them a consumed body — which
 * `authFetch` reports as "Request failed: 503" in place of the server's own message, and
 * which would make a Retry that genuinely re-requested indistinguishable from one that did
 * nothing at all.
 *
 * `lastOutcome` defaults to `null` — the endpoint's own answer for "this company has never
 * closed a survey", which keeps the panel silent in the cases that are not about it.
 */
function serves(
  dashboard: unknown,
  { status = 200, lastOutcome = null }: { status?: number; lastOutcome?: unknown } = {},
): void {
  vi.mocked(fetch).mockImplementation((input) => {
    const forPanel = String(input).includes('/last-outcome')
    return Promise.resolve(
      new Response(JSON.stringify(forPanel ? lastOutcome : dashboard), {
        status: forPanel ? 200 : status,
      }),
    )
  })
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
    pendingSurveys: [pendingSurvey()],
    ...overrides,
  }
}

/** One survey the reader still owes an answer to. */
function pendingSurvey(overrides: Partial<DashboardPendingSurvey> = {}): DashboardPendingSurvey {
  return {
    id: 's1',
    title: 'Company-wide pulse',
    type: 'general_climate',
    startDate: '2026-01-01T00:00:00Z',
    endDate: '2026-02-01T00:00:00Z',
    questionCount: 8,
    // The survey's own setting. False by default, like `SurveySettings`'s own default:
    // nothing routed through this page turns on the anonymity chip, and a fixture that
    // promised anonymity everywhere would be the wrong thing to make free.
    anonymous: false,
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

/**
 * Every URL the page has asked its own dashboard endpoint for, in call order —
 * `LastOutcomePanel`'s parallel `/dashboard/employee/last-outcome` excluded.
 */
function dashboardRequests(): string[] {
  return vi
    .mocked(fetch)
    .mock.calls.map(([url]) => String(url))
    .filter((url) => !url.includes('/last-outcome'))
}

/**
 * The path of the one request the page made for its own payload — the request the role
 * dispatch chose, which is what every case below is about.
 *
 * Not `mock.calls[0]`. The employee view mounts `LastOutcomePanel` as a child, so the
 * panel's effect fires before its parent's and the *first* call is the panel's: an
 * assertion that an employee is sent to `/dashboard/employee` would then be satisfied by
 * `/dashboard/employee/last-outcome` no matter where the page itself went. The panel's
 * request is excluded by name, and it is an error for more than one to remain — a page
 * asking two role endpoints is the dispatch bug these cases exist to catch.
 */
function requestedPath(): string {
  const [path, ...extra] = dashboardRequests()
  if (path === undefined) throw new Error('the page has made no dashboard request yet')
  if (extra.length > 0) {
    throw new Error(`the page asked for more than one dashboard: ${[path, ...extra].join(', ')}`)
  }
  return path
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
    // A no-op unless a case pinned the clock, and the reason one can: the employee heading
    // is a greeting chosen from the reader's own hour.
    vi.useRealTimers()
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
    serves(superAdminPayload())

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
    serves(companyPayload())

    renderDashboard()

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(requestedPath()).toContain('/dashboard/company-admin?companyId=c9')
  })

  it('asks for the tenant dashboard for a company_admin, and sends no company id', async () => {
    // The absence is the point. A CompanyAdmin's scope is their claim, decided by the
    // server; a client that helpfully sent its own idea of the tenant would be choosing
    // a scope, which is the shape the endpoint refuses.
    setToken(tokenFor('company_admin', 'c1'))
    serves(companyPayload())

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
      serves(departmentPayload())

      renderDashboard()

      await waitFor(() => expect(fetch).toHaveBeenCalled())
      expect(requestedPath()).toContain('/dashboard/department-admin')
      expect(requestedPath()).not.toContain('departmentId')
      // The redesign's header shape, matching every other screen: the page is titled after
      // what it *is*, and the scope it is about sits in the eyebrow above. Before this, a
      // leader's document heading was "Engineering" while all twelve other screens titled
      // themselves after the screen — so the department name is asserted as the eyebrow,
      // not as the `h1`, and both halves are pinned so neither can quietly move back.
      expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeTruthy()
      expect(screen.getByText('Engineering')).toBeTruthy()
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
    serves(departmentPayload())

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
    serves(departmentPayload())

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
    serves(companyPayload())

    renderDashboard()

    expect(await screen.findByRole('columnheader', { name: 'Target' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: '12' })).toBeTruthy()
  })

  /**
   * The rule the whole redesign rests on: every reading is `font-mono tabular-nums` and
   * prose stays in the sans face. This table sat directly under four `KpiTile`s that honour
   * it while rendering its own response counts in the proportional face — two faces for the
   * same kind of number on one screen, which is exactly what stops it reading as an
   * instrument.
   *
   * Asserted from both sides so it cannot pass vacuously: the reading is mono AND the survey
   * name beside it is not. A blanket `font-mono` on the table would satisfy the first alone.
   */
  it('sets the survey table readings in mono and its prose in the sans face', async () => {
    setToken(tokenFor('company_admin', 'c1'))
    serves(companyPayload())

    renderDashboard()

    // `7` is the survey row's own `responseCount`. Asserted on that and not on the Target
    // column's `12` — the first version of this test read Target, so dropping mono from the
    // responses cell left it green. (`20` is the company-wide total, not in this table.)
    const responses = await screen.findByRole('cell', { name: '7' })
    expect(responses.className).toContain('font-mono')
    expect(responses.className).toContain('tabular-nums')

    const title = screen.getByRole('cell', { name: 'Company-wide pulse' })
    expect(title.className).not.toContain('font-mono')
  })

  it('does link a company_admin to the survey page, which their role can load', async () => {
    setToken(tokenFor('company_admin', 'c1'))
    serves(companyPayload())

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
    serves(companyPayload())

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
    serves(payload)

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
    serves(companyPayload())

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
    serves(payload)

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
    serves(payload)

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
    serves(companyPayload())

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
    serves(payload)

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
    serves(payload)

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
    serves(payload)

    renderDashboard()

    expect(await screen.findByText('No Departments Yet')).toBeTruthy()
    expect(screen.queryByText('No department can be measured yet')).toBeNull()
  })

  it('offers three quick actions that all land somewhere that exists', async () => {
    setToken(tokenFor('company_admin', 'c1'))
    serves(companyPayload())

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
    serves(companyPayload())

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
    serves(payload)

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
    serves(companyPayload())

    renderDashboard()

    const cycle = await screen.findByRole('list', { name: 'Steps of the survey cycle' })
    expect(within(cycle).getByText(/^still open, past /).textContent).toContain('Feb 1')
    expect(screen.getByRole('cell', { name: 'Feb 1' })).toBeTruthy()
  })

  /**
   * The employee's own landing page, and the thing that makes it a landing page rather
   * than a report: a way IN to every survey it names.
   *
   * The redesign moved where those ways in are drawn — the nearest survey is now a task
   * card with "Start answering" on it and the rest are quieter rows with "Answer" — so the
   * assertion is on the hrefs and not on which of the two shapes a given survey got. The
   * page owes the reader a route into each outstanding survey; the arrangement is
   * `EmployeeDashboardView`'s business and its own suite's.
   *
   * TWO pending surveys, where this case used to send one: "a real way to answer EACH
   * survey" is the property, and with a single survey a page that linked only the first
   * one — or only ever the count that used to sit in a tile — passes just the same.
   */
  it('gives a plain employee their own dashboard, with a real way to answer each survey', async () => {
    // The heading is chosen from the reader's own clock, so the clock is pinned rather
    // than left to whatever hour CI happens to run at. Local parts, so the hour is 9 in
    // every zone. Undone by `vi.useRealTimers()` in `afterEach`.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 0, 15, 9, 0, 0))
    setToken(tokenFor('employee', 'c1'))
    serves(
      employeePayload({
        pendingSurveyCount: 2,
        pendingSurveys: [pendingSurvey(), pendingSurvey({ id: 's2', title: 'Weekly pulse' })],
      }),
    )

    renderDashboard()

    await waitFor(() => expect(requestedPath()).toContain('/dashboard/employee'))
    // Addressed to the person and naming them. This is the one page in the product written
    // in that voice, and an admin view reaching an employee would be titled after a report.
    expect(await screen.findByRole('heading', { level: 1, name: 'Good morning, Ana' })).toBeTruthy()

    // Both surveys are named, and both are reachable. The hrefs are the half that survived
    // the redesign untouched: titles alone would be satisfied by a page that lists what is
    // outstanding without offering any way to answer it.
    expect(screen.getByText('Company-wide pulse')).toBeTruthy()
    expect(screen.getByText('Weekly pulse')).toBeTruthy()
    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'))
    expect(hrefs).toContain('/surveys/s1/respond')
    expect(hrefs).toContain('/surveys/s2/respond')
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
    serves(employeePayload())

    renderDashboard()

    // Waited on through `requestedPath`, which ignores the outcome panel's parallel call:
    // `toHaveBeenCalled` can be satisfied by that one alone, and this case is about where
    // the PAGE went.
    await waitFor(() => expect(requestedPath()).toContain('/dashboard/employee'))
  })

  /**
   * The failure path: say so, say why in the server's own words, and offer a way out of it.
   *
   * The retry is asserted by USING it, not by finding the button. A control that renders
   * and does nothing is the failure this case is worth writing about, and it looks
   * identical to a working one from the outside — so the second load serves a payload and
   * the page has to both re-request and draw what came back.
   *
   * `LastOutcomePanel` answers normally throughout: what is under test is Home's own
   * failure, not a page-wide outage, and the panel is silent either way.
   */
  it('says so, and offers a retry, when the dashboard cannot be loaded', async () => {
    setToken(tokenFor('employee', 'c1'))
    serves({ message: 'Service unavailable' }, { status: 503 })

    renderDashboard()

    expect(await screen.findByText('Unable to fetch dashboard data')).toBeTruthy()
    // The server's own message, not a generic one: "check your connection" would send
    // someone chasing a network problem that is not there.
    expect(screen.getByText('Service unavailable')).toBeTruthy()
    await waitFor(() => expect(dashboardRequests()).toHaveLength(1))

    serves(employeePayload())
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    // A second request really leaves for the same endpoint...
    await waitFor(() => expect(dashboardRequests()).toHaveLength(2))
    expect(dashboardRequests()[1]).toContain('/dashboard/employee')
    // ...and the page is the loaded one afterwards, rather than the error with a spent
    // button on it.
    expect(await screen.findByRole('link', { name: 'Start answering' })).toBeTruthy()
    expect(screen.queryByText('Unable to fetch dashboard data')).toBeNull()
  })

  /**
   * The quiet state, said plainly and in words.
   *
   * The second assertion is the old "no deadline banner when there is no deadline" one,
   * re-aimed. That banner is gone from the redesign entirely — it only ever appeared when
   * something was already due, which the task card's own chip says where the reader is
   * already looking — so the thing that could now announce a phantom obligation is the task
   * card itself. Nothing that offers a way into a survey, and no closing date, may be drawn
   * on a page whose whole message is that nothing is owed.
   */
  it('tells an employee with nothing outstanding that there is nothing outstanding', async () => {
    setToken(tokenFor('employee', 'c1'))
    serves(employeePayload({ pendingSurveyCount: 0, pendingSurveys: [], nextDeadline: null }))

    renderDashboard()

    expect(await screen.findByText('Nothing is waiting for you')).toBeTruthy()
    const waysIn = screen
      .queryAllByRole('link')
      .map((link) => link.getAttribute('href') ?? '')
      .filter((href) => href.includes('/respond'))
    expect(waysIn).toEqual([])
    expect(screen.queryByText(/closes/i)).toBeNull()
  })
})
