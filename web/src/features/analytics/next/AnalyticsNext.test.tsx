import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { TranslationProvider } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import { CompanyContextProvider } from '../../../company-context'
import { tokenFor } from '../../../test/jwtFixture'
import { acknowledgeAIInsight, listAIInsights, type AIInsightListItem } from '../api/insights'
import { getBenchmark, listBenchmarks, type Benchmark, type BenchmarkListItem } from '../api/benchmarks'
import { listSurveys, type SurveyListItem } from '../../surveys/api/surveys'
import AIInsightsNextPage from './AIInsightsNextPage'
import AnalyticsNextPage from './AnalyticsNextPage'
import { groupSizeOf, latestClosedSurvey, sortInsights } from './model'
import en from '../../../i18n/en.json'

vi.mock('../api/insights', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/insights')>()),
  listAIInsights: vi.fn(),
  acknowledgeAIInsight: vi.fn(),
}))
vi.mock('../api/benchmarks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/benchmarks')>()),
  listBenchmarks: vi.fn(),
  getBenchmark: vi.fn(),
}))
vi.mock('../../surveys/api/surveys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../surveys/api/surveys')>()),
  listSurveys: vi.fn(),
}))
vi.mock('../../../company-context/useCompanyName', () => ({
  useCompanyName: () => 'Grupo Meridiano S.A.',
  clearCompanyNameCache: () => {},
}))

const insightsCopy = en.insights.next
const analyticsCopy = en.analytics.next
const COMPANY = 'c1'

function insight(over: Partial<AIInsightListItem>): AIInsightListItem {
  return { id: 'i', companyId: COMPANY, type: 'risk', category: 'workload', title: 'T', priority: 'low', isAcknowledged: false, ...over }
}

