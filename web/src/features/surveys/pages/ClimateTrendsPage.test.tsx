import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { TranslationProvider } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../company-context'
import ClimateTrendsPage from './ClimateTrendsPage'
import { getClimateTrends, type ClimateTrendsResponse } from '../api/climateTrends'

/** An unsigned token: nothing here verifies one, and `company-context` only reads claims. */
function tokenFor(claims: Record<string, unknown>): string {
  const body = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `header.${body}.signature`
}

const OWN = 'company-1'

vi.mock('../api/climateTrends', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/climateTrends')>()),
  getClimateTrends: vi.fn(),
}))

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
})

const JAN = '2026-01-31T00:00:00+00:00'
const JUN = '2026-06-30T00:00:00+00:00'

function payload(overrides: Partial<ClimateTrendsResponse> = {}): ClimateTrendsResponse {
  return {
    companyId: 'company-1',
    groupBy: null,
    surveys: [
      { surveyId: 's1', title: 'January', status: 'closed', endDate: JAN, completedCount: 20, isSuppressed: false },
      { surveyId: 's2', title: 'June', status: 'closed', endDate: JUN, completedCount: 24, isSuppressed: false },
    ],
    dimensions: [
      { key: 'trust', surveyCount: 2 },
      { key: 'wellbeing', surveyCount: 2 },
    ],
    groups: [
      {
        key: '__company__',
        label: null,
        points: [
          { surveyId: 's1', respondentCount: 20, isSuppressed: false, scores: [3.0, 4.0] },
          { surveyId: 's2', respondentCount: 24, isSuppressed: false, scores: [3.6, 4.2] },
        ],
      },
    ],
    suppressedGroupCount: 0,
    minimumGroupSize: 5,
    generatedAt: JUN,
    ...overrides,
  }
}

function renderPage() {
  const router = createMemoryRouter(
    [
      {
        path: '/surveys/climate-trends',
        element: (
          <CompanyContextProvider>
            <ClimateTrendsPage />
          </CompanyContextProvider>
        ),
      },
    ],
    { initialEntries: ['/surveys/climate-trends'] },
  )
  return render(
    <TranslationProvider>
      <RouterProvider router={router} />
    </TranslationProvider>,
  )
}

