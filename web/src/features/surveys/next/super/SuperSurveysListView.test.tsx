import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { TranslationProvider } from '../../../../i18n'
import { setToken, clearToken } from '../../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../../company-context'
import { clearCompanyNameCache } from '../../../../company-context/useCompanyName'
import { tokenFor } from '../../../../test/jwtFixture'
import { listSurveys, type SurveyListItem } from '../../api/surveys'
import { getClimateTrends, type ClimateTrendsResponse } from '../../api/climateTrends'
import { listCompanies } from '../../../org-structure/api/companies'
import SurveysListNextPage from '../list/SurveysListNextPage'
import en from '../../../../i18n/en.json'

const copy = en.surveys.next.super

vi.mock('../../api/surveys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/surveys')>()),
  listSurveys: vi.fn(),
  duplicateSurvey: vi.fn(),
}))
vi.mock('../../api/climateTrends', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/climateTrends')>()),
  getClimateTrends: vi.fn(),
}))
vi.mock('../../../org-structure/api/companies', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../org-structure/api/companies')>()),
  listCompanies: vi.fn(),
}))

function row(over: Partial<SurveyListItem>): SurveyListItem {
  return {
    id: 'id',
    title: 'Climate Survey Q3',
    companyId: 'meridiano',
    type: 'periodic',
    status: 'closed',
    language: 'both',
    startDate: '2026-07-16T00:00:00Z',
    endDate: '2026-08-06T00:00:00Z',
    responseCount: 24,
    targetAudienceCount: null,
    questionCount: 6,
    createdAt: '2026-07-01T00:00:00Z',
    ...over,
  }
}

const PLATFORM: SurveyListItem[] = [
  row({ id: 'm-q4', title: 'Climate Survey Q4', status: 'active', targetAudienceCount: 24, responseCount: 3, endDate: '2099-10-10T00:00:00Z' }),
  row({ id: 'm-q2', title: 'Climate Survey Q2', endDate: '2026-05-13T00:00:00Z' }),
  row({ id: 'm-q3', title: 'Climate Survey Q3', endDate: '2026-08-06T00:00:00Z' }),
  row({ id: 'a-q1', title: 'Climate Survey Q1', companyId: 'acme', endDate: '2026-01-29T00:00:00Z' }),
  row({ id: 'a-q2', title: 'Climate Survey Q2', companyId: 'acme', endDate: '2026-04-29T00:00:00Z' }),
]

/** Meridiano's own window, as the real API sends it; Acme's read fails. */
const MERIDIANO_TRENDS: ClimateTrendsResponse = {
  companyId: 'meridiano',
  groupBy: null,
  surveys: [
    { surveyId: 'm-q2', title: 'Climate Survey Q2', status: 'closed', endDate: '2026-05-13T00:00:00Z', completedCount: 24, isSuppressed: false },
    { surveyId: 'm-q3', title: 'Climate Survey Q3', status: 'closed', endDate: '2026-08-06T00:00:00Z', completedCount: 24, isSuppressed: false },
  ],
  dimensions: [{ key: 'belonging', surveyCount: 2 }],
  groups: [
    {
      key: '__company__',
      label: null,
      points: [
        { surveyId: 'm-q2', respondentCount: 24, isSuppressed: false, scores: [3.4] },
        { surveyId: 'm-q3', respondentCount: 24, isSuppressed: false, scores: [3.7] },
      ],
    },
  ],
  suppressedGroupCount: 0,
  minimumGroupSize: 5,
  generatedAt: '2026-09-10T00:00:00Z',
}

