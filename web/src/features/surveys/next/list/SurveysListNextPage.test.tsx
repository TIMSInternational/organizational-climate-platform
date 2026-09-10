import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { TranslationProvider } from '../../../../i18n'
import { setToken, clearToken } from '../../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../../company-context'
import { clearCompanyNameCache } from '../../../../company-context/useCompanyName'
import { tokenFor } from '../../../../test/jwtFixture'
import { duplicateSurvey, listSurveys, type SurveyDetail, type SurveyListItem } from '../../api/surveys'
import { getClimateTrends, type ClimateTrendsResponse } from '../../api/climateTrends'
import SurveysListNextPage from './SurveysListNextPage'
import en from '../../../../i18n/en.json'

const copy = en.surveys.next.list

vi.mock('../../api/surveys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/surveys')>()),
  listSurveys: vi.fn(),
  duplicateSurvey: vi.fn(),
}))
vi.mock('../../api/climateTrends', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/climateTrends')>()),
  getClimateTrends: vi.fn(),
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

/** The tenant's climate window as the real API sends it: closed waves and the archived copy. */
const trends: ClimateTrendsResponse = {
  companyId: 'c1',
  groupBy: null,
  surveys: [
    { surveyId: 'q1', title: 'Q1', status: 'closed', endDate: '2026-02-12T00:00:00Z', completedCount: 24, isSuppressed: false },
    { surveyId: 'q3', title: 'Q3', status: 'closed', endDate: '2026-08-06T00:00:00Z', completedCount: 24, isSuppressed: false },
    { surveyId: 'copy', title: 'Q4 (copy)', status: 'archived', endDate: '2026-10-10T00:00:00Z', completedCount: 0, isSuppressed: true },
  ],
  dimensions: [
    { key: 'belonging', surveyCount: 2 },
    { key: 'workload', surveyCount: 2 },
  ],
  groups: [
    {
      key: '__company__',
      label: null,
      points: [
        { surveyId: 'q1', respondentCount: 24, isSuppressed: false, scores: [3.0, 3.2] },
        { surveyId: 'q3', respondentCount: 24, isSuppressed: false, scores: [3.5, 3.9] },
        { surveyId: 'copy', respondentCount: 0, isSuppressed: true, scores: [null, null] },
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
            <Route path="/surveys/:id" element={<div data-testid="detail" />} />
          </Routes>
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

function rowIds(): string[] {
  return [...document.querySelectorAll('tr[data-survey-id]')].map((tr) => tr.getAttribute('data-survey-id') ?? '')
}

function rowOf(id: string): HTMLElement {
  return document.querySelector(`tr[data-survey-id="${id}"]`) as HTMLElement
}

async function openMenu(id: string): Promise<string[]> {
  await userEvent.click(within(rowOf(id)).getByRole('button', { name: new RegExp(copy.moreActions.replace('{title}', '')) }))
  const menu = await screen.findByRole('menu')
  return within(menu).getAllByRole('menuitem').map((item) => item.textContent ?? '')
}

describe('SurveysListNextPage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem('preferredLocale', 'en')
    vi.mocked(listSurveys).mockReset()
    vi.mocked(listSurveys).mockResolvedValue(payload)
    vi.mocked(getClimateTrends).mockReset()
    vi.mocked(getClimateTrends).mockResolvedValue(trends)
    vi.mocked(duplicateSurvey).mockReset()
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

  it('narrows to a status on the client, without a second request, from pills that show only what exists', async () => {
    renderAs({ role: 'company_admin', companyId: 'c1' })
    await screen.findByRole('heading', { name: new RegExp(copy.openHeading) })
    const chips = screen.getByRole('group', { name: en.surveys.filterByStatus })
    // All · 5, Active · 1, Closed · 3, Archived · 1 — the canvas's four, and no "Drafts · 0".
    expect(within(chips).getAllByRole('button').map((chip) => chip.textContent)).toEqual([
      copy.chipCount.replace('{label}', copy.facetAll).replace('{count}', '5'),
      copy.chipCount.replace('{label}', copy.facetActive).replace('{count}', '1'),
      copy.chipCount.replace('{label}', copy.facetClosed).replace('{count}', '3'),
      copy.chipCount.replace('{label}', copy.facetArchived).replace('{count}', '1'),
    ])
    const closed = within(chips).getByRole('button', {
      name: copy.chipCount.replace('{label}', copy.facetClosed).replace('{count}', '3'),
    })
    await userEvent.click(closed)
    expect(closed.getAttribute('aria-pressed')).toBe('true')
    expect(rowIds()).toEqual(['q3', 'other', 'q1'])
    expect(vi.mocked(listSurveys)).toHaveBeenCalledTimes(1)
  })

  it('does not refetch on every keystroke: a word is one request once the typing rests, and Enter sends it at once', async () => {
    renderAs({ role: 'company_admin', companyId: 'c1' })
    await screen.findByRole('heading', { name: new RegExp(copy.openHeading) })
    const search = screen.getByRole('searchbox', { name: copy.searchPlaceholder })
    await userEvent.type(search, 'clima')
    // Five keys, and not one request yet — the debounce is still waiting.
    expect(vi.mocked(listSurveys)).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(vi.mocked(listSurveys)).toHaveBeenCalledTimes(2))
    expect(vi.mocked(listSurveys).mock.calls[1][1]).toEqual({ status: '', type: '', q: 'clima' })
    await userEvent.type(search, ' q3{Enter}')
    await waitFor(() => expect(vi.mocked(listSurveys)).toHaveBeenCalledTimes(3))
    expect(vi.mocked(listSurveys).mock.calls[2][1]).toEqual({ status: '', type: '', q: 'clima q3' })
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
    const q1 = rowOf('q1')
    expect(within(q1).getByText(copy.noInviteList)).toBeTruthy()
    expect(within(q1).queryByText('—')).toBeNull()
    expect(within(q1).getByText('24')).toBeTruthy()
    expect(within(q1).getByText(copy.completedUnit)).toBeTruthy()
    expect(screen.getByText(copy.countSummary.replace('{count}', '5'))).toBeTruthy()
    // The archived row says when it was made — no archive date is on the wire — and the
    // footnote makes no promise of a restore the server has no transition for.
    expect(within(rowOf('copy')).getByText(new RegExp(copy.createdOn.replace('{date}', 'Sep 10')))).toBeTruthy()
    expect(archived?.textContent).toContain(copy.archivedNote)
  })

  it('prints each closed wave’s climate move under its date, read from the trends payload', async () => {
    renderAs({ role: 'company_admin', companyId: 'c1' })
    await waitFor(() => expect(rowOf('q3').querySelector('[data-slot="wave-move"]')).toBeTruthy())
    // (3.5 + 3.9) / 2 − (3.0 + 3.2) / 2 = +0.60, against the closed wave before it.
    expect(rowOf('q3').querySelector('[data-slot="wave-move"]')?.textContent).toBe(
      copy.vsWave.replace('{delta}', '+0.60').replace('{wave}', 'Q1'),
    )
    expect(rowOf('q1').querySelector('[data-slot="wave-move"]')?.textContent).toBe(copy.firstReading)
    // Another tenant's survey is not in this tenant's window: no line, never a sample one.
    expect(rowOf('other').querySelector('[data-slot="wave-move"]')).toBeNull()
    expect(rowOf('copy').querySelector('[data-slot="wave-move"]')).toBeNull()
    expect(vi.mocked(getClimateTrends).mock.calls[0]?.[1]).toEqual({ companyId: 'c1', lang: 'en' })
    // The closed section's note: the shared count, and the completed share from the same payload.
    const closed = document.querySelector('section[data-section="closed"]') as HTMLElement
    expect(closed.textContent).toContain(copy.closedNoteEach.replace('{count}', '24'))
  })

  it('asks nothing of the trends endpoint for a viewer it would refuse, and the list stands without it', async () => {
    renderAs({ role: 'leader', companyId: 'c1' })
    await screen.findByRole('heading', { name: new RegExp(copy.openHeading) })
    expect(vi.mocked(getClimateTrends)).not.toHaveBeenCalled()
    expect(document.querySelectorAll('[data-slot="wave-move"]')).toHaveLength(0)
    cleanup()
    vi.mocked(getClimateTrends).mockRejectedValue(new Error('Request failed: 500'))
    renderAs({ role: 'company_admin', companyId: 'c1' })
    await screen.findByRole('heading', { name: new RegExp(copy.openHeading) })
    expect(rowIds()).toHaveLength(5)
    expect(screen.queryByRole('alert')).toBeNull()
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
    // And every row carries its "···" menu, the archived one included.
    expect(document.querySelectorAll('[data-slot="row-menu"]')).toHaveLength(5)
  })

  it('opens a menu with the survey and a duplicate for an author, and nothing that restores an archived survey', async () => {
    renderAs({ role: 'company_admin', companyId: 'c1' })
    await screen.findByRole('heading', { name: new RegExp(copy.openHeading) })
    expect(await openMenu('copy')).toEqual([copy.viewSurvey, en.surveys.duplicate])
  })

  it('duplicates from the menu and opens the new draft', async () => {
    vi.mocked(duplicateSurvey).mockResolvedValue({ id: 'fresh' } as SurveyDetail)
    renderAs({ role: 'company_admin', companyId: 'c1' })
    await screen.findByRole('heading', { name: new RegExp(copy.openHeading) })
    await openMenu('q3')
    await userEvent.click(screen.getByRole('menuitem', { name: en.surveys.duplicate }))
    expect(await screen.findByTestId('detail')).toBeTruthy()
    expect(vi.mocked(duplicateSurvey).mock.calls[0]?.[1]).toBe('q3')
  })

  it('shows the server’s refusal when a duplicate fails, and keeps the list', async () => {
    vi.mocked(duplicateSurvey).mockRejectedValue(new Error('Survey not found'))
    renderAs({ role: 'company_admin', companyId: 'c1' })
    await screen.findByRole('heading', { name: new RegExp(copy.openHeading) })
    await openMenu('q1')
    await userEvent.click(screen.getByRole('menuitem', { name: en.surveys.duplicate }))
    expect((await screen.findByRole('alert')).textContent).toContain('Survey not found')
    expect(rowIds()).toHaveLength(5)
  })

  it('shows a leader the scoped list with no authoring, no results action and no duplicate', async () => {
    renderAs({ role: 'leader', companyId: 'c1' })
    await screen.findByRole('heading', { name: new RegExp(copy.openHeading) })
    expect(screen.queryByRole('link', { name: en.surveys.newSurvey })).toBeNull()
    expect(document.querySelectorAll('a[data-action="results"]')).toHaveLength(0)
    expect(document.querySelectorAll('a[data-action="distribution"]')).toHaveLength(0)
    expect(document.querySelectorAll('a[data-action="open"]').length).toBe(4)
    expect(vi.mocked(listSurveys).mock.calls[0]?.[1]).toEqual({ status: '', type: '', q: '' })
    expect(await openMenu('q3')).toEqual([copy.viewSurvey])
  })

  it('counts the days to close from today as a day, as the Panel de Control does: 30, not 29, in the afternoon', async () => {
    // 15:00 UTC on 10 Sep: still 10 Sep from UTC-15 to UTC+8. Counted from the instant, a
    // close at 02:03 UTC on 10 Oct is 29.46 days away and printed "29"; from the day, 30.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-10T15:00:00Z'))
    try {
      vi.mocked(listSurveys).mockResolvedValue([
        row({ id: 'open', title: 'Q4', status: 'active', responseCount: 3, targetAudienceCount: 24, endDate: '2026-10-10T02:03:39.148+00:00' }),
      ])
      renderAs({ role: 'company_admin', companyId: 'c1' })
      await waitFor(() => expect(rowOf('open')).toBeTruthy())
      expect(rowOf('open').querySelector('[data-slot="close-note"]')?.textContent).toBe(copy.inDays.replace('{count}', '30'))
    } finally {
      vi.useRealTimers()
    }
  })
})
