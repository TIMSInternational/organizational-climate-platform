import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import ActionPlansListPage from './ActionPlansListPage'
import type { ActionPlan } from '../api/actionPlans'
import { TranslationProvider } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../company-context'

/**
 * #124. This page is the one every other lane's TODO pointed at: it was the
 * documented example of a SuperAdmin being silently scoped to whatever company
 * their own user row pointed at, and it was blocked outright rather than fixed.
 *
 * These tests pin the two halves of the replacement — a SuperAdmin is *asked*
 * rather than guessed at, and a CompanyAdmin is unaffected by anything the
 * selector stores.
 */

function tokenFor(claims: Record<string, unknown>): string {
  const body = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `header.${body}.signature`
}

function routeFetch() {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    const body = url.includes('/action-plan-templates')
      ? { templates: [] }
      : { actionPlans: [{ id: 'p1', title: 'Raise engagement', companyId: 'chosen-co', departmentId: null, dueDate: '2026-12-01T00:00:00Z', status: 'not_started', priority: 'high', createdAt: '2026-01-01T00:00:00Z' }] }
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
  })
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter>
        <CompanyContextProvider>
          <ActionPlansListPage />
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  routeFetch()
})

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  vi.unstubAllGlobals()
})

describe('ActionPlansListPage company scoping', () => {
  it('asks a super_admin which company they mean rather than picking one', async () => {
    setToken(tokenFor({ role: 'super_admin', companyId: '' }))
    renderPage()

    expect(await screen.findByText('Choose a company')).toBeTruthy()
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('never falls back to a super_admin own companyId claim', async () => {
    // The exact defect the old block comment described: a super_admin whose user
    // row does point at a company would have been scoped to it, silently, and any
    // plan they created would have been filed under it.
    setToken(tokenFor({ role: 'super_admin', companyId: 'their-own-row' }))
    renderPage()

    expect(await screen.findByText('Choose a company')).toBeTruthy()
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('loads the company a super_admin selected, and asks the API for that one', async () => {
    setToken(tokenFor({ role: 'super_admin', companyId: 'their-own-row' }))
    localStorage.setItem(COMPANY_CONTEXT_STORAGE_KEY, 'chosen-co')
    renderPage()

    expect(await screen.findByText('Raise engagement')).toBeTruthy()
    const urls = vi.mocked(fetch).mock.calls.map((call) => String(call[0]))
    expect(urls.some((url) => url.includes('companyId=chosen-co'))).toBe(true)
    expect(urls.some((url) => url.includes('their-own-row'))).toBe(false)
  })

  it('scopes a company_admin to their own claim, ignoring any stored selection', async () => {
    // The client half of the escalation guard. `CanAccessCompany` on the API is the
    // boundary; this asserts the UI does not even try.
    localStorage.setItem(COMPANY_CONTEXT_STORAGE_KEY, 'someone-elses-co')
    setToken(tokenFor({ role: 'company_admin', companyId: 'their-co' }))
    renderPage()

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled())
    const urls = vi.mocked(fetch).mock.calls.map((call) => String(call[0]))
    expect(urls.every((url) => url.includes('companyId=their-co'))).toBe(true)
    expect(urls.some((url) => url.includes('someone-elses-co'))).toBe(false)
  })

  it('still says so for a company_admin whose token names no tenant', async () => {
    setToken(tokenFor({ role: 'company_admin', companyId: '' }))
    renderPage()

    // Not "choose a company": there is nothing for this role to choose from.
    expect((await screen.findByRole('alert')).textContent).toBe(
      'No company is associated with your account.',
    )
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })
})

/**
 * The listing surface itself: filtering, states, and the create flow.
 *
 * Separate from the scoping block above because these assume a company is already
 * resolved -- a `company_admin` whose claim names one -- and are about what the page
 * does *with* the rows rather than about which rows it is allowed to ask for.
 */
function plan(overrides: Partial<ActionPlan> = {}): ActionPlan {
  return {
    id: 'p1',
    title: 'Raise engagement',
    companyId: 'their-co',
    departmentId: null,
    dueDate: '2026-12-01T00:00:00.000Z',
    status: 'not_started',
    priority: 'high',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

/** A fresh `Response` per call — a body can only be read once. */
function routePlans(plans: ActionPlan[], departments: { id: string; name: string }[] = []) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/action-plan-templates')) {
      return Promise.resolve(new Response(JSON.stringify({ templates: [] }), { status: 200 }))
    }
    if (url.includes('/admin/departments')) {
      return Promise.resolve(new Response(JSON.stringify({ departments }), { status: 200 }))
    }
    if (init?.method === 'POST') {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ...plan({ id: 'new-1', title: 'Reduce attrition' }),
            description: 'd',
            createdBy: 'u1',
            tags: [],
            templateId: null,
            kpis: [],
            objectives: [],
          }),
          { status: 201 },
        ),
      )
    }
    return Promise.resolve(new Response(JSON.stringify({ actionPlans: plans }), { status: 200 }))
  })
}

