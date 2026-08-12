import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import DepartmentsPage from './DepartmentsPage'
import { TranslationProvider } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../company-context'
import type { Department } from '../api/departments'

function tokenFor(claims: Record<string, unknown>): string {
  const body = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `header.${body}.signature`
}

const OWN = 'company-1'

function department(overrides: Partial<Department> = {}): Department {
  return {
    id: 'd1',
    companyId: OWN,
    name: 'Engineering',
    description: 'Builds the product',
    parentDepartmentId: null,
    isActive: true,
    employeeCount: 12,
    ...overrides,
  }
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter>
        <CompanyContextProvider>
          <DepartmentsPage />
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

/**
 * Answers the list endpoint with whatever `rows()` currently returns.
 *
 * Everything else 404s, including `GET /dashboard/company-admin` — which is the
 * page's *optional* half, so these tests double as the check that losing it costs
 * the reading and nothing else.
 */
function serveList(rows: () => Department[]) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
    if (/\/admin\/departments\?/.test(String(input))) {
      return Promise.resolve(new Response(JSON.stringify({ departments: rows() }), { status: 200 }))
    }
    return Promise.resolve(new Response(null, { status: 404 }))
  })
}

/** One department's line in `GET /dashboard/company-admin`. */
interface Reading {
  id: string
  name: string
  memberCount: number
  completedResponseCount: number
}

/** Serves both halves: the department list, and the response counts behind it. */
function serveListAndReadings(rows: () => Department[], readings: () => Reading[]) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    if (/\/admin\/departments\?/.test(url)) {
      return Promise.resolve(new Response(JSON.stringify({ departments: rows() }), { status: 200 }))
    }
    if (/\/dashboard\/company-admin/.test(url)) {
      return Promise.resolve(
        new Response(JSON.stringify({ companyId: OWN, departments: readings() }), { status: 200 }),
      )
    }
    return Promise.resolve(new Response(null, { status: 404 }))
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  setToken(tokenFor({ role: 'company_admin', companyId: OWN }))
})

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  vi.unstubAllGlobals()
})

describe('DepartmentsPage scoping', () => {
  it('asks the API for the company_admin own company, taken from the claim', async () => {
    serveList(() => [department()])

    renderPage()

    expect(await screen.findByText('Engineering')).toBeTruthy()
    const urls = vi.mocked(fetch).mock.calls.map((call) => String(call[0]))
    expect(urls.some((url) => url.includes(`companyId=${OWN}`))).toBe(true)
  })

  it('refuses to guess a company for a super_admin who has selected none', async () => {
    // `GET /admin/departments` takes companyId as a REQUIRED query parameter, so
    // there is no cross-company answer to fall back on. Ask, do not guess (#124).
    clearToken()
    setToken(tokenFor({ role: 'super_admin', companyId: '' }))
    serveList(() => [department()])

    renderPage()

    expect(await screen.findByText('Choose a company')).toBeTruthy()
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('never falls back to a super_admin own companyId claim', async () => {
    clearToken()
    setToken(tokenFor({ role: 'super_admin', companyId: 'their-own-row' }))
    serveList(() => [department()])

    renderPage()

    expect(await screen.findByText('Choose a company')).toBeTruthy()
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('loads the company a super_admin selected', async () => {
    clearToken()
    setToken(tokenFor({ role: 'super_admin', companyId: '' }))
    localStorage.setItem(COMPANY_CONTEXT_STORAGE_KEY, 'chosen-co')
    serveList(() => [department({ companyId: 'chosen-co', name: 'Operations' })])

    renderPage()

    expect(await screen.findByText('Operations')).toBeTruthy()
    const urls = vi.mocked(fetch).mock.calls.map((call) => String(call[0]))
    expect(urls.some((url) => url.includes('companyId=chosen-co'))).toBe(true)
  })
})

describe('DepartmentsPage states', () => {
  it('separates a 200-with-no-rows from a failed request', async () => {
    serveList(() => [])
    renderPage()

    expect(await screen.findByText('No departments yet.')).toBeTruthy()
    expect(screen.queryByText('Failed to load departments. Please try again.')).toBeNull()
  })

  it('shows an error with a retry, not an empty state, when the request fails', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403 }))

    renderPage()

    expect(await screen.findByText('Failed to load departments. Please try again.')).toBeTruthy()
    expect(screen.queryByText('No departments yet.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('re-requests the list when retried', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403 }))
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }))

    // Counts calls to the LIST endpoint, not calls in total. One load is now two
    // requests -- the list and the readings -- so `length > 1` would be satisfied
    // by the first render alone and this test could no longer fail.
    await waitFor(() => {
      const listCalls = vi
        .mocked(fetch)
        .mock.calls.filter((call) => /\/admin\/departments\?/.test(String(call[0])))
      expect(listCalls.length).toBeGreaterThan(1)
    })
  })
})

