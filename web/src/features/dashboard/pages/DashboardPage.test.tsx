import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import DashboardPage from './DashboardPage'
import { TranslationProvider } from '../../../i18n'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../company-context'
import { setToken } from '../../../auth/token'
import type {
  DashboardPendingSurvey,
  DepartmentAdminDashboard,
  EmployeeDashboard,
  SuperAdminDashboard,
} from '../api/dashboard'
import { tokenFor as tokenForClaims } from '../../../test/jwtFixture'
import en from '../../../i18n/en.json'

/** The redesigned company view's copy, so a heading is asserted by key and not by prose. */
const nextCopy = en.dashboard.next

/**
 * #384: the role/companyId shorthand this file's call sites use, over the shared UTF-8
 * encoder. Kept local rather than pushed into the shared helper, because the shorthand is
 * this file's convenience and not a fixture shape other suites share.
 */
function tokenFor(role: string, companyId = 'c1'): string {
  return tokenForClaims({ role, companyId })
}

/** A well-formed unsigned JWT, so `readSessionClaims` reads the role rather than bailing. */

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
    // Null: this file proves ROUTING, not the team view's content.
    // `DepartmentAdminDashboardView.test.tsx` owns the disclosed and withheld cases.
    climate: null,
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
   * useful answer than the platform one.
   *
   * The tenant dashboard is the redesigned Panel de Control (`../next`), which replaced
   * `CompanyAdminDashboardView` on this route. `useAdminDashboardModel` composes it from
   * the existing clients region by region; this stub answers every one of them 503, so
   * every region falls back to the sample and the page says so — the chip, and a sentence
   * carrying the server's own message. What THIS file proves is the dispatch: the scope
   * the page hands the hook reaches `GET /dashboard/company-admin`. The composition and
   * the fallback rules are `loadModel.test.ts`'s and `compose.test.ts`'s.
   */
  it('shows a super_admin the redesigned company dashboard for the company they picked', async () => {
    setToken(tokenFor('super_admin', ''))
    window.localStorage.setItem(COMPANY_CONTEXT_STORAGE_KEY, 'c9')
    serves({ message: 'Service unavailable' }, { status: 503 })

    renderDashboard()

    expect(await screen.findByText(nextCopy.sampleChip)).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: nextCopy.title })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: nextCopy.whereHeading })).toBeTruthy()
    expect(screen.getAllByText(/Service unavailable/).length).toBeGreaterThan(0)
    expect(dashboardRequests().filter((url) => url.includes('/dashboard/company-admin'))).toEqual([
      expect.stringContaining('/dashboard/company-admin?companyId=c9'),
    ])
  })

  it('shows a company_admin the redesigned company dashboard, and sends no company id', async () => {
    setToken(tokenFor('company_admin', 'c1'))
    serves({ message: 'Service unavailable' }, { status: 503 })

    renderDashboard()

    expect(await screen.findByText(nextCopy.sampleChip)).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: nextCopy.title })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: nextCopy.whereHeading })).toBeTruthy()
    const company = dashboardRequests().filter((url) => url.includes('/dashboard/company-admin'))
    expect(company).toHaveLength(1)
    expect(company[0]).not.toContain('companyId')
  })

  /**
   * The gate `DashboardNextPage` drew around `/dashboard/next` before the redesign took
   * over `/dashboard`: the company view is for the two branches that name a tenant, and
   * nobody else sees so much as its title. The cases above and below prove each of these
   * roles reaches its own view; this one pins the negative, after that view has drawn.
   * (A SuperAdmin with no tenant chosen is the platform-overview case above.)
   */
  it.each(['leader', 'supervisor', 'employee'])(
    'does not show a %s the company dashboard',
    async (role) => {
      setToken(tokenFor(role, 'c1'))
      serves(role === 'employee' ? employeePayload() : departmentPayload())

      renderDashboard()

      expect(await screen.findByText('Company-wide pulse')).toBeTruthy()
      expect(screen.queryByRole('heading', { level: 1, name: nextCopy.title })).toBeNull()
      expect(screen.queryByText(nextCopy.sampleChip)).toBeNull()
    },
  )

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