/**
 * The KPI tile whose label is `label`.
 *
 * Matched on the label element specifically — `Completed` is also a status badge
 * in the table and an option in the status filter, so a bare `getByText` finds
 * three of them.
 */
function kpiTile(label: string): HTMLElement {
  const heading = screen
    .getAllByText(label)
    .find((node) => node.className.includes('tracking-label'))
  if (!heading?.parentElement) throw new Error(`no KPI tile labelled ${label}`)
  return heading.parentElement
}

function planUrls(): string[] {
  return vi
    .mocked(fetch)
    .mock.calls.map((call) => String(call[0]))
    .filter((url) => url.includes('/action-plans?'))
}

describe('ActionPlansListPage listing surface', () => {
  beforeEach(() => {
    setToken(tokenFor({ role: 'company_admin', companyId: 'their-co' }))
  })

  it('renders translated status and priority rather than the wire enums', async () => {
    routePlans([plan()])
    renderPage()

    expect(await screen.findByText('Raise engagement')).toBeTruthy()
    expect(screen.queryByText('not_started')).toBeNull()
    // Scoped to the table: the filter selects legitimately carry the same labels as
    // their <option> text, so an unscoped query matches those too.
    const row = within(screen.getByRole('table'))
    expect(row.getByText('Not Started')).toBeTruthy()
    expect(row.getByText('High')).toBeTruthy()
  })

  it('asks the server for a status filter instead of narrowing the array', async () => {
    // `ListAsync` already applies this predicate in the database. Filtering the
    // fetched array instead would be a second implementation of a rule the server
    // owns, and would silently become "filters the current page" the day this
    // endpoint grows paging.
    routePlans([plan()])
    renderPage()
    await screen.findByText('Raise engagement')

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'in_progress')

    await waitFor(() => {
      expect(planUrls().some((url) => url.includes('status=in_progress'))).toBe(true)
    })
  })

  it('narrows priority and search in the browser, with no extra request', async () => {
    // `ListAsync` has no parameter for either, so a query-string field would be
    // silently ignored. Exact rather than approximate only because that endpoint
    // returns the company's complete set in one response.
    routePlans([plan(), plan({ id: 'p2', title: 'Reduce attrition', priority: 'low' })])
    renderPage()
    await screen.findByText('Raise engagement')
    const requestsBefore = planUrls().length

    await userEvent.selectOptions(screen.getByLabelText('Priority'), 'low')
    expect(screen.queryByText('Raise engagement')).toBeNull()
    expect(screen.getByText('Reduce attrition')).toBeTruthy()

    await userEvent.selectOptions(screen.getByLabelText('Priority'), '')
    await userEvent.type(screen.getByLabelText('Search'), 'engage')
    expect(screen.getByText('Raise engagement')).toBeTruthy()
    expect(screen.queryByText('Reduce attrition')).toBeNull()

    expect(planUrls().length).toBe(requestsBefore)
  })

  it('tells an empty company how to start, and a filtered one to adjust', async () => {
    routePlans([])
    renderPage()

    expect(await screen.findByText('No action plans found.')).toBeTruthy()
    expect(screen.getByText('Create the first action plan for this company.')).toBeTruthy()

    await userEvent.type(screen.getByLabelText('Search'), 'nothing matches this')
    expect(screen.getByText('Try adjusting the filters above.')).toBeTruthy()
  })

  it('offers a retry when the listing fails to load', async () => {
    routePlans([plan()])
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Service unavailable' }), { status: 503 }),
    )
    renderPage()

    const retry = await screen.findByRole('button', { name: 'Retry' })
    expect(screen.getByText('Service unavailable')).toBeTruthy()

    await userEvent.click(retry)
    expect(await screen.findByText('Raise engagement')).toBeTruthy()
  })

  it('creates a plan and confirms it by name with a link to it', async () => {
    routePlans([plan()])
    renderPage()
    await screen.findByText('Raise engagement')

    await userEvent.click(screen.getByRole('button', { name: 'New action plan' }))
    await userEvent.type(screen.getByLabelText(/Plan Title/), 'Reduce attrition')
    await userEvent.type(screen.getByLabelText(/Description/), 'Cut voluntary exits')
    fireEvent.change(screen.getByLabelText('Due Date'), { target: { value: '2026-12-01' } })
    await userEvent.click(screen.getByRole('button', { name: 'Create Action Plan' }))

    const post = await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
      expect(call).toBeTruthy()
      return call!
    })
    const body = JSON.parse((post[1] as RequestInit).body as string)
    expect(body.title).toBe('Reduce attrition')
    expect(body.companyId).toBe('their-co')
    // The wire format `normalizeDueDate` pins: a bare date-only string would
    // deserialize as midnight in the server process's own offset.
    expect(body.dueDate).toBe('2026-12-01T00:00:00.000Z')
    // `CreateAsync` forces Status = "not_started", so the client never sends one.
    expect(body.status).toBeUndefined()

    const confirmation = await screen.findByText(/Action plan .*Reduce attrition.* created\./)
    expect(confirmation).toBeTruthy()
  })

  it('resolves the From column from the departments endpoint', async () => {
    // The link back to where the finding was measured. `GET /admin/departments`
    // is gated by the same `CanAccessCompany` rule as `GET /action-plans`, so this
    // adds no permission the page did not already need.
    routePlans([plan({ departmentId: 'd1' })], [{ id: 'd1', name: 'Support' }])
    renderPage()

    const from = await screen.findByRole('link', { name: /Measured in Support/ })
    expect(from.getAttribute('href')).toBe('/departments')
  })

  it('still lists the plans when the departments lookup fails', async () => {
    // Failing the whole page because one lookup table was unreachable would hide
    // every plan to avoid one missing chip.
    routePlans([plan({ departmentId: 'd1' })])
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/admin/departments')) return Promise.reject(new Error('down'))
      if (url.includes('/action-plan-templates')) {
        return Promise.resolve(new Response(JSON.stringify({ templates: [] }), { status: 200 }))
      }
      return Promise.resolve(
        new Response(JSON.stringify({ actionPlans: [plan({ departmentId: 'd1' })] }), { status: 200 }),
      )
    })
    renderPage()

    expect(await screen.findByText('Raise engagement')).toBeTruthy()
    expect(screen.getByText('Department not listed')).toBeTruthy()
  })

  it('reads the KPI strip off the whole company, not off the filtered table', async () => {
    // A strip wired to the filtered array still renders four plausible numbers,
    // which is exactly how a wrong one survives review.
    routePlans([
      plan({ id: 'p1', title: 'Raise engagement', status: 'in_progress', dueDate: '2099-12-01T00:00:00.000Z' }),
      plan({ id: 'p2', title: 'Reduce attrition', status: 'completed', priority: 'low' }),
    ])
    renderPage()
    await screen.findByText('Raise engagement')

    const strip = () => ({
      open: within(kpiTile('Open')).getByText('1'),
      completed: within(kpiTile('Completed')).getByText('1'),
    })
    expect(strip().open).toBeTruthy()
    expect(strip().completed).toBeTruthy()

    await userEvent.type(screen.getByLabelText('Search'), 'attrition')
    expect(screen.queryByText('Raise engagement')).toBeNull()

    // Unmoved: one open plan and one completed plan is still the truth about the
    // company, whatever the search box is showing.
    expect(strip().open).toBeTruthy()
    expect(strip().completed).toBeTruthy()
  })

  it('refuses to submit a blank KPI row, which the server would happily persist', async () => {
    // `CreateAsync` takes `request.Kpis` as given -- and there is no endpoint that
    // deletes a KPI, so a nameless row is permanent.
    routePlans([plan()])
    renderPage()
    await screen.findByText('Raise engagement')

    await userEvent.click(screen.getByRole('button', { name: 'New action plan' }))
    await userEvent.type(screen.getByLabelText(/Plan Title/), 'Reduce attrition')
    await userEvent.type(screen.getByLabelText(/Description/), 'Cut voluntary exits')
    fireEvent.change(screen.getByLabelText('Due Date'), { target: { value: '2026-12-01' } })
    await userEvent.click(screen.getByRole('button', { name: 'Add KPI' }))
    await userEvent.click(screen.getByRole('button', { name: 'Create Action Plan' }))

    expect(await screen.findByText('This field is required')).toBeTruthy()
    expect(
      vi.mocked(fetch).mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST'),
    ).toBe(false)
  })
})