describe('DepartmentsPage listing', () => {
  it('renders rows in the Table primitive with a resolved parent name', async () => {
    serveList(() => [
      department({ id: 'parent', name: 'Engineering' }),
      department({ id: 'child', name: 'Platform', parentDepartmentId: 'parent', employeeCount: 4 }),
    ])

    renderPage()

    const row = (await screen.findByText('Platform')).closest('tr')
    expect(row).toBeTruthy()
    // The name, never the raw GUID.
    expect(within(row!).getByText('Engineering')).toBeTruthy()
    expect(within(row!).queryByText('parent')).toBeNull()
  })

  it('labels an inactive department in words, not by colour alone', async () => {
    serveList(() => [department({ isActive: false })])

    renderPage()

    const row = (await screen.findByText('Engineering')).closest('tr')
    expect(within(row!).getByText('Inactive')).toBeTruthy()
  })

  it('keeps a hidden parent name resolvable while filtering', async () => {
    // The parent is inactive and the toggle hides it, but the child still knows
    // whose child it is — resolving against the visible rows alone would blank it.
    serveList(() => [
      department({ id: 'parent', name: 'Engineering', isActive: false }),
      department({ id: 'child', name: 'Platform', parentDepartmentId: 'parent' }),
    ])

    renderPage()
    await screen.findByText('Platform')
    await userEvent.click(screen.getByLabelText('Show inactive'))

    const row = screen.getByText('Platform').closest('tr')
    expect(within(row!).getByText('Engineering')).toBeTruthy()
  })

  it('keeps a hidden parent’s child indented, rather than re-rooting it', async () => {
    // The other half of the same guarantee, and the half nothing covered.
    // `DepartmentList` calls `departmentRows(departments, structure)`; that second
    // argument is what makes depth a property of the whole company rather than of
    // whatever survived the filter. Dropping it left this page's suite AND
    // `departmentHierarchy`'s green — the helper is exercised with both arguments
    // directly, and the assertion above reads the Parent column, which resolves
    // through a different map (`byId` from `parentLookup`) than the indent does.
    //
    // Without it, hiding the inactive parent promotes Platform to a root and its
    // indent guide disappears, so the tree silently reshapes itself while you type.
    serveList(() => [
      department({ id: 'parent', name: 'Engineering', isActive: false }),
      department({ id: 'child', name: 'Platform', parentDepartmentId: 'parent' }),
    ])

    renderPage()
    await screen.findByText('Platform')
    await userEvent.click(screen.getByLabelText('Show inactive'))

    const row = screen.getByText('Platform').closest('tr')
    // One guide span per level, so the count IS the depth. Still 1 with the parent
    // filtered out of the rendered rows.
    expect(row!.querySelectorAll('span[aria-hidden="true"] > span')).toHaveLength(1)
  })

  it('filters by search and says so rather than claiming there are none', async () => {
    serveList(() => [
      department({ id: 'a', name: 'Engineering' }),
      department({ id: 'b', name: 'Finance' }),
    ])

    renderPage()
    await screen.findByText('Engineering')
    await userEvent.type(screen.getByLabelText('Search'), 'zzz')

    expect(await screen.findByText('No departments found')).toBeTruthy()
    // Not the "nothing exists yet" copy — the company has two departments.
    expect(screen.queryByText('No departments yet.')).toBeNull()
  })
})

