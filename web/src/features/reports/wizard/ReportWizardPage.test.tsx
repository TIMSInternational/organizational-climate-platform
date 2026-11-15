import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { TranslationProvider } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import { CompanyContextProvider } from '../../../company-context'
import { tokenFor } from '../../../test/jwtFixture'
import en from '../../../i18n/en.json'
import type { SurveyReportOptions, SurveyReportPreview } from '../api/surveyReport'
import ReportWizardPage from './ReportWizardPage'

vi.mock('../../../api/authFetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/authFetch')>()),
  authFetch: vi.fn(),
}))
vi.mock('../../../lib/downloadBlobFile', () => ({ downloadBlobFile: vi.fn() }))
const { authFetch } = await import('../../../api/authFetch')
const { downloadBlobFile } = await import('../../../lib/downloadBlobFile')

const copy = en.reportWizard
const CID = 'c1'

const OPTIONS: SurveyReportOptions = {
  surveyId: 's1',
  title: 'Clima Organizacional 2026',
  status: 'closed',
  resolvedLocale: 'en',
  isSuppressed: false,
  completedCount: 412,
  invitedCount: 486,
  departments: [
    { id: 'd1', name: 'Operaciones', respondentCount: 118, headcount: 132 },
    { id: 'd2', name: 'Legal', respondentCount: 18, headcount: 24 },
  ],
  variables: [
    { field: 'department', label: 'Department', valueCount: 2 },
    { field: 'gender', label: 'Gender', valueCount: 3 },
  ],
  comparableSurveys: [{ id: 's0', title: 'Clima Organizacional 2025', status: 'closed', endDate: null }],
  sections: ['summary', 'dimensions', 'map', 'comparison', 'crosses', 'questions', 'highlights', 'comments'],
  defaultSections: ['summary', 'dimensions', 'map', 'comparison', 'crosses', 'questions', 'highlights'],
  maxCrosses: 4,
  scale: 'mean',
}

const PREVIEW: SurveyReportPreview = {
  pageCount: 9,
  disclosedCells: 4,
  protectedCells: 2,
  departmentCount: 2,
  omittedDepartmentCount: 0,
  crosses: [
    { rowField: 'department', columnField: 'gender', rowName: 'Department', columnName: 'Gender', rows: 2, columns: 3, groups: 6, disclosed: 4, protected: 2 },
  ],
}

const SURVEYS = [
  { id: 's1', title: 'Clima Organizacional 2026', companyId: CID, type: 'periodic', status: 'closed', language: 'es', startDate: '2026-02-03T00:00:00Z', endDate: '2026-02-28T00:00:00Z', responseCount: 412, targetAudienceCount: 486, questionCount: 57, createdAt: '2026-01-10T00:00:00Z' },
  { id: 's2', title: 'Borrador 2027', companyId: CID, type: 'periodic', status: 'draft', language: 'es', startDate: '2027-02-03T00:00:00Z', endDate: '2027-02-28T00:00:00Z', responseCount: 0, targetAudienceCount: null, questionCount: 10, createdAt: '2026-11-01T00:00:00Z' },
  { id: 's3', title: 'Pulso sin respuestas', companyId: CID, type: 'periodic', status: 'active', language: 'es', startDate: '2026-11-03T00:00:00Z', endDate: '2026-11-28T00:00:00Z', responseCount: 0, targetAudienceCount: 486, questionCount: 8, createdAt: '2026-11-02T00:00:00Z' },
]

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

function routeFetch() {
  vi.mocked(authFetch).mockImplementation(async (url: string) => {
    if (url.includes('/report/options')) return json(OPTIONS)
    if (url.includes('/report/preview')) return json(PREVIEW)
    if (url.includes('/export/report')) return new Response('%PDF-1.4', { status: 200, headers: { 'content-type': 'application/pdf' } })
    if (url.includes('/surveys?')) return json({ surveys: SURVEYS })
    return json({})
  })
}

function urls(fragment: string): string[] {
  return vi.mocked(authFetch).mock.calls.map((call) => String(call[0])).filter((url) => url.includes(fragment))
}

function renderPage() {
  setToken(tokenFor({ sub: 'u1', nodoId: '', role: 'company_admin', companyId: CID }))
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={[`/admin/companies/${CID}/reports/new`]}>
        <CompanyContextProvider>
          <Routes>
            <Route path="/admin/companies/:companyId/reports/new" element={<ReportWizardPage />} />
          </Routes>
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

async function next(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: en.common.next }))
}

describe('«Generar informe»', () => {
  beforeEach(() => {
    vi.mocked(authFetch).mockReset()
    vi.mocked(downloadBlobFile).mockReset()
    routeFetch()
  })

  afterEach(() => {
    cleanup()
    clearToken()
  })

  it('offers only the surveys with something to report', async () => {
    renderPage()

    expect(await screen.findByRole('radio', { name: 'Clima Organizacional 2026' })).toBeTruthy()
    expect(screen.queryByRole('radio', { name: 'Borrador 2027' })).toBeNull()
    expect(screen.queryByRole('radio', { name: 'Pulso sin respuestas' })).toBeNull()
  })

  it('downloads the PDF the steps describe, with the cross and the departments chosen', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('radio', { name: 'Clima Organizacional 2026' }))
    await screen.findByRole('option', { name: 'Clima Organizacional 2025' })
    await next(user)

    // Alcance: only Operaciones.
    await user.click(screen.getByRole('button', { name: copy.scope.chosen }))
    await user.click(screen.getByRole('checkbox', { name: 'Include Legal' }))
    await next(user)

    // Cruces: Department × Gender, then the preview's count of protected cells.
    await user.click(screen.getByRole('button', { name: copy.crosses.add }))
    const row = await screen.findByText('Department × Gender')
    const item = row.closest('[data-slot="cross-row"]') as HTMLElement
    await waitFor(() => expect(within(item).getByText('2 protected')).toBeTruthy(), { timeout: 4000 })
    await next(user)
    await next(user)

    await user.click(screen.getByRole('button', { name: copy.submit }))

    await waitFor(() => expect(downloadBlobFile).toHaveBeenCalled())
    expect(vi.mocked(downloadBlobFile).mock.calls[0][0]).toBe('report-clima-organizacional-2026.pdf')
    const asked = new URL(urls('/export/report').at(-1)!, 'https://api.test')
    expect(asked.pathname).toMatch(/\/surveys\/s1\/export\/report$/)
    expect(asked.searchParams.getAll('cross')).toEqual(['department*gender'])
    expect(asked.searchParams.getAll('department')).toEqual(['d1'])
    expect(asked.searchParams.get('sections')).toContain('crosses')
    expect(asked.searchParams.get('sections')).not.toContain('comparison')
  })

  it('states the real page count and protected cells beside the steps', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('radio', { name: 'Clima Organizacional 2026' }))

    await screen.findByText(copy.aside.pages.replace('{count}', '9'), undefined, { timeout: 4000 })
    const privacy = screen.getByRole('region', { name: copy.aside.privacyTitle })
    expect(within(privacy).getByText('2')).toBeTruthy()
    expect(within(privacy).getByText(copy.aside.never)).toBeTruthy()
  })
})
