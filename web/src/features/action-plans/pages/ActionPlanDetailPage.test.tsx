import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router'
import { TranslationProvider } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import ActionPlanDetailPage from './ActionPlanDetailPage'
import type { ActionPlanDetail } from '../api/actionPlans'

/**
 * The real page is mounted rather than its components tested in isolation,
 * deliberately: #79 recorded five defects that a 516-test unit suite could not see
 * because nothing ever rendered a page.
 *
 * What these pin is the set of claims this page must not make. It must not print a
 * wire enum at a user, it must not blank itself when a *write* fails, it must not
 * post an update for a measure nobody touched, and it must not draw a progress bar
 * for a ratio that has no value.
 */
function detail(overrides: Partial<ActionPlanDetail> = {}): ActionPlanDetail {
  return {
    id: 'p1',
    title: 'Raise engagement',
    description: 'Lift the engagement index in Operations',
    companyId: 'c1',
    departmentId: null,
    createdBy: 'u1',
    dueDate: '2026-12-01T00:00:00.000Z',
    status: 'in_progress',
    priority: 'high',
    tags: [],
    templateId: null,
    kpis: [
      {
        id: 'k1',
        name: 'Engagement index',
        targetValue: 80,
        currentValue: 60,
        unit: 'pts',
        measurementFrequency: 'monthly',
      },
    ],
    objectives: [
      {
        id: 'o1',
        description: 'Run monthly one-to-ones',
        successCriteria: '90% coverage',
        currentStatus: 'in_progress',
        completionPercentage: 40,
      },
    ],
    ...overrides,
  }
}

function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

const PROGRESS_UPDATE = {
  id: 'pu1',
  updateDate: '2026-08-07T10:00:00Z',
  overallNotes: 'n',
  updatedBy: 'u1',
}

/**
 * A fresh `Response` per call, routed by method.
 *
 * `mockResolvedValue` cannot be used for the GET here: it hands back the *same*
 * `Response` object every time, and a body can only be read once -- so the refetch
 * that follows a progress submission would throw `body stream already read` and the
 * page would render a load error instead of the updated plan. That failure looks
 * exactly like a bug in the page.
 */
function routeFetch(plan: ActionPlanDetail = detail()) {
  vi.mocked(fetch).mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') return Promise.resolve(ok(PROGRESS_UPDATE, 201))
    return Promise.resolve(ok(plan))
  })
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/action-plans/p1']}>
        <Routes>
          <Route path="/action-plans/:id" element={<ActionPlanDetailPage />} />
        </Routes>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

beforeEach(() => {
  setToken('test-token')
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  clearToken()
  vi.unstubAllGlobals()
})