describe('ClimateTrendsPage', () => {
  beforeEach(() => {
    vi.mocked(getClimateTrends).mockReset()
    setToken(tokenFor({ role: 'company_admin', companyId: OWN }))
  })

  it('draws one row per survey, oldest first, with the dimensions as columns', async () => {
    vi.mocked(getClimateTrends).mockResolvedValue(payload())
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Climate over time' })).toBeTruthy()

    const table = await screen.findByRole('table')
    const rowHeaders = within(table).getAllByRole('rowheader').map((cell) => cell.textContent)
    expect(rowHeaders).toEqual(['January', 'June'])

    const columnHeaders = within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent?.trim())
    expect(columnHeaders).toContain('trust')
    expect(columnHeaders).toContain('wellbeing')
  })

  /**
   * THE assertion this page exists to keep honest. A withheld wave must render as
   * protected — and its cells must publish no figure at all, not a zero and not the
   * respondent count the payload carries.
   */
  it('renders a withheld wave as protected and prints no figure for it', async () => {
    vi.mocked(getClimateTrends).mockResolvedValue(
      payload({
        groups: [
          {
            key: '__company__',
            label: null,
            points: [
              { surveyId: 's1', respondentCount: 0, isSuppressed: true, scores: [null, null] },
              { surveyId: 's2', respondentCount: 24, isSuppressed: false, scores: [3.6, 4.2] },
            ],
          },
        ],
      }),
    )
    renderPage()

    const table = await screen.findByRole('table')
    const rows = within(table).getAllByRole('row')
    // Header row first, so the withheld survey is the second.
    const withheld = rows.find((row) => within(row).queryByText('January'))!

    const protectedCells = within(withheld).getAllByRole('img')
    expect(protectedCells).toHaveLength(2)
    // The NAMED variant, so a screen reader hears which survey and which dimension is
    // withheld rather than a grid of identical "protected". The floor is named too, and
    // the sub-threshold count deliberately is not.
    expect(protectedCells.map((cell) => cell.getAttribute('aria-label'))).toEqual([
      'January, trust: protected — withheld below 5 responses',
      'January, wellbeing: protected — withheld below 5 responses',
    ])

    // No reading of any kind on the withheld row — and in particular not the "0" its
    // respondentCount carries, which is the number the floor exists to withhold.
    expect(withheld.textContent).not.toMatch(/\d/)
  })

  it('says which dimensions were left out rather than quietly narrowing the grid', async () => {
    vi.mocked(getClimateTrends).mockResolvedValue(
      payload({
        groups: [
          {
            key: '__company__',
            label: null,
            points: [
              { surveyId: 's1', respondentCount: 20, isSuppressed: false, scores: [3.0, null] },
              { surveyId: 's2', respondentCount: 24, isSuppressed: false, scores: [3.6, 4.2] },
            ],
          },
        ],
      }),
    )
    renderPage()

    expect(await screen.findByText(/wellbeing/)).toBeTruthy()
    const table = screen.getByRole('table')
    const columnHeaders = within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent?.trim())
    expect(columnHeaders).not.toContain('wellbeing')
  })

  it('reports groups withheld in every wave instead of dropping them silently', async () => {
    vi.mocked(getClimateTrends).mockResolvedValue(payload({ suppressedGroupCount: 3 }))
    renderPage()

    expect(await screen.findByText(/3 group\(s\) are withheld/)).toBeTruthy()
  })

  /**
   * Changing the breakdown must re-ask the server, because the floor is applied per group
   * per survey and cannot be re-derived client-side from the ungrouped payload.
   */
  it('refetches with the breakdown when the grouping changes', async () => {
    vi.mocked(getClimateTrends).mockResolvedValue(payload())
    renderPage()
    await screen.findByRole('table')

    // The resolved company travels on every request, a company_admin's included. Relying
    // on the server's implicit default would make the request ambiguous about what it is
    // asking for; sent explicitly, a wrong one is refused rather than quietly rescoped.
    expect(vi.mocked(getClimateTrends).mock.calls[0][1]).toEqual({ companyId: OWN })

    await userEvent.selectOptions(screen.getByLabelText(/Break down by/), 'department')

    await waitFor(() => expect(getClimateTrends).toHaveBeenCalledTimes(2))
    expect(vi.mocked(getClimateTrends).mock.calls[1][1]).toEqual({
      groupBy: 'department',
      companyId: OWN,
    })
  })

  it('offers an empty state, not a broken grid, when no survey has closed', async () => {
    vi.mocked(getClimateTrends).mockResolvedValue(
      payload({ surveys: [], dimensions: [], groups: [] }),
    )
    renderPage()

    expect(await screen.findByText('No closed surveys yet')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  /**
   * A super_admin who has selected no company is ASKED, not refused. The endpoint answers
   * 400 for that request — there is no all-companies climate, because dimensions are
   * per-instrument — so a page that called anyway would put an error panel in front of one
   * of the two roles the sidebar offers this to. Same three branches `DepartmentsPage` uses.
   */
  it('asks a super_admin to choose a company instead of calling without one', async () => {
    setToken(tokenFor({ role: 'super_admin' }))
    vi.mocked(getClimateTrends).mockResolvedValue(payload())
    renderPage()

    expect(await screen.findByText('Choose a company')).toBeTruthy()
    expect(getClimateTrends).not.toHaveBeenCalled()
  })

  it('sends the selected company once a super_admin has chosen one', async () => {
    setToken(tokenFor({ role: 'super_admin' }))
    localStorage.setItem(COMPANY_CONTEXT_STORAGE_KEY, 'company-9')
    vi.mocked(getClimateTrends).mockResolvedValue(payload())
    renderPage()

    await screen.findByRole('table')
    expect(vi.mocked(getClimateTrends).mock.calls[0][1]).toEqual({ companyId: 'company-9' })
  })

  /** Same guarantee as every other load-and-fail screen: recoverable in place. */
  it('recovers from a failed load without a reload', async () => {
    vi.mocked(getClimateTrends)
      .mockRejectedValueOnce(new Error('Request failed: 500'))
      .mockResolvedValueOnce(payload())
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Request failed: 500')

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('table')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