describe('DepartmentsPage create and edit', () => {
  it('creates a department and reloads the list', async () => {
    const rows: Department[] = []
    vi.mocked(fetch).mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const created = department({ id: 'new', name: 'Finance', description: '', employeeCount: 0 })
        rows.push(created)
        return Promise.resolve(new Response(JSON.stringify(created), { status: 201 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ departments: rows }), { status: 200 }))
    })

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'New department' }))
    await userEvent.type(screen.getByLabelText(/Name/), 'Finance')
    await userEvent.click(screen.getByRole('button', { name: 'Create Department' }))

    expect(await screen.findByText('Finance')).toBeTruthy()

    const post = vi.mocked(fetch).mock.calls.find((call) => call[1]?.method === 'POST')
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({ companyId: OWN, name: 'Finance', isActive: true })
  })

  it('omits an empty description rather than sending a zero-length one', async () => {
    vi.mocked(fetch).mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify(department()), { status: 201 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ departments: [] }), { status: 200 }))
    })

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'New department' }))
    await userEvent.type(screen.getByLabelText(/Name/), 'Finance')
    await userEvent.click(screen.getByRole('button', { name: 'Create Department' }))

    await waitFor(() => {
      expect(vi.mocked(fetch).mock.calls.some((call) => call[1]?.method === 'POST')).toBe(true)
    })
    const post = vi.mocked(fetch).mock.calls.find((call) => call[1]?.method === 'POST')
    expect(Object.hasOwn(JSON.parse(String(post?.[1]?.body)), 'description')).toBe(false)
  })

  it('surfaces the server validation message instead of a generic one', async () => {
    vi.mocked(fetch).mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify({ message: 'Department with this name already exists at this level' }), { status: 400 }),
        )
      }
      return Promise.resolve(new Response(JSON.stringify({ departments: [department()] }), { status: 200 }))
    })

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'New department' }))
    await userEvent.type(screen.getByLabelText(/Name/), 'Engineering')
    await userEvent.click(screen.getByRole('button', { name: 'Create Department' }))

    expect(await screen.findByText('Department with this name already exists at this level')).toBeTruthy()
  })

  it('sends only the three fields PUT accepts, and locks the parent selector', async () => {
    vi.mocked(fetch).mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return Promise.resolve(new Response(JSON.stringify(department({ name: 'Engineering & Platform' })), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ departments: [department()] }), { status: 200 }))
    })

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))

    // `UpdateDepartmentRequest` has no ParentDepartmentId field, so offering an
    // editable control here would silently discard the change.
    expect(screen.getByLabelText('Parent Department')).toHaveProperty('disabled', true)

    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    const put = vi.mocked(fetch).mock.calls.find((call) => call[1]?.method === 'PUT')
    expect(Object.keys(JSON.parse(String(put?.[1]?.body))).sort()).toEqual(['description', 'isActive', 'name'])
  })
})

