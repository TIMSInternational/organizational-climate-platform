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
import { getAllResponsesWorkbook } from '../../api/responseExport'
import { getCompanyStatusWorkbook, getDeliveryAuditWorkbook } from '../../api/statusExport'
import { downloadBlobFile } from '../../../../lib/downloadBlobFile'
import SurveysListNextPage from '../list/SurveysListNextPage'
import en from '../../../../i18n/en.json'
import es from '../../../../i18n/es.json'

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
vi.mock('../../api/responseExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/responseExport')>()),
  getAllResponsesWorkbook: vi.fn(),
}))
vi.mock('../../../../lib/downloadBlobFile', () => ({ downloadBlobFile: vi.fn() }))
vi.mock('../../api/statusExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/statusExport')>()),
  getCompanyStatusWorkbook: vi.fn(),
  getDeliveryAuditWorkbook: vi.fn(),
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

  it('sets each row\'s 11px lines on the body\'s 1.5 leading, as the artboard\'s 61px rows do', async () => {
    renderAs({ role: 'super_admin' })
    await waitFor(() => expect(within(rowOf('a-q1')).getByText('Acme Corporation')).toBeTruthy())
    const lines = [...document.querySelectorAll('tr[data-survey-id] [data-slot="row-meta"], tr[data-survey-id] [data-slot="wave-move"], tr[data-survey-id] [data-slot="close-note"]')]
    expect(lines.length).toBeGreaterThanOrEqual(document.querySelectorAll('tr[data-survey-id]').length)
    for (const line of lines) expect(line.className.split(/\s+/)).toContain('leading-normal')
    // …and each header row is the board's 31px: the card's 8px above the labels, 8px below.
    const heads = [...document.querySelectorAll('[data-section="open"] th')]
    expect(heads.length).toBe(7)
    for (const head of heads) expect(head.className.split(/\s+/)).toEqual(expect.arrayContaining(['pt-0', 'pb-2']))
  })

  /**
   * One colour, one meaning (11 Nov): the open survey wears the blue live chip and every other
   * status the gray one; the chosen status is a raised segment. The open row was Fortaleza's
   * green, a draft Oportunidad's amber, and the chosen pill Crítica's red.
   */
  it('never spends a result colour on a status: Activa is the live chip, the rest gray, the filter a segmented control', async () => {
    renderAs({ role: 'super_admin' })
    await waitFor(() => expect(rowOf('m-q4')).toBeTruthy())
    const live = rowOf('m-q4').querySelector('[data-slot="chip"]') as HTMLElement
    expect(live.getAttribute('data-live')).toBe('true')
    const closed = rowOf('m-q3').querySelector('[data-slot="chip"]') as HTMLElement
    expect(closed.className.split(/\s+/)).toContain('bg-chip-neutral-fill')
    const group = screen.getByRole('group', { name: en.surveys.filterByStatus })
    expect(group.getAttribute('data-slot')).toBe('segmented-control')
    for (const element of document.querySelectorAll('[data-slot="chip"], [data-slot="segmented-control-item"]')) {
      expect(element.className.split(/\s+/).filter((name) => /chip-(good|warning|critical)/.test(name))).toEqual([])
    }
    for (const head of document.querySelectorAll('[data-section="open"] th')) {
      expect(head.className.split(/\s+/)).not.toContain('uppercase')
    }
  })

  it('lays out its filter bar and section heads as the company list does: the segmented control first, then the search and selects at 32px, one head for every group', async () => {
    vi.mocked(listSurveys).mockResolvedValue([...PLATFORM, row({ id: 'm-copy', title: 'Climate Survey Q4 (copy)', status: 'archived', createdAt: '2026-09-10T00:00:00Z' })])
    renderAs({ role: 'super_admin' })
    await waitFor(() => expect(rowOf('m-q4')).toBeTruthy())
    const group = screen.getByRole('group', { name: en.surveys.filterByStatus })
    const search = screen.getByRole('searchbox')
    expect(group.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(group.closest('form[data-slot="list-filters"]')).toBe(search.closest('form[data-slot="list-filters"]'))
    expect(search.closest('form')).toBeTruthy()
    expect(search.className.split(/\s+/)).toContain('h-control-lg')
    const heads = [...document.querySelectorAll('section[data-section] h2')].map((head) => head.className)
    expect(document.querySelector('section[data-section="archived"] h2')).toBeTruthy()
    expect(heads.length).toBeGreaterThanOrEqual(3)
    expect(new Set(heads).size).toBe(1)
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

// The fidelity round's findings on the SuperSurveysList artboard (10 Sep refuter, items 2-4 and 9).
describe('SuperSurveysListView — the artboard\'s order, copy and the Distribución row action', () => {
  const FIX_ROUND: SurveyListItem[] = [
    row({ id: 'a-open', title: 'Acme Q4', companyId: 'acme', status: 'active', targetAudienceCount: 24, responseCount: 1, endDate: '2099-09-26T18:21:20Z' }),
    row({ id: 'm-open', title: 'Meridiano Q4', status: 'active', targetAudienceCount: 24, responseCount: 3, endDate: '2099-10-10T02:03:39Z' }),
    row({ id: 'd1', title: 'Engagement Check', companyId: 'acme', status: 'draft', language: 'en', questionCount: 1, responseCount: 0, endDate: '2026-09-15T22:00:00Z', createdAt: '2026-08-08T04:30:13Z' }),
  ]

  function renderWithDistribution(locale: 'en' | 'es' = 'en') {
    window.localStorage.setItem('preferredLocale', locale)
    setToken(tokenFor({ sub: 'u1', nodoId: '', role: 'super_admin' }))
    return render(
      <TranslationProvider>
        <MemoryRouter initialEntries={['/surveys']}>
          <CompanyContextProvider>
            <Routes>
              <Route path="/surveys" element={<SurveysListNextPage />} />
              <Route path="/surveys/:surveyId/distribution" element={<p data-testid="distribution-route" />} />
            </Routes>
          </CompanyContextProvider>
        </MemoryRouter>
      </TranslationProvider>,
    )
  }

  beforeEach(() => {
    vi.mocked(listSurveys).mockReset()
    vi.mocked(listSurveys).mockResolvedValue(FIX_ROUND)
    vi.mocked(getClimateTrends).mockReset()
    vi.mocked(getClimateTrends).mockRejectedValue(new Error('404'))
    vi.mocked(getAllResponsesWorkbook).mockReset()
    vi.mocked(downloadBlobFile).mockReset()
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
  })

  it('lists the open surveys latest close first — Meridiano (10 Oct) above Acme (26 Sep)', async () => {
    renderWithDistribution()
    await screen.findByText('Acme Q4')
    const open = [...document.querySelectorAll('[data-section="open"] tr[data-survey-id]')].map((el) => el.getAttribute('data-survey-id'))
    expect(open).toEqual(['m-open', 'a-open'])
  })

  it('names the drafts\' one company without its legal form, and says each draft was "creado"', async () => {
    renderWithDistribution('es')
    await screen.findByText('Engagement Check')
    const note = document.querySelector('[data-section="upcoming"] [data-slot="section-note"]')?.textContent ?? ''
    expect(note.startsWith(es.surveys.next.super.draftsSameCompany.replace('{company}', 'Acme') + ',')).toBe(true)
    expect(note).not.toMatch(/Corporation/)
    expect(rowOf('d1').textContent).toMatch(/creado el 8 ago/)
  })

  it('chooses the survey\'s own company before opening its Distribución, so the audience section can load', async () => {
    renderWithDistribution()
    await screen.findByText('Meridiano Q4')
    expect(window.localStorage.getItem(COMPANY_CONTEXT_STORAGE_KEY)).toBeNull()
    await userEvent.click(rowOf('m-open').querySelector('[data-action="distribution"]') as HTMLElement)
    expect(await screen.findByTestId('distribution-route')).toBeTruthy()
    expect(window.localStorage.getItem(COMPANY_CONTEXT_STORAGE_KEY)).toBe('meridiano')
  })

  /**
   * The response workbook (ruled 2026-10-15,
   * `docs/decisions/who-may-see-an-individual-answer.md` §5). The server refuses anyone but a
   * super administrator; the control is hidden from everyone else so the refusal is never the
   * first a reader hears of it.
   */
  describe('the response workbook', () => {
    it('offers a super administrator every response, and hands the file over', async () => {
      const blob = new Blob(['xlsx'])
      vi.mocked(getAllResponsesWorkbook).mockResolvedValue(blob)
      renderAs({ role: 'super_admin' })

      const button = await screen.findByRole('button', { name: copy.exportAll })
      await userEvent.click(button)

      // Waited on the DOWNLOAD, not on the fetch. Waiting on the fetch lets the rest of the
      // chain finish after the test has ended, and the hand-off then lands in the next test's
      // mock — which is exactly how this file first went red.
      await waitFor(() => expect(downloadBlobFile).toHaveBeenCalled())
      expect(vi.mocked(downloadBlobFile).mock.calls[0][1]).toBe(blob)
      expect(vi.mocked(downloadBlobFile).mock.calls[0][0]).toMatch(/^respuestas-clima-\d{4}-\d{2}-\d{2}\.xlsx$/)
    })

    it('says so beside the button when the workbook cannot be prepared, rather than doing nothing', async () => {
      vi.mocked(getAllResponsesWorkbook).mockRejectedValue(new Error('nope'))
      renderAs({ role: 'super_admin' })

      await userEvent.click(await screen.findByRole('button', { name: copy.exportAll }))

      // The button's OWN message, not "an alert": this page renders a NetworkError alert of
      // its own whenever a company's trends fail to load, and `findByRole('alert')` matched
      // that one while the button had done nothing at all.
      await screen.findByText(copy.exportFailed)
      expect(downloadBlobFile).not.toHaveBeenCalled()
    })

    it('does not offer it to a company administrator — the endpoint refuses them', async () => {
      vi.mocked(listSurveys).mockResolvedValue(PLATFORM.filter((survey) => survey.companyId === 'meridiano'))
      renderAs({ role: 'company_admin', companyId: 'meridiano' })

      await screen.findByText('Climate Survey Q4')
      expect(screen.queryByRole('button', { name: copy.exportAll })).toBeNull()
    })
  })
})

/**
 * The two per-company files on the super administrator's /surveys. This is the path TIMS
 * actually uses — they hold no company claim, so the tenant page's button never reached them
 * (`SuperSurveysListView.tsx` records why) — and it had no coverage until the picker landed.
 */
describe('SuperSurveysListView — the company files', () => {
  const pickerCopy = en.surveys.next.statusWorkbook

  /** Distinct `createdAt` per survey, so the sheet order asserted below is not a sort tie. */
  const FILES_ROUND: SurveyListItem[] = [
    row({ id: 'm-clima', title: 'Clima Organizacional', status: 'active', createdAt: '2026-01-01T00:00:00Z' }),
    row({ id: 'm-contra', title: 'Contraloría Empresarial', status: 'closed', createdAt: '2026-02-01T00:00:00Z' }),
    row({ id: 'm-tele', title: 'Teletrabajo', status: 'active', createdAt: '2026-03-01T00:00:00Z' }),
    row({ id: 'm-draft', title: 'Borrador', status: 'draft', createdAt: '2026-04-01T00:00:00Z' }),
    row({ id: 'a-other', title: 'Acme Q1', companyId: 'acme', status: 'active', createdAt: '2026-01-05T00:00:00Z' }),
  ]

  /**
   * `model.company` is the table's Empresa filter, not the shell's company context: the files
   * are offered once a company is named THERE. Picked through the control a reader uses.
   */
  async function pickCompany(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByText('Clima Organizacional')
    await user.selectOptions(screen.getByRole('combobox', { name: copy.colCompany }), 'meridiano')
    await screen.findByRole('button', { name: copy.companyStatus })
  }

  beforeEach(() => {
    window.localStorage.setItem('preferredLocale', 'en')
    vi.mocked(listSurveys).mockReset()
    vi.mocked(listSurveys).mockResolvedValue(FILES_ROUND)
    vi.mocked(getClimateTrends).mockReset()
    vi.mocked(getClimateTrends).mockResolvedValue(MERIDIANO_TRENDS)
    vi.mocked(listCompanies).mockReset()
    vi.mocked(listCompanies).mockResolvedValue([
      { id: 'meridiano', name: 'Grupo Meridiano S.A.', emailDomain: null, industry: null, size: null, country: null, subscriptionTier: null, createdAt: '2026-01-01T00:00:00Z' },
    ])
    vi.mocked(downloadBlobFile).mockReset()
    vi.mocked(getCompanyStatusWorkbook).mockReset()
    vi.mocked(getCompanyStatusWorkbook).mockResolvedValue(new Blob(['xlsx']))
    vi.mocked(getDeliveryAuditWorkbook).mockReset()
    vi.mocked(getDeliveryAuditWorkbook).mockResolvedValue(new Blob(['xlsx']))
  })

  afterEach(() => {
    cleanup()
    clearToken()
    clearCompanyNameCache()
    window.localStorage.clear()
  })

  it('offers both files once a company is chosen', async () => {
    const user = userEvent.setup()
    renderAs({ role: 'super_admin' })
    await screen.findByText('Clima Organizacional')
    // Before a company is picked there is nothing to name, so neither file is offered.
    expect(screen.queryByRole('button', { name: copy.companyStatus })).toBeNull()

    await pickCompany(user)

    expect(await screen.findByRole('button', { name: copy.companyStatus })).toBeTruthy()
    expect(screen.getByRole('button', { name: copy.deliveryAudit })).toBeTruthy()
  })

  it('asks which surveys, lists only this company own non-draft ones, in workbook order', async () => {
    const user = userEvent.setup()
    renderAs({ role: 'super_admin' })
    await pickCompany(user)

    await user.click(screen.getByRole('button', { name: copy.companyStatus }))
    await screen.findByRole('checkbox', { name: pickerCopy.all })

    const names = screen.getAllByRole('checkbox').map((box) => box.getAttribute('aria-label'))
    expect(names).toEqual([pickerCopy.all, 'Clima Organizacional', 'Contraloría Empresarial', 'Teletrabajo'])
    // The draft and the other tenant's survey are not offered.
    expect(screen.queryByRole('checkbox', { name: 'Borrador' })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: 'Acme Q1' })).toBeNull()
  })

  it('names the surveys left ticked when it asks for the workbook', async () => {
    const user = userEvent.setup()
    renderAs({ role: 'super_admin' })
    await pickCompany(user)
    await user.click(screen.getByRole('button', { name: copy.companyStatus }))
    await screen.findByRole('checkbox', { name: pickerCopy.all })

    await user.click(screen.getByRole('checkbox', { name: 'Contraloría Empresarial' }))
    await user.click(screen.getByRole('button', { name: pickerCopy.download }))

    await waitFor(() => expect(vi.mocked(getCompanyStatusWorkbook)).toHaveBeenCalled())
    const [, companyId, ids] = vi.mocked(getCompanyStatusWorkbook).mock.calls[0]
    expect(companyId).toBe('meridiano')
    expect(ids).toEqual(['m-clima', 'm-tele'])
    expect(vi.mocked(downloadBlobFile)).toHaveBeenCalled()
  })

  /** The audit has no sheets to choose between, so it stays a single press. */
  it('downloads the delivery audit in one press, with no picker', async () => {
    const user = userEvent.setup()
    renderAs({ role: 'super_admin' })
    await pickCompany(user)

    await user.click(screen.getByRole('button', { name: copy.deliveryAudit }))

    // The company, not the base URL: CI sets no VITE_API_BASE_URL, so asserting the first
    // argument would pass here and fail there (`ci.yml` sets no VITE_ variables).
    await waitFor(() => expect(vi.mocked(getDeliveryAuditWorkbook)).toHaveBeenCalled())
    expect(vi.mocked(getDeliveryAuditWorkbook).mock.calls[0][1]).toBe('meridiano')
    expect(screen.queryByText(pickerCopy.description)).toBeNull()
  })

  it('says so when the audit cannot be prepared, rather than doing nothing visible', async () => {
    vi.mocked(getDeliveryAuditWorkbook).mockRejectedValue(new Error('nope'))
    const user = userEvent.setup()
    renderAs({ role: 'super_admin' })
    await pickCompany(user)

    await user.click(screen.getByRole('button', { name: copy.deliveryAudit }))

    expect(await screen.findByText(copy.exportFailed)).toBeTruthy()
  })
})
