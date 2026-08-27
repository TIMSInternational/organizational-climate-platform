import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import DepartmentAdminDashboardView from './DepartmentAdminDashboardView'
import { TranslationProvider } from '../../../i18n'
import { setToken } from '../../../auth/token'
import { canReach } from '../../../navigation/roleCapabilities'
import {
  NO_DEPARTMENT_MESSAGE,
  NO_USER_RECORD_MESSAGE,
  type DepartmentAdminDashboard,
  type EmployeeDashboard,
} from '../api/dashboard'

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
    // A disclosed reading by default. The suppressed and absent cases are their own
    // tests below rather than the baseline, because a fixture that withholds by default
    // would let a regression that withholds EVERYTHING pass every test in this file.
    climate: {
      surveyId: 's1',
      surveyTitle: 'Q3 Climate Survey',
      surveyEndDate: '2026-08-05T00:00:00Z',
      respondentCount: 9,
      isSuppressed: false,
      minimumGroupSize: 5,
      dimensions: [
        { dimension: 'psychological_safety', averageScore: 4.2 },
        { dimension: 'workload', averageScore: 2.4 },
        { dimension: 'trust', averageScore: 3.8 },
      ],
    },
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
 * Answers `/dashboard/department-admin` the way the server does, for each of the three
 * answers this view has a screen for.
 *
 * The bodies are the real ones, imported from the client that matches on them rather than
 * retyped here — a fixture that says something the server does not send is the one kind of
 * green that costs a night. `'orphan'` is `SurveyEndpoints.ActingUserRequired()`: the same
 * 400 status as `'none'` and a different cause, and until this branch both drew the same
 * screen.
 *
 * The employee endpoints are answered too, because the fallback path calls them, and
 * `employeeStatus` lets a test fail *them* — a leader with no department while the employee
 * dashboard is down is a real combination, and the notice is supposed to survive it. Built
 * the way production builds it: a real `Response` with the real status, so `authFetch`'s
 * `allowStatus` branch is what is under test rather than a hand-made result object.
 */
function serves(
  department: DepartmentAdminDashboard | 'none' | 'orphan',
  employeeStatus = 200,
): void {
  vi.mocked(fetch).mockImplementation((input) => {
    const url = String(input)
    if (url.includes('/dashboard/department-admin')) {
      if (department === 'none' || department === 'orphan') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              message: department === 'none' ? NO_DEPARTMENT_MESSAGE : NO_USER_RECORD_MESSAGE,
            }),
            { status: 400 },
          ),
        )
      }
      return Promise.resolve(new Response(JSON.stringify(department), { status: 200 }))
    }
    if (url.includes('/last-outcome')) {
      return Promise.resolve(new Response(JSON.stringify(null), { status: 200 }))
    }
    if (employeeStatus !== 200) {
      // What the orphaned account really gets from `EmployeeAsync`, which resolves the
      // same row: the same 400, and `getEmployeeDashboard` does not allow-list it.
      return Promise.resolve(
        new Response(JSON.stringify({ message: NO_USER_RECORD_MESSAGE }), { status: employeeStatus }),
      )
    }
    return Promise.resolve(new Response(JSON.stringify(employee()), { status: 200 }))
  })
}