function renderAt(path: string, element: React.ReactNode, routePath: string, role = 'company_admin') {
  setToken(tokenFor({ sub: 'u1', nodoId: '', role, companyId: COMPANY }))
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={[path]}>
        <CompanyContextProvider>
          <Routes>
            <Route path={routePath} element={element} />
          </Routes>
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

afterEach(() => {
  cleanup()
  clearToken()
  vi.mocked(listAIInsights).mockReset()
  vi.mocked(acknowledgeAIInsight).mockReset()
  vi.mocked(listBenchmarks).mockReset()
  vi.mocked(getBenchmark).mockReset()
  vi.mocked(listSurveys).mockReset()
})

describe('sortInsights / groupSizeOf / latestClosedSurvey', () => {
  it('puts critical first and, within a priority, the unreviewed first', () => {
    const sorted = sortInsights([
      insight({ id: 'low', priority: 'low' }),
      insight({ id: 'crit-done', priority: 'critical', isAcknowledged: true }),
      insight({ id: 'high', priority: 'high' }),
      insight({ id: 'crit', priority: 'critical' }),
    ])
    expect(sorted.map((i) => i.id)).toEqual(['crit', 'crit-done', 'high', 'low'])
  })

  it('reads the cohort size as the largest recorded sample, and null — never 0 — when none is recorded', () => {
    const metric = (sampleSize: number | null) => ({ id: 'm', metricName: 'x', value: 1, unit: 'index', percentile: null, sampleSize })
    expect(groupSizeOf({ metrics: [metric(40), metric(42), metric(null)] })).toBe(42)
    expect(groupSizeOf({ metrics: [metric(null)] })).toBeNull()
    expect(groupSizeOf(null)).toBeNull()
  })

  it("picks the company's most recently closed wave, never another tenant's or an open one", () => {
    const s = (over: Partial<SurveyListItem>): SurveyListItem => ({
      id: 'x', title: 'T', companyId: COMPANY, type: 'periodic', status: 'closed', language: 'es',
      startDate: '2026-01-01T00:00:00Z', endDate: '2026-02-01T00:00:00Z', responseCount: 24,
      targetAudienceCount: null, questionCount: 6, createdAt: '2026-01-01T00:00:00Z', ...over,
    })
    const pick = latestClosedSurvey(
      [
        s({ id: 'q2', endDate: '2026-05-01T00:00:00Z' }),
        s({ id: 'q3', endDate: '2026-08-06T00:00:00Z' }),
        s({ id: 'open', status: 'active', endDate: '2026-10-10T00:00:00Z' }),
        s({ id: 'other', companyId: 'c2', endDate: '2026-09-01T00:00:00Z' }),
      ],
      COMPANY,
    )
    expect(pick?.id).toBe('q3')
  })
})

describe('AIInsightsNextPage', () => {
  it('says why an empty list is empty, naming the company, and prints a count of 0', async () => {
    vi.mocked(listAIInsights).mockResolvedValue([])
    renderAt('/analytics/ai-insights', <AIInsightsNextPage />, '/analytics/ai-insights')
    expect(await screen.findByText(insightsCopy.emptyTitle)).toBeTruthy()
    expect(screen.getByText(insightsCopy.emptyReason.replace('{company}', 'Grupo Meridiano S.A.'))).toBeTruthy()
    expect(screen.getByRole('heading', { name: `${insightsCopy.heading} 0` })).toBeTruthy()
    expect(screen.getByText(insightsCopy.privacy)).toBeTruthy()
  })

  it('lists critical first and lets a company administrator mark one as reviewed', async () => {
    vi.mocked(listAIInsights).mockResolvedValue([
      insight({ id: 'a', title: 'Low one', priority: 'low' }),
      insight({ id: 'b', title: 'Critical one', priority: 'critical' }),
    ])
    vi.mocked(acknowledgeAIInsight).mockResolvedValue({} as never)
    renderAt('/analytics/ai-insights', <AIInsightsNextPage />, '/analytics/ai-insights')
    const rows = await screen.findAllByTestId('insight-row')
    expect(rows.map((row) => within(row).getAllByRole('cell')[1].textContent)).toEqual(['Critical one', 'Low one'])
    await userEvent.click(within(rows[0]).getByRole('button', { name: insightsCopy.acknowledge }))
    expect(vi.mocked(acknowledgeAIInsight).mock.calls[0][1]).toBe('b')
    await waitFor(() => expect(listAIInsights).toHaveBeenCalledTimes(2))
  })

  it('offers no acknowledge button to a role the server would refuse', async () => {
    vi.mocked(listAIInsights).mockResolvedValue([insight({ id: 'a', title: 'Open one' })])
    renderAt('/analytics/ai-insights', <AIInsightsNextPage />, '/analytics/ai-insights', 'leader')
    await screen.findByText('Open one')
    expect(screen.queryByRole('button', { name: insightsCopy.acknowledge })).toBeNull()
  })

  it('shows a failed read as an error, never as "no findings"', async () => {
    vi.mocked(listAIInsights).mockRejectedValue(new Error('boom'))
    renderAt('/analytics/ai-insights', <AIInsightsNextPage />, '/analytics/ai-insights')
    expect(await screen.findByText(insightsCopy.loadFailed)).toBeTruthy()
    expect(screen.queryByText(insightsCopy.emptyTitle)).toBeNull()
  })
})

describe('AnalyticsNextPage', () => {
  const global: BenchmarkListItem = {
    id: 'b1', name: 'Manufacturing · 500–1000 staff', type: 'industry', category: 'climate',
    companyId: null, isActive: true, qualityScore: 0, priorPeriodStatus: 'unlinked',
  }
  const detail = (sampleSizes: (number | null)[]) =>
    ({ ...global, validationStatus: 'pending', metrics: sampleSizes.map((sampleSize, i) => ({ id: `m${i}`, metricName: `m${i}`, value: 70, unit: 'index', percentile: null, sampleSize })) }) as unknown as Benchmark

  function arrange(detailResult: Benchmark | Error) {
    vi.mocked(listBenchmarks).mockResolvedValue([global])
    if (detailResult instanceof Error) vi.mocked(getBenchmark).mockRejectedValue(detailResult)
    else vi.mocked(getBenchmark).mockResolvedValue(detailResult)
    vi.mocked(listAIInsights).mockResolvedValue([])
    vi.mocked(listSurveys).mockResolvedValue([
      { id: 'q3', title: 'Q3 Climate Survey', companyId: COMPANY, type: 'periodic', status: 'closed', language: 'both', startDate: '2026-07-16T00:00:00Z', endDate: '2026-08-06T00:00:00Z', responseCount: 24, targetAudienceCount: null, questionCount: 6, createdAt: '2026-07-01T00:00:00Z' },
    ])
    renderAt(`/admin/companies/${COMPANY}/analytics`, <AnalyticsNextPage />, '/admin/companies/:companyId/analytics')
  }

  it('reads each reference against the latest wave, with the cohort size from its detail', async () => {
    arrange(detail([42, 40]))
    const row = await screen.findByTestId('benchmark-row')
    expect(within(row).getByText('42')).toBeTruthy()
    expect(within(row).getByText(analyticsCopy.qualityPending)).toBeTruthy()
    expect(within(row).getByText(analyticsCopy.scopeGlobal)).toBeTruthy()
    expect(screen.getByText('against Q3 Climate Survey · 24 responses')).toBeTruthy()
    expect(screen.getByText(analyticsCopy.noOwnTitle.replace('{company}', 'Grupo Meridiano S.A.'))).toBeTruthy()
    expect(screen.getByText(analyticsCopy.insightsEmpty)).toBeTruthy()
  })

  it('prints a dash, never 0, when the cohort size cannot be read', async () => {
    arrange(new Error('403'))
    const row = await screen.findByTestId('benchmark-row')
    const group = within(row).getAllByRole('cell')[2]
    expect(group.textContent).toBe('—')
  })
})