describe('DepartmentsPage as an instrument', () => {
  it('sets every reading in the mono, tabular face and leaves the names in the sans one', () => {
    // The one typographic rule the whole redesign turns on. happy-dom does no
    // layout, so the class list is what is checkable here — and a number that is
    // NOT in the mono face is the defect, so both halves are asserted.
    serveList(() => [department({ name: 'Engineering', employeeCount: 57 })])

    renderPage()

    return screen.findByText('Engineering').then((name) => {
      const row = name.closest('tr')!
      const people = within(row).getByText('57')
      expect(people.className).toContain('font-mono')
      expect(people.className).toContain('tabular-nums')
      expect(name.className).not.toContain('font-mono')
    })
  })

  it('says a department under the floor can never be reported on its own', async () => {
    serveList(() => [department({ name: 'Finance', employeeCount: 4 })])

    renderPage()

    const row = (await screen.findByText('Finance')).closest('tr')!
    expect(within(row).getByText('Under 5')).toBeTruthy()
    // The headcount itself is not secret -- it is org structure, not a response.
    expect(within(row).getByText('4')).toBeTruthy()
  })

  it('marks a department that clears the floor as reportable, in a word', async () => {
    serveList(() => [department({ name: 'Engineering', employeeCount: 57 })])

    renderPage()

    const row = (await screen.findByText('Engineering')).closest('tr')!
    expect(within(row).getByText('Yes')).toBeTruthy()
    expect(within(row).queryByText('Under 5')).toBeNull()
  })

  it('protects a response reading under the floor instead of blanking it', async () => {
    // 3 responses from 48 people. The cell must be shown as withheld -- an empty
    // cell reads as missing data rather than as a guarantee being enforced.
    serveListAndReadings(
      () => [department({ id: 'sup', name: 'Support', employeeCount: 48 })],
      () => [{ id: 'sup', name: 'Support', memberCount: 48, completedResponseCount: 3 }],
    )

    renderPage()

    const row = (await screen.findByText('Support')).closest('tr')!
    const protectedCell = within(row).getByRole('img')
    expect(protectedCell.getAttribute('aria-label')).toContain('protected')
    // And it never says how far under the floor it is: publishing "3" beside a
    // known headcount is exactly what the floor exists to prevent.
    expect(row.textContent).not.toContain('3')
    expect(protectedCell.getAttribute('aria-label')).not.toContain('3')
  })

  it('shows the response count once the floor is met', async () => {
    serveListAndReadings(
      () => [department({ id: 'eng', name: 'Engineering', employeeCount: 48 })],
      () => [{ id: 'eng', name: 'Engineering', memberCount: 48, completedResponseCount: 24 }],
    )

    renderPage()

    const row = (await screen.findByText('Engineering')).closest('tr')!
    const reading = within(row).getByText('24')
    expect(reading.className).toContain('font-mono')
    expect(reading.className).toContain('tabular-nums')
    expect(within(row).queryByRole('img')).toBeNull()
  })

  it('reports the responses as a count and never as a share of the headcount', async () => {
    // `completedResponseCount` carries no survey predicate in
    // `DashboardQueries.DepartmentSummaries`, so it is every completed response
    // the department has ever submitted and it passes the headcount as soon as a
    // company runs its second survey. Divided by `memberCount` this row read
    // "270%" against a progress bar pinned at 100 — the two contradicting each
    // other on the screen's only measured column.
    serveListAndReadings(
      () => [department({ id: 'ops', name: 'Operations', employeeCount: 40 })],
      () => [{ id: 'ops', name: 'Operations', memberCount: 40, completedResponseCount: 108 }],
    )

    renderPage()

    const row = (await screen.findByText('Operations')).closest('tr')!
    expect(within(row).getByText('108')).toBeTruthy()
    expect(row.textContent).not.toContain('%')
    // And nothing claims a scale it does not have.
    expect(within(row).queryByRole('progressbar')).toBeNull()
    // The units are stated once, in the column header, so the count cannot be
    // mistaken for a rate.
    expect(screen.getByText('completed, all surveys')).toBeTruthy()
  })

  it('reads a department the dashboard did not report on as unmeasured, never as protected', async () => {
    // `DashboardEndpoints.cs` caps the summary list at `DepartmentRowLimit = 12`
    // with no total and no truncation flag, so a thirteenth department simply has
    // no line in the payload. Calling that zero put a padlock and the words
    // "protected -- withheld below 5 responses" on data the app never asked for.
    serveListAndReadings(
      () => [
        department({ id: 'seen', name: 'Engineering', employeeCount: 40 }),
        department({ id: 'unseen', name: 'Research', employeeCount: 40 }),
      ],
      () => [{ id: 'seen', name: 'Engineering', memberCount: 40, completedResponseCount: 33 }],
    )

    renderPage()

    const row = (await screen.findByText('Research')).closest('tr')!
    expect(within(row).getByText('Not measured')).toBeTruthy()
    expect(within(row).queryByRole('img')).toBeNull()
    expect(row.textContent).not.toContain('protected')
    // The department that *was* reported on is unaffected.
    const measured = screen.getByText('Engineering').closest('tr')!
    expect(within(measured).getByText('33')).toBeTruthy()
  })

  it('still reads a department whose reported member count is zero', async () => {
    // The reading does not divide by anything any more, so a zero headcount on
    // the dashboard line cannot blank the cell. It used to: `?? employeeCount`
    // never fired, because 0 is not nullish, and the row rendered an em dash.
    serveListAndReadings(
      () => [department({ id: 'ghost', name: 'Ghost', employeeCount: 30 })],
      () => [{ id: 'ghost', name: 'Ghost', memberCount: 0, completedResponseCount: 9 }],
    )

    renderPage()

    const row = (await screen.findByText('Ghost')).closest('tr')!
    // Name, Parent, People, Reportable, Responses, Actions. Read by position so
    // the assertion is about the measured cell and not about the em dash the
    // Parent column legitimately carries for a root department.
    const responsesCell = within(row).getAllByRole('cell')[4]
    expect(responsesCell.textContent).toBe('9')
    expect(within(responsesCell).getByText('9').className).toContain('font-mono')
  })

  it('drops the responses column rather than filling it with zeroes when the readings fail', async () => {
    // `serveList` 404s the dashboard. A column of zeroes would claim a measurement
    // that was never taken.
    serveList(() => [department({ name: 'Engineering' })])

    renderPage()
    await screen.findByText('Engineering')

    expect(screen.queryByText('Responses')).toBeNull()
    expect(screen.queryByText('completed, all surveys')).toBeNull()
    // The list itself is unaffected: the optional half failing is not a page error.
    expect(screen.getByText('People')).toBeTruthy()
    expect(screen.queryByText('Failed to load departments. Please try again.')).toBeNull()
  })

  it('orders a child directly under its parent rather than alphabetically', async () => {
    serveList(() => [
      // Alphabetical, the order the API sends: the child of Alpha sorts before Beta.
      department({ id: 'alpha', name: 'Alpha' }),
      department({ id: 'beta', name: 'Beta' }),
      department({ id: 'child', name: 'Zeta', parentDepartmentId: 'alpha' }),
    ])

    renderPage()
    // "Alpha" is on screen twice: as a row, and as the child's resolved parent.
    await screen.findAllByText('Alpha')

    const names = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[0].querySelector('.font-medium')?.textContent)
    expect(names).toEqual(['Alpha', 'Zeta', 'Beta'])
  })

  it('counts the departments that can never be reported on their own', async () => {
    serveList(() => [
      department({ id: 'a', name: 'Alpha', employeeCount: 40 }),
      department({ id: 'b', name: 'Beta', employeeCount: 4 }),
      department({ id: 'c', name: 'Gamma', employeeCount: 1 }),
    ])

    renderPage()
    await screen.findByText('Alpha')

    // `.parentElement`, not `.closest('div')` -- the label IS a div, so `closest`
    // returns the label itself and the assertion would look inside the wrong box.
    const tile = screen.getByText('Under the floor').parentElement!
    expect(within(tile).getByText('2')).toBeTruthy()
  })
})
