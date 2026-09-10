import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { TranslationProvider } from '../../../../i18n'
import { setToken, clearToken } from '../../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../../company-context'
import { clearCompanyNameCache } from '../../../../company-context/useCompanyName'
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
      <MemoryRouter initialEntries={['/surveys']}>
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
    clearCompanyNameCache()
    vi.unstubAllGlobals()
    window.localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  })

  /**
   * The guarantees `/surveys` kept when the redesign took the route over from
   * `SurveysListPage` (its test still pins the old table, rendered directly). Each one
   * was a defect once: a `companyId` on the wire rescopes a SuperAdmin, a missing `lang`
   * showed a Spanish reader the English half of every title, a status on the wire
   * emptied the chips' counts, a fetch per keystroke, and an eyebrow that named the nav
   * section instead of the company.
   */
  it('sends no companyId and asks for the titles in the reader’s language', async () => {
    renderAs({ role: 'super_admin' })
    await screen.findByRole('heading', { name: new RegExp(copy.openHeading) })
    const [, filters, lang] = vi.mocked(listSurveys).mock.calls[0]
    expect(filters).not.toHaveProperty('companyId')
    expect(lang).toBe('en')
  })

  it('narrows to a status on the client, without a second request', async () => {
    renderAs({ role: 'company_admin', companyId: 'c1' })
    await screen.findByRole('heading', { name: new RegExp(copy.openHeading) })
    const chips = screen.getByRole('group', { name: en.surveys.filterByStatus })
    const closed = within(chips).getByRole('button', {
      name: copy.chipCount.replace('{label}', en.surveys.statusClosed).replace('{count}', '3'),
    })
    await userEvent.click(closed)
    expect(closed.getAttribute('aria-pressed')).toBe('true')
    expect(rowIds()).toEqual(['q3', 'other', 'q1'])
    expect(vi.mocked(listSurveys)).toHaveBeenCalledTimes(1)
  })

  it('does not refetch on every keystroke; the search button applies the query', async () => {
    renderAs({ role: 'company_admin', companyId: 'c1' })
    await screen.findByRole('heading', { name: new RegExp(copy.openHeading) })
    await userEvent.type(screen.getByRole('searchbox', { name: copy.searchPlaceholder }), 'clima')
    expect(vi.mocked(listSurveys)).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: en.common.search }))
    await waitFor(() => expect(vi.mocked(listSurveys)).toHaveBeenCalledTimes(2))
    expect(vi.mocked(listSurveys).mock.calls[1][1]).toEqual({ status: '', type: '', q: 'clima' })
  })

  it('shows the server’s message on a failed load, with a retry that refetches', async () => {
    vi.mocked(listSurveys).mockRejectedValueOnce(new Error('Boom'))
    renderAs({ role: 'company_admin', companyId: 'c1' })
    expect(await screen.findByText('Boom')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: en.common.retry }))
    expect(await screen.findByRole('heading', { name: new RegExp(copy.openHeading) })).toBeTruthy()
    expect(vi.mocked(listSurveys)).toHaveBeenCalledTimes(2)
  })

  it('names the company on the eyebrow, from the caller’s own profile', async () => {
    // `/profile` is the one source every role that can open this screen may read; a
    // leader could not read `/admin/companies/{id}`.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) =>
        Promise.resolve(
          new Response(JSON.stringify(String(input).includes('/profile') ? { companyName: 'Acme Corporation' } : {}), {
            status: 200,
          }),
        ),
      ),
    )
    renderAs({ role: 'leader', companyId: 'c1' })
    await waitFor(() => {
      expect(document.querySelector('[data-slot="page-eyebrow"]')?.textContent).toBe('Acme Corporation')
    })
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