describe('ActionPlanDetailPage', () => {
  it('renders the plan with translated status, priority and measurement frequency', async () => {
    routeFetch()
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Raise engagement' })).toBeTruthy()
    // The defect this replaces: these three cells printed `in_progress`, `high` and
    // `monthly` -- the raw wire values -- as user-visible copy.
    expect(screen.queryByText('in_progress')).toBeNull()
    expect(screen.queryByText('high')).toBeNull()
    expect(screen.getAllByText('In Progress').length).toBeGreaterThan(0)
    expect(screen.getAllByText('High').length).toBeGreaterThan(0)
    expect(screen.getByText('Monthly')).toBeTruthy()
  })

  it('shows a retry on a failed load, and recovers with it', async () => {
    routeFetch()
    vi.mocked(fetch).mockResolvedValueOnce(ok({ message: 'Action plan not found' }, 404))
    renderPage()

    const retry = await screen.findByRole('button', { name: 'Retry' })
    expect(screen.getByText('Action plan not found')).toBeTruthy()

    await userEvent.click(retry)
    expect(await screen.findByRole('heading', { name: 'Raise engagement' })).toBeTruthy()
  })

  it('keeps the plan on screen when a write is refused', async () => {
    // `UpdateAsync` requires Roles.Admin while `GetAsync` does not, so a viewer who
    // can read this plan and not change it is a real case. Blanking the page would
    // take away the thing the refusal was about.
    routeFetch()
    renderPage()

    await screen.findByRole('heading', { name: 'Raise engagement' })
    vi.mocked(fetch).mockResolvedValueOnce(ok({ message: 'Invalid status: nope' }, 400))
    await userEvent.click(screen.getAllByRole('combobox')[0])
    await userEvent.click(await screen.findByRole('option', { name: 'Completed' }))

    expect(await screen.findByText('Invalid status: nope')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Raise engagement' })).toBeTruthy()
  })

  it('sends only the measures whose values actually moved', async () => {
    // The form is pre-filled with every current value. Submitting it unmodified used
    // to post an update for each one, and `RecordProgressAsync` writes a child row
    // per entry regardless of whether the number changed -- so the audit trail would
    // fill with rows recording that nothing happened.
    routeFetch()
    renderPage()
    await screen.findByRole('heading', { name: 'Raise engagement' })

    await userEvent.type(screen.getByRole('textbox', { name: /Notes/ }), 'Two sessions ran')
    await userEvent.click(screen.getByRole('button', { name: 'Record progress' }))

    const post = await waitFor(() => {
      const call = vi
        .mocked(fetch)
        .mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
      expect(call).toBeTruthy()
      return call!
    })
    const body = JSON.parse((post[1] as RequestInit).body as string)
    expect(body.overallNotes).toBe('Two sessions ran')
    expect(body.kpiUpdates).toEqual([])
    expect(body.objectiveUpdates).toEqual([])
  })

  it('sends the KPI that did move, and refetches after recording', async () => {
    routeFetch()
    renderPage()
    await screen.findByRole('heading', { name: 'Raise engagement' })
    const callsBefore = vi.mocked(fetch).mock.calls.length

    const index = screen.getByRole('spinbutton', { name: /Engagement index/ })
    await userEvent.type(screen.getByRole('textbox', { name: /Notes/ }), 'Index moved')
    await userEvent.clear(index)
    await userEvent.type(index, '72')
    await userEvent.click(screen.getByRole('button', { name: 'Record progress' }))

    const post = await waitFor(() => {
      const call = vi
        .mocked(fetch)
        .mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
      expect(call).toBeTruthy()
      return call!
    })
    expect(JSON.parse((post[1] as RequestInit).body as string).kpiUpdates).toEqual([
      { kpiId: 'k1', newValue: 72 },
    ])

    // The POST response describes only the update row -- the new KPI and objective
    // values can only come from a GET, so one must follow.
    await waitFor(() => {
      expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(callsBefore + 1)
    })
    expect(await screen.findByText(/Progress recorded on/)).toBeTruthy()
  })

  it('refuses a completion percentage outside 0-100 without calling the server', async () => {
    // `RecordProgressAsync` does not range-check this: it assigns whatever int it is
    // given, and 300 would then render as a bar of nonsense length forever.
    routeFetch()
    renderPage()
    await screen.findByRole('heading', { name: 'Raise engagement' })
    const callsBefore = vi.mocked(fetch).mock.calls.length

    await userEvent.type(screen.getByRole('textbox', { name: /Notes/ }), 'Overshot')
    // By role, not by label text: the objective's <Progress> bar carries the same
    // string as its accessible name, so getByLabelText matches two elements.
    const percentage = screen.getByRole('spinbutton', { name: 'Completion Percentage' })
    await userEvent.clear(percentage)
    await userEvent.type(percentage, '300')
    await userEvent.click(screen.getByRole('button', { name: 'Record progress' }))

    expect(await screen.findByText('Enter a whole number between 0 and 100.')).toBeTruthy()
    expect(vi.mocked(fetch).mock.calls.length).toBe(callsBefore)
  })

  it('says a zero-target KPI has no percentage rather than drawing an empty bar', async () => {
    routeFetch(
      detail({
        kpis: [
          {
            id: 'k1',
            name: 'Exit interviews completed',
            targetValue: 0,
            currentValue: 0,
            unit: '',
            measurementFrequency: 'weekly',
          },
        ],
      }),
    )
    renderPage()

    expect(await screen.findByText('Not applicable')).toBeTruthy()
  })

  it('shows designed empty states when a plan carries no measures', async () => {
    routeFetch(detail({ kpis: [], objectives: [] }))
    renderPage()

    expect(await screen.findByText('No KPIs yet')).toBeTruthy()
    expect(screen.getByText('No objectives yet')).toBeTruthy()
    // Still submittable: `RecordProgressAsync` requires only the note.
    expect(screen.getByText('No KPIs or objectives')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Record progress' })).toBeTruthy()
  })

  it('renders an objective status the vocabulary has never heard of, verbatim', async () => {
    routeFetch(
      detail({
        objectives: [
          {
            id: 'o1',
            description: 'Ship the intranet refresh',
            successCriteria: 'Live',
            currentStatus: 'blocked_on_vendor',
            completionPercentage: 10,
          },
        ],
      }),
    )
    renderPage()

    // Free text on the wire, so the honest render is the server's own string --
    // never a missing key path, and never a status this page made up.
    expect(await screen.findByText('blocked_on_vendor')).toBeTruthy()
  })
})