function renderView(locale: 'en' | 'es' = 'en') {
  return render(
    <TranslationProvider initialLocale={locale}>
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

  // ==================================================================
  // The team's climate — the second caller for the per-dimension aggregation
  // ==================================================================

  describe("the team's climate", () => {
    it('draws one row of the team\'s own dimension scores', async () => {
      serves(team())
      renderView()

      // Scoped to the climate FIGURE, because this page renders a second table
      // (`DashboardSurveyTable`) and a bare getByRole('table') silently asserts against
      // that one instead. Queried by role without a name: `<figcaption>` is a naming
      // source in the HTML spec but `dom-accessibility-api` does not implement it, so
      // `{ name }` here matches nothing however correct the markup is. The caption is
      // asserted separately below.
      const figure = await screen.findByRole('figure')
      expect(within(figure).getByText('Q3 Climate Survey')).toBeTruthy()
      const table = within(figure).getByRole('table')
      const headers = within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent?.trim())
      expect(headers).toContain('psychological_safety')
      expect(headers).toContain('workload')

      // The reading itself, to one decimal like every score in this product.
      expect(within(table).getByText('2.4')).toBeTruthy()
    })

    /**
     * THE guarantee. A team under the floor is rendered as PROTECTED — hatched and
     * padlocked — and publishes no figure at all.
     *
     * The ruling (2026-08-27) is that the floor applies to the SCORES. It deliberately
     * does NOT apply to the team's size in the tiles above, which is a different
     * disclosure: a leader already knows how many people they have. So this asserts both
     * halves — no score in the grid, and the member count still on screen — because a
     * change that floored everything would otherwise look like a pass.
     */
    it('withholds the scores of a team under the floor, but not its size', async () => {
      serves(
        team({
          memberCount: 4,
          activeMemberCount: 4,
          climate: {
            surveyId: 's1',
            surveyTitle: 'Q3 Climate Survey',
            surveyEndDate: '2026-08-05T00:00:00Z',
            // Zeroed by the server with the reading, so the withheld size never travels.
            respondentCount: 0,
            isSuppressed: true,
            minimumGroupSize: 5,
            // The dimension NAMES survive suppression, with null scores. Which dimensions
            // were asked is not the protected fact — the scores are — and without the
            // names there would be no columns to hatch, so the row would render blank.
            dimensions: [
              { dimension: 'psychological_safety', averageScore: null },
              { dimension: 'workload', averageScore: null },
              { dimension: 'trust', averageScore: null },
            ],
          },
        }),
      )
      renderView()

      const figure = await screen.findByRole('figure')
      const table = within(figure).getByRole('table')
      const protectedCells = within(table).getAllByRole('img')
      expect(protectedCells.length).toBeGreaterThan(0)
      for (const cell of protectedCells) {
        expect(cell.getAttribute('aria-label')?.toLowerCase()).toContain('protected')
      }

      // No reading of any kind in the grid — and in particular not the 0 the payload
      // carries, which is the number the floor exists to withhold.
      const body = within(table).getAllByRole('row').slice(1)
      for (const row of body) expect(row.textContent).not.toMatch(/\d/)

      // ...while the team's own size is still on the page. Count unfloored, scores
      // floored: that split is the ruling, not an oversight. Scoped to the tile rather
      // than a bare getByText('4'), which matches several figures on this page.
      const tile = screen.getByText('Team members').closest('[data-slot="kpi-tile"]')
      expect(tile?.textContent).toContain('4')
    })

    /**
     * A dimension with no computable average is DROPPED, never drawn as 0.
     *
     * `PooledAverage` returns null for a dimension whose questions all lack an average, and
     * a `?? 0` on the way to the grid would print "0.0" — a catastrophic reading nobody
     * recorded, on the screen a team lead judges their team by. This repository has shipped
     * that failure before, and a plausible zero is worse than a gap because it is believed.
     */
    it('drops a dimension with no score rather than drawing it as zero', async () => {
      serves(
        team({
          climate: {
            surveyId: 's1',
            surveyTitle: 'Q3 Climate Survey',
            surveyEndDate: '2026-08-05T00:00:00Z',
            respondentCount: 9,
            isSuppressed: false,
            minimumGroupSize: 5,
            dimensions: [
              { dimension: 'psychological_safety', averageScore: 4.2 },
              { dimension: 'workload', averageScore: null },
            ],
          },
        }),
      )
      renderView()

      const figure = await screen.findByRole('figure')
      const table = within(figure).getByRole('table')
      const headers = within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent?.trim())

      expect(headers).toContain('psychological_safety')
      expect(headers).not.toContain('workload')
      // And no zero anywhere in the grid, which is what `?? 0` would have put there.
      expect(within(table).queryByText('0.0')).toBeNull()
      expect(within(table).queryByText('0')).toBeNull()
    })

    /**
     * No closed survey is not the same statement as a withheld reading, and the screen
     * must not collapse them: the first says "nothing has closed yet", the second says
     * "your team is too small to report". An empty grid for the first would read as a
     * product that lost the data.
     */
    it('draws no grid at all when nothing has closed yet', async () => {
      serves(team({ climate: null }))
      renderView()

      await screen.findByText('Ingeniería')
      // The climate figure specifically. The surveys table below it still renders, which
      // is why this asserts the absence of the FIGURE and not of any table.
      expect(screen.queryByRole('figure')).toBeNull()
      expect(screen.queryByText("Your team's climate")).toBeNull()
    })
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
    expect(screen.getByText(/come from survey findings/i)).toBeTruthy()
    expect(screen.getByText(/Ask an administrator for the detail/i)).toBeTruthy()
  })

  /**
   * The copy has to survive the sidebar next to it.
   *
   * It read "opening an action plan is a company administrator's screen. Ask yours for
   * the detail" — while a `leader` in a tracking deployment carries a sidebar row labelled
   * "Action Plans" (`navigation.trackingPlans`, which is the *identical string* to
   * `navigation.actionPlans` in both catalogues) pointing at `/tracking/planes`, a page
   * they can open. Two different systems, one label, and a sentence telling them the thing
   * on their own sidebar belongs to somebody else.
   *
   * Renaming the tracking row is not this issue's to do — "planes de acción" is the
   * client's own §7 vocabulary, and the catalogues are additive-only tonight — so the copy
   * says which plans it means instead: the ones raised from survey findings, which is what
   * the sentence above it already tells the reader.
   */
  it('says which plans it means, since the sidebar has a row by the same name', async () => {
    serves(team())
    renderView()

    await screen.findByText('Overdue action plans')
    const body = screen.getByText(/come from survey findings/i).textContent ?? ''
    expect(body).toMatch(/survey findings/i)
    // The instruction that made it contradictory: "ask *yours*", of a screen they have a
    // same-named row for.
    expect(body).not.toMatch(/ask yours/i)
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

    /**
     * The whole substance of the fix is that this is **not an error**.
     *
     * What it replaced was a red panel; what the reader gets now is a blue band stating a
     * fact. Both of those survive a test that only asks whether the sentence is on screen,
     * so review turned the notice back into `variant="destructive" role="alert"` — a red
     * interrupting announcement saying the same words — and nothing failed. These assert
     * the two things a reader and a screen-reader user actually receive.
     */
    it('states it, rather than reporting it as a failure', async () => {
      serves('none')
      renderView()

      const title = await screen.findByText('You are not assigned to a team yet')
      const notice = title.closest('[data-slot="alert"]')
      expect(notice).not.toBeNull()
      expect(notice?.getAttribute('data-variant')).toBe('info')
      // `status` announces politely when the reader gets there; `alert` interrupts them.
      expect(notice?.getAttribute('role')).toBe('status')
      // And nothing on the page claims a failure.
      expect(screen.queryByText('Unable to fetch dashboard data')).toBeNull()
    })

    /**
     * The notice sits above `DashboardState` so it survives that request failing, which is
     * what `EmployeeDashboardView`'s own comment promises — and nothing asserted it, so
     * moving `{notice}` inside the `{data && …}` branch passed the suite. The combination
     * is reachable: the employee endpoint is a separate call that can 500 on its own.
     */
    it('stays on screen when the work below it fails to load', async () => {
      serves('none', 500)
      renderView()

      // Present before the work below has settled — which is the guarantee: the reason
      // this page is the one being shown does not depend on that request at all.
      expect(await screen.findByText('You are not assigned to a team yet')).toBeTruthy()
      // And still present once it has failed. One screen, both true things.
      expect(await screen.findByText('Unable to fetch dashboard data')).toBeTruthy()
      expect(screen.getByText('You are not assigned to a team yet')).toBeTruthy()
    })

    /**
     * AC5, "translated in both languages", asserted on the rendered Spanish rather than on
     * the catalogue having a key. `catalogues.test.ts` checks parity, non-emptiness and
     * placeholders — never that the Spanish differs from the English — so replacing both
     * new `es` values with their English text passed the suite.
     *
     * The register is `usted`, matching every second-person string this notice renders
     * beside: `employee.homeDescription` ("Hay una encuesta abierta para usted"),
     * `homeDescriptionNothingDue`, `dashboard.noPendingSurveys`, `noPendingSurveysDescription`.
     * It shipped as `tú` ("Todavía no tienes…") directly under "para usted".
     */
    it('is Spanish on a Spanish page, in the register of the page it renders on', async () => {
      serves('none')
      renderView('es')

      expect(await screen.findByText('Todavía no tiene un equipo asignado')).toBeTruthy()
      const body = screen.getByText(/Su cuenta no tiene departamento/)
      expect(body.textContent).toMatch(/puede asignarle uno/)
      // The English it must not be, and the `tú` it must not be either.
      expect(screen.queryByText('You are not assigned to a team yet')).toBeNull()
      expect(body.textContent).not.toMatch(/\btu cuenta\b|mostrarte|asignarte/i)
    })
  })

  /**
   * The other 400, and the screen this slice claimed to have removed but had only moved.
   *
   * `DepartmentAdminAsync` sends `ActingUserRequired()` when the token resolves to no user
   * row at all, and every 400 was being read as "no department". `EmployeeAsync` resolves
   * the same row and returns the same 400, so the fallback stacked a calm blue band
   * asserting a false cause on top of a red panel containing the server's raw English
   * string over a dead Retry — photographed in review, both endpoints answering 400.
   */
  describe('when the token resolves to no user record at all', () => {
    it('says the one true thing, and does not claim they have no department', async () => {
      serves('orphan')
      renderView()

      expect(await screen.findByText('We cannot find your account')).toBeTruthy()
      expect(screen.queryByText('You are not assigned to a team yet')).toBeNull()
    })

    it('shows no raw server string and no retry that could not work', async () => {
      serves('orphan')
      renderView()

      await screen.findByText('We cannot find your account')
      expect(screen.queryByText(NO_USER_RECORD_MESSAGE)).toBeNull()
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
      expect(screen.queryByText('Unable to fetch dashboard data')).toBeNull()
    })

    it('is Spanish on a Spanish page', async () => {
      serves('orphan')
      renderView('es')

      expect(await screen.findByText('No encontramos su cuenta')).toBeTruthy()
      expect(screen.queryByText(NO_USER_RECORD_MESSAGE)).toBeNull()
    })
  })
})
