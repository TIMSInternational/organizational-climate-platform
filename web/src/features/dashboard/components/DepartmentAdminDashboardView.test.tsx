import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import DepartmentAdminDashboardView from './DepartmentAdminDashboardView'
import { TranslationProvider } from '../../../i18n'
import { setToken } from '../../../auth/token'
import { canReach } from '../../../navigation/roleCapabilities'
import type { DepartmentAdminDashboard, EmployeeDashboard } from '../api/dashboard'

/**
 * The team view a `leader` and a `supervisor` land on, and — since #138 — what it does
 * when there is no team.
 *
 * Rendered directly rather than through `DashboardPage`, which already proves the two
 * roles are routed here. The stub dispatches on URL because the fallback path fetches the
 * *employee* payload from a different endpoint.
 */

function team(overrides: Partial<DepartmentAdminDashboard> = {}): DepartmentAdminDashboard {
  return {
    departmentId: 'd1',
    departmentName: 'Ingeniería',
    companyId: 'c1',
    memberCount: 57,
    activeMemberCount: 54,
    activeSurveyCount: 2,
    completedResponseCount: 41,
    openActionPlanCount: 3,
    // Non-zero on purpose: the "Needs attention" alert — the block that carried the 403
    // link — only exists above zero, so a fixture with none would leave it untested.
    overdueActionPlanCount: 1,
    activeSurveys: [
      {
        id: 's1',
        title: 'Encuesta de clima Q2',
        status: 'active',
        startDate: '2026-06-01T00:00:00Z',
        endDate: '2026-06-12T00:00:00Z',
        responseCount: 29,
      },
    ],
    ...overrides,
  }
}

function employee(): EmployeeDashboard {
  return {
    name: 'María Herrera',
    companyId: 'c1',
    departmentId: null,
    departmentName: null,
    pendingSurveyCount: 1,
    completedSurveyCount: 0,
    unreadNotificationCount: 0,
    nextDeadline: '2026-12-01T00:00:00Z',
    pendingSurveys: [
      {
        id: 's9',
        title: 'Pulso de incorporación',
        type: 'general_climate',
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-12-01T00:00:00Z',
        questionCount: 12,
        anonymous: true,
      },
    ],
  }
}

/**
 * Answers `/dashboard/department-admin` with `department`, or — when it is `'none'` — with
 * the 400 the server sends a user whose row has no department, body and all.
 *
 * The employee endpoints are answered too, because the fallback path calls them. Built the
 * way production builds it: a real `Response` with the real status, so `authFetch`'s
 * `allowStatus` branch is what is under test rather than a hand-made result object.
 */
function serves(department: DepartmentAdminDashboard | 'none'): void {
  vi.mocked(fetch).mockImplementation((input) => {
    const url = String(input)
    if (url.includes('/dashboard/department-admin')) {
      return Promise.resolve(
        department === 'none'
          ? new Response(
              JSON.stringify({ message: 'The authenticated user is not assigned to a department' }),
              { status: 400 },
            )
          : new Response(JSON.stringify(department), { status: 200 }),
      )
    }
    if (url.includes('/last-outcome')) {
      return Promise.resolve(new Response(JSON.stringify(null), { status: 200 }))
    }
    return Promise.resolve(new Response(JSON.stringify(employee()), { status: 200 }))
  })
}

function renderView() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/dashboard']}>
        <DepartmentAdminDashboardView />
      </MemoryRouter>
    </TranslationProvider>,
  )
}

describe('DepartmentAdminDashboardView', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('draws the team it was given', async () => {
    serves(team())
    renderView()

    expect(await screen.findByText('Ingeniería')).toBeTruthy()
    expect(screen.getByText('Encuesta de clima Q2')).toBeTruthy()
  })

  /**
   * The guard the `/action-plans` defect needed and did not have.
   *
   * This page is rendered for `leader` and `supervisor` only, and every link on it is
   * therefore a claim that those two roles can load its destination. Before #138 the
   * overdue-plans alert put a primary button on `/action-plans`, whose `ListAsync` refuses
   * both roles — so 100% of that button's viewers reached "Request failed: 403".
   *
   * Asserted over **every anchor the page renders**, not over the one that was wrong: a
   * check that named `/action-plans` would go green the moment the next dead link pointed
   * somewhere else. `canReach` is asked with tracking ON, which is the *widest* capability
   * set either role has — so a link that fails here fails for every deployment.
   *
   * ## The sweep is empty today, and that is stated rather than hidden
   *
   * With the button gone the page renders no anchors at all — `DashboardSurveyTable` is
   * given `canOpenSurvey={false}` here for the same reason (`GET /surveys/{id}` is
   * `CanAdminister`). So the loop below currently iterates nothing, and a bare
   * `expect(refused).toEqual([])` would pass whatever the predicate did. The positive
   * control is what stops that being a green light: `canReach` is made to *refuse* the
   * exact href this test exists about, in the same call shape the sweep uses.
   */
  it('renders no link either of its two roles would be refused', async () => {
    serves(team())
    const { container } = renderView()

    await screen.findByText('Ingeniería')

    // Guard the guard: the predicate has to be capable of saying no, or an empty `refused`
    // proves nothing. `/action-plans` is the precise href that used to sit on this page.
    expect(canReach('leader', '/action-plans', true)).toBe(false)
    expect(canReach('supervisor', '/action-plans', true)).toBe(false)

    const hrefs = [...container.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') ?? '')
    const refused = hrefs.filter(
      (href) => !canReach('leader', href, true) || !canReach('supervisor', href, true),
    )
    expect(refused).toEqual([])
  })

  it('still tells a leader their team has overdue plans, and says whose screen they are on', async () => {
    serves(team())
    renderView()

    expect(await screen.findByText('Overdue action plans')).toBeTruthy()
    expect(
      screen.getByText(/opening an action plan is a company administrator's screen/i),
    ).toBeTruthy()
  })

  describe('when the server says the caller has no department', () => {
    /**
     * The landing-page defect. `/dashboard` is where `resolveInitialRoute` sends every
     * role, so this used to be the first screen after login for a leader or supervisor
     * whose row carried no `department_id`: a red panel reading "The authenticated user is
     * not assigned to a department" over a Retry that could never succeed.
     */
    it('shows their own work instead of an error', async () => {
      serves('none')
      renderView()

      // The employee view's greeting, addressed to them by name — i.e. a page that loaded.
      expect(await screen.findByText('Pulso de incorporación')).toBeTruthy()

      expect(screen.queryByText('Unable to fetch dashboard data')).toBeNull()
      expect(
        screen.queryByText('The authenticated user is not assigned to a department'),
      ).toBeNull()
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    })

    it('says why they are looking at it, rather than substituting silently', async () => {
      serves('none')
      renderView()

      expect(await screen.findByText('You are not assigned to a team yet')).toBeTruthy()
      expect(screen.getByText(/A company administrator can assign one/)).toBeTruthy()
    })

    it('draws no team figures at all', async () => {
      serves('none')
      renderView()

      await screen.findByText('You are not assigned to a team yet')
      // The four KPI labels of the team view. None may leak into the fallback: there is no
      // team, so a zero here would be a measurement of something that was never measured.
      for (const label of ['Responses per 100 people', 'Team members', 'Open action plans']) {
        expect(screen.queryByText(label), label).toBeNull()
      }
    })
  })
})
