import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import CompanyAdminDashboardView from './CompanyAdminDashboardView'
import { TranslationProvider } from '../../../i18n'
import { CompanyContextProvider } from '../../../company-context'
import { setToken } from '../../../auth/token'
import type { CompanyAdminDashboard } from '../api/dashboard'
import { tokenFor as tokenForClaims } from '../../../test/jwtFixture'

/**
 * The company view `/dashboard` drew until the redesign replaced it with
 * `../next/AdminDashboardNextView` — the module comment on the view says why it is still
 * in the tree. Rendered directly, because nothing routes to it any more: these cases moved
 * out of `DashboardPage.test.tsx` when the page stopped mounting it, and they pin what the
 * wiring of `useAdminDashboardModel` has to reproduce — the request it makes, the readings
 * it derives from the payload, and the floor it honours.
 */

function tokenFor(role: string, companyId = 'c1'): string {
  return tokenForClaims({ role, companyId })
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

/**
 * Answers `fetch` with a fresh `Response` on every call — a body may be read once, so a
 * shared instance would hand every reader after the first a consumed body.
 */
function serves(dashboard: unknown, { status = 200 }: { status?: number } = {}): void {
  vi.mocked(fetch).mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify(dashboard), { status })),
  )
}

/** The view as `DashboardPage` mounted it: `companyId` only for a SuperAdmin. */
function renderView(companyId?: string) {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/dashboard']}>
        <CompanyContextProvider>
          <CompanyAdminDashboardView companyId={companyId} />
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

/** Every URL the view has asked for, in call order. */
function requestedPaths(): string[] {
  return vi.mocked(fetch).mock.calls.map(([url]) => String(url))
}

/** The ambient zone, so a case that sets its own can put it back. */
const AMBIENT_TZ = process.env.TZ

describe('CompanyAdminDashboardView', () => {
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
   * The request — the half of this file the wiring will copy. A SuperAdmin has no tenant
   * of their own and names one; `GET /dashboard/company-admin` accepts an explicit
   * `companyId` from that role for exactly this. A CompanyAdmin sends none, and the
   * absence is the point: their scope is their claim, decided by the server, and a client
   * that helpfully sent its own idea of the tenant would be choosing a scope, which is the
   * shape the endpoint refuses.
   */
  it('asks the tenant endpoint with the company a super_admin named', async () => {
    setToken(tokenFor('super_admin', ''))
    serves(companyPayload())

    renderView('c9')

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(requestedPaths()).toEqual([expect.stringContaining('/dashboard/company-admin?companyId=c9')])
  })

  it('asks the tenant endpoint for a company_admin, and sends no company id', async () => {
    setToken(tokenFor('company_admin', 'c1'))
    serves(companyPayload())

    renderView()

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(requestedPaths()).toHaveLength(1)
    expect(requestedPaths()[0]).toContain('/dashboard/company-admin')
    expect(requestedPaths()[0]).not.toContain('companyId')
    // The tenant's name is the eyebrow above the title, not the title: the page is always
    // "Dashboard", and what changes between two visits is which company it is about.
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeTruthy()
    expect(screen.getByText('Acme Corporation')).toBeTruthy()
  })

  it('still shows the company dashboard both participation columns, which are its own scope', async () => {
    setToken(tokenFor('company_admin', 'c1'))
    serves(companyPayload())

    renderView()

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

    renderView()

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

    renderView()

    const link = await screen.findByRole('link', { name: 'Company-wide pulse' })
    expect(link.getAttribute('href')).toBe('/surveys/s1')
  })

  /* -------------------------------------------------------------------------
   * The map, the finding, the actions and the cycle.
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

    renderView()

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

    renderView()

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

    renderView()

    const finding = await screen.findByText(/Engineering is behind the organisation/)
    // `textContent`, not `getByText`: the readings inside the sentence are now their
    // own mono spans, so the sentence is several nodes rather than one text node.
    expect(finding.parentElement?.textContent).toContain(
      '5 completed responses across the 6 people in Engineering',
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

    renderView()

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

    const { container } = renderView()

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

    renderView()

    const finding = await screen.findByText(/Engineering is behind the organisation/)
    const evidence = finding.nextElementSibling as HTMLElement
    expect(
      [...evidence.querySelectorAll('.font-mono.tabular-nums')].map((node) => node.textContent),
    ).toEqual(['5', '6', '83', '150'])
    // The sentence still reads as one sentence, and the marker never reaches the page.
    expect(evidence.textContent).toBe(
      '5 completed responses across the 6 people in Engineering, over every survey — 83 per 100 people, against 150 across the organisation.',
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

    renderView()

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

    renderView()

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

    renderView()

    expect(await screen.findByText('No Departments Yet')).toBeTruthy()
    expect(screen.queryByText('No department can be measured yet')).toBeNull()
  })

  it('offers three quick actions that all land somewhere that exists', async () => {
    setToken(tokenFor('company_admin', 'c1'))
    serves(companyPayload())

    renderView()

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

    renderView()

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

    renderView()

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

    renderView()

    const cycle = await screen.findByRole('list', { name: 'Steps of the survey cycle' })
    expect(within(cycle).getByText(/^still open, past /).textContent).toContain('Feb 1')
    expect(screen.getByRole('cell', { name: 'Feb 1' })).toBeTruthy()
  })

})
