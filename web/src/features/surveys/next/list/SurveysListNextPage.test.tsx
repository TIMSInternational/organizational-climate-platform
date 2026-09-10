import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { TranslationProvider } from '../../../../i18n'
import { setToken, clearToken } from '../../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../../company-context'
import { tokenFor } from '../../../../test/jwtFixture'
import { listSurveys, type SurveyListItem } from '../../api/surveys'
import SurveysListNextPage from './SurveysListNextPage'
import en from '../../../../i18n/en.json'

const copy = en.surveys.next.list

vi.mock('../../api/surveys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/surveys')>()),
  listSurveys: vi.fn(),
}))

function row(over: Partial<SurveyListItem>): SurveyListItem {
  return {
    id: 'id',
    title: 'T',
    companyId: 'c1',
    type: 'periodic',
    status: 'closed',
    language: 'es',
    startDate: '2026-01-01T00:00:00Z',
    endDate: '2026-02-01T00:00:00Z',
    responseCount: 24,
    targetAudienceCount: null,
    questionCount: 6,
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  }
}

const payload = [
  row({ id: 'copy', title: 'Q4 (copy)', status: 'archived', responseCount: 0, targetAudienceCount: 24, createdAt: '2026-09-10T00:00:00Z' }),
  row({ id: 'q1', title: 'Q1', endDate: '2026-02-12T00:00:00Z' }),
  row({ id: 'q4', title: 'Q4', status: 'active', responseCount: 1, targetAudienceCount: 24, endDate: '2099-10-10T00:00:00Z' }),
  row({ id: 'q3', title: 'Q3', endDate: '2026-08-06T00:00:00Z' }),
  row({ id: 'other', title: 'Other tenant', companyId: 'c2', endDate: '2026-07-01T00:00:00Z' }),
]

function renderAs(claims: Record<string, unknown>) {
  setToken(tokenFor({ sub: 'u1', nodoId: '', ...claims }))
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/surveys/next']}>
        <CompanyContextProvider>
          <SurveysListNextPage />
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

function rowIds(): string[] {
  return [...document.querySelectorAll('tr[data-survey-id]')].map((tr) => tr.getAttribute('data-survey-id') ?? '')
}

describe('SurveysListNextPage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem('preferredLocale', 'en')
    vi.mocked(listSurveys).mockReset()
    vi.mocked(listSurveys).mockResolvedValue(payload)
  })
  afterEach(() => {
    cleanup()
    clearToken()
    window.localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  })

  it('stacks the open survey first, closed newest first, archived last and demoted, and names a missing invitation list', async () => {
    renderAs({ role: 'company_admin', companyId: 'c1' })
    expect(await screen.findByRole('heading', { name: new RegExp(copy.openHeading) })).toBeTruthy()
    expect(rowIds()).toEqual(['q4', 'q3', 'other', 'q1', 'copy'])
    const archived = document.querySelector('section[data-section="archived"]')
    expect(archived?.getAttribute('data-demoted')).toBe('true')
    const q1 = document.querySelector('tr[data-survey-id="q1"]') as HTMLElement
    expect(within(q1).getByText(copy.noInviteList)).toBeTruthy()
    expect(within(q1).queryByText('—')).toBeNull()
    expect(within(q1).getByText(copy.completed.replace('{count}', '24'))).toBeTruthy()
    expect(screen.getByText(copy.countSummary.replace('{count}', '5'))).toBeTruthy()
  })

  it('offers one action per row that the company administrator may take', async () => {
    renderAs({ role: 'company_admin', companyId: 'c1' })
    await screen.findByRole('heading', { name: new RegExp(copy.openHeading) })
    expect(screen.getByRole('link', { name: en.surveys.newSurvey }).getAttribute('href')).toBe('/surveys/new')
    const actionOf = (id: string) =>
      (document.querySelector(`tr[data-survey-id="${id}"] a[data-action]`) as HTMLElement | null)?.getAttribute('data-action') ?? null
    expect(actionOf('q4')).toBe('distribution')
    expect(actionOf('q3')).toBe('results')
    // Another tenant's closed survey: `GET /surveys/{id}/results` would answer 403, so the row opens instead.
    expect(actionOf('other')).toBe('open')
    expect(actionOf('copy')).toBeNull()
    expect(document.querySelectorAll('tr[data-survey-id="q3"] a').length).toBe(2)
  })

  it('shows a leader the scoped list with no authoring and no results action', async () => {
    renderAs({ role: 'leader', companyId: 'c1' })
    await screen.findByRole('heading', { name: new RegExp(copy.openHeading) })
    expect(screen.queryByRole('link', { name: en.surveys.newSurvey })).toBeNull()
    expect(document.querySelectorAll('a[data-action="results"]')).toHaveLength(0)
    expect(document.querySelectorAll('a[data-action="distribution"]')).toHaveLength(0)
    expect(document.querySelectorAll('a[data-action="open"]').length).toBe(4)
    expect(vi.mocked(listSurveys).mock.calls[0]?.[1]).toEqual({ status: '', type: '', q: '' })
  })
})
