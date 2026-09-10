import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { TranslationProvider } from '../../../../i18n'
import { setToken, clearToken } from '../../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../../company-context'
import { tokenFor } from '../../../../test/jwtFixture'
import { getClimateTrends, type ClimateTrendsResponse } from '../../api/climateTrends'
import ClimateTrendsNextPage from './ClimateTrendsNextPage'
import en from '../../../../i18n/en.json'

const copy = en.surveys.next.trends

vi.mock('../../api/climateTrends', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/climateTrends')>()),
  getClimateTrends: vi.fn(),
}))

const JAN = '2026-02-12T00:00:00+00:00'
const MAY = '2026-05-13T00:00:00+00:00'
const AUG = '2026-08-06T00:00:00+00:00'

function whole(): ClimateTrendsResponse {
  return {
    companyId: 'c1',
    groupBy: null,
    surveys: [
      { surveyId: 's1', title: 'Q1', status: 'closed', endDate: JAN, completedCount: 24, isSuppressed: false },
      { surveyId: 's2', title: 'Q2', status: 'closed', endDate: MAY, completedCount: 24, isSuppressed: false },
      { surveyId: 's3', title: 'Q3', status: 'closed', endDate: AUG, completedCount: 24, isSuppressed: false },
    ],
    dimensions: [
      { key: 'belonging', surveyCount: 3 },
      { key: 'workload', surveyCount: 3 },
    ],
    groups: [
      {
        key: '__company__',
        label: null,
        points: [
          { surveyId: 's1', respondentCount: 24, isSuppressed: false, scores: [3.3, 2.8] },
          { surveyId: 's2', respondentCount: 24, isSuppressed: false, scores: [3.7, 3.0] },
          { surveyId: 's3', respondentCount: 24, isSuppressed: false, scores: [4.0, 3.3] },
        ],
      },
    ],
    suppressedGroupCount: 0,
    minimumGroupSize: 5,
    generatedAt: AUG,
  }
}

function byDepartment(): ClimateTrendsResponse {
  return {
    ...whole(),
    groupBy: 'department',
    groups: [
      {
        key: 'd-fin',
        label: 'Finanzas',
        points: [
          { surveyId: 's1', respondentCount: 6, isSuppressed: false, scores: [3.1, 2.9] },
          { surveyId: 's2', respondentCount: 0, isSuppressed: true, scores: [null, null] },
          { surveyId: 's3', respondentCount: 7, isSuppressed: false, scores: [3.9, 3.9] },
        ],
      },
    ],
    suppressedGroupCount: 0,
  }
}

function renderAt(role: string, companyId: string | undefined = 'c1') {
  setToken(tokenFor(companyId === undefined ? { role } : { role, companyId }))
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/surveys/climate-trends/next']}>
        <CompanyContextProvider>
          <Routes>
            <Route path="/surveys/climate-trends/next" element={<ClimateTrendsNextPage />} />
            <Route path="/dashboard" element={<div data-testid="home" />} />
          </Routes>
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

describe('ClimateTrendsNextPage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem('preferredLocale', 'en')
    vi.mocked(getClimateTrends).mockReset()
    vi.mocked(getClimateTrends).mockImplementation(async (_base, query) =>
      query?.groupBy === 'department' ? byDepartment() : whole(),
    )
  })
  afterEach(() => {
    cleanup()
    clearToken()
    window.localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  })

  it('draws one chart per dimension from the real payload, judged against the target, with the grid below', async () => {
    renderAt('company_admin')
    await waitFor(() => expect(document.querySelectorAll('[data-slot="trend-card"]')).toHaveLength(2))
    const belonging = document.querySelector('[data-slot="trend-card"][data-dimension="belonging"]')
    const workload = document.querySelector('[data-slot="trend-card"][data-dimension="workload"]')
    expect(belonging?.getAttribute('data-standing')).toBe('above')
    expect(workload?.getAttribute('data-standing')).toBe('below')
    expect(within(belonging as HTMLElement).getByRole('img').getAttribute('aria-label')).toContain('3.3 → 3.7 → 4.0')
    // Both requests carried the resolved company, and the department breakdown was asked for.
    expect(vi.mocked(getClimateTrends).mock.calls.map(([, query]) => [query?.companyId, query?.groupBy])).toEqual([
      ['c1', undefined],
      ['c1', 'department'],
    ])
    // The accessible grid keeps every survey as a row.
    expect(screen.getByRole('heading', { name: copy.tableHeading })).toBeTruthy()
    expect(screen.getAllByText('Q1').length).toBeGreaterThan(0)
    // The target is the one sample figure, and the page says so.
    expect(screen.getAllByText(en.dashboard.next.sampleChip).length).toBeGreaterThan(0)
  })

  it('redraws from the department series when a segment is chosen, keeping the withheld wave withheld', async () => {
    renderAt('company_admin')
    await waitFor(() => expect(document.querySelectorAll('[data-slot="trend-card"]')).toHaveLength(2))
    const group = screen.getByRole('group', { name: copy.breakDownBy })
    const finance = within(group).getByRole('button', { name: 'Finanzas' })
    expect(finance.getAttribute('aria-pressed')).toBe('false')
    await userEvent.click(finance)
    expect(finance.getAttribute('aria-pressed')).toBe('true')
    const belonging = document.querySelector('[data-slot="trend-card"][data-dimension="belonging"]') as HTMLElement
    expect(within(belonging).getByRole('img').getAttribute('aria-label')).toContain(`3.1 → ${copy.withheld} → 3.9`)
    expect(belonging.querySelectorAll('[data-slot="trend-withheld"]')).toHaveLength(1)
    // No second request: the department series was already in hand.
    expect(vi.mocked(getClimateTrends)).toHaveBeenCalledTimes(2)
  })

  it('sends a leader to their own dashboard and asks a super admin to choose a company', async () => {
    renderAt('leader')
    expect(await screen.findByTestId('home')).toBeTruthy()
    expect(vi.mocked(getClimateTrends)).not.toHaveBeenCalled()
    cleanup()
    renderAt('super_admin', undefined)
    expect(await screen.findByText(en.companyContext.chooseACompany)).toBeTruthy()
    expect(vi.mocked(getClimateTrends)).not.toHaveBeenCalled()
  })
})