function renderAs(claims: Record<string, unknown>) {
  setToken(tokenFor({ sub: 'u1', nodoId: '', ...claims }))
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/surveys']}>
        <CompanyContextProvider>
          <Routes>
            <Route path="/surveys" element={<SurveysListNextPage />} />
          </Routes>
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

function rowOf(id: string): HTMLElement {
  return document.querySelector(`tr[data-survey-id="${id}"]`) as HTMLElement
}

describe('SuperSurveysListView — the super administrator\'s /surveys', () => {
  beforeEach(() => {
    window.localStorage.setItem('preferredLocale', 'en')
    vi.mocked(listSurveys).mockReset()
    vi.mocked(listSurveys).mockResolvedValue(PLATFORM)
    vi.mocked(getClimateTrends).mockReset()
    vi.mocked(getClimateTrends).mockImplementation((_base, filters) =>
      filters?.companyId === 'meridiano' ? Promise.resolve(MERIDIANO_TRENDS) : Promise.reject(new Error('404')),
    )
    vi.mocked(listCompanies).mockReset()
    vi.mocked(listCompanies).mockResolvedValue([
      { id: 'meridiano', name: 'Grupo Meridiano S.A.', emailDomain: null, industry: null, size: null, country: null, subscriptionTier: null, createdAt: '2026-01-01T00:00:00Z' },
      { id: 'acme', name: 'Acme Corporation', emailDomain: null, industry: null, size: null, country: null, subscriptionTier: null, createdAt: '2026-01-01T00:00:00Z' },
    ])
  })
  afterEach(() => {
    cleanup()
    clearToken()
    clearCompanyNameCache()
    window.localStorage.clear()
    window.localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  })

  it('is what /surveys draws for a super administrator: an Empresa column naming each row\'s company', async () => {
    renderAs({ role: 'super_admin' })
    await waitFor(() => expect(within(rowOf('a-q1')).getByText('Acme Corporation')).toBeTruthy())
    expect(within(rowOf('m-q3')).getByText('Grupo Meridiano S.A.')).toBeTruthy()
    expect(screen.getAllByRole('columnheader', { name: copy.colCompany }).length).toBeGreaterThan(0)
    expect(screen.getByText(copy.summary.replace('{count}', '5').replace('{companies}', '2'))).toBeTruthy()
  })

  it('leaves a company administrator on the company list, with no Empresa column', async () => {
    vi.mocked(listSurveys).mockResolvedValue(PLATFORM.filter((survey) => survey.companyId === 'meridiano'))
    renderAs({ role: 'company_admin', companyId: 'meridiano' })
    await screen.findByText('Climate Survey Q4')
    expect(screen.queryByRole('columnheader', { name: copy.colCompany })).toBeNull()
    expect(listCompanies).not.toHaveBeenCalled()
  })

  it('prints each closed survey\'s own company move, and its place when that company\'s trends could not be read', async () => {
    renderAs({ role: 'super_admin' })
    await waitFor(() => expect(within(rowOf('m-q3')).getByText(/Q2/)).toBeTruthy())
    expect(within(rowOf('m-q3')).getByText(/\+0[.,]30/)).toBeTruthy()
    expect(within(rowOf('a-q2')).getByText(copy.wave2)).toBeTruthy()
    expect(within(rowOf('a-q1')).getByText(en.surveys.next.list.firstReading)).toBeTruthy()
    expect(vi.mocked(getClimateTrends).mock.calls.map(([, filters]) => filters?.companyId).sort()).toEqual(['acme', 'meridiano'])
  })

  it('offers each row its action whatever company is chosen: Distribution when open, Results when closed', async () => {
    renderAs({ role: 'super_admin' })
    await screen.findByText('Climate Survey Q4')
    expect(rowOf('m-q4').querySelector('[data-action="distribution"]')).toBeTruthy()
    expect(rowOf('a-q1').querySelector('[data-action="results"]')).toBeTruthy()
  })

  it('offers "New survey" only once a company is chosen — POST /surveys needs one to name', async () => {
    renderAs({ role: 'super_admin' })
    await screen.findByText('Climate Survey Q4')
    expect(screen.queryByRole('link', { name: new RegExp(en.surveys.newSurvey) })).toBeNull()
    cleanup()
    window.localStorage.setItem(COMPANY_CONTEXT_STORAGE_KEY, 'acme')
    renderAs({ role: 'super_admin' })
    expect(await screen.findByRole('link', { name: new RegExp(en.surveys.newSurvey) })).toBeTruthy()
  })

  it('narrows to one company with the filter, and the chips count what is left', async () => {
    renderAs({ role: 'super_admin' })
    await screen.findByText('Climate Survey Q4')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: copy.colCompany }), 'acme')
    expect(rowOf('m-q4')).toBeNull()
    expect(rowOf('a-q1')).toBeTruthy()
    expect(screen.getByRole('button', { name: `${en.surveys.next.list.facetAll} · 2` })).toBeTruthy()
  })
})
