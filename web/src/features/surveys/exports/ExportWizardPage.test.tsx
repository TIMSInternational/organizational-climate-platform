import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { TranslationProvider } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import { CompanyContextProvider } from '../../../company-context'
import { tokenFor } from '../../../test/jwtFixture'
import en from '../../../i18n/en.json'
import ExportWizardPage from './ExportWizardPage'

vi.mock('../../../api/authFetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/authFetch')>()),
  authFetch: vi.fn(),
}))
vi.mock('../../../lib/downloadBlobFile', () => ({ downloadBlobFile: vi.fn() }))
const { authFetch } = await import('../../../api/authFetch')
const { downloadBlobFile } = await import('../../../lib/downloadBlobFile')

const copy = en.exportWizard

const SURVEYS = [
  { id: 's1', title: 'Clima 2026', companyId: 'c1', type: 'periodic', status: 'closed', language: 'es', startDate: '2026-02-03T00:00:00Z', endDate: '2026-02-28T00:00:00Z', responseCount: 412, targetAudienceCount: 486, questionCount: 57, createdAt: '2026-01-10T00:00:00Z' },
  { id: 's2', title: 'Pulso', companyId: 'c1', type: 'periodic', status: 'active', language: 'es', startDate: '2026-11-03T00:00:00Z', endDate: '2026-11-28T00:00:00Z', responseCount: 96, targetAudienceCount: 486, questionCount: 8, createdAt: '2026-11-02T00:00:00Z' },
  { id: 's3', title: 'Borrador', companyId: 'c1', type: 'periodic', status: 'draft', language: 'es', startDate: '2027-02-03T00:00:00Z', endDate: '2027-02-28T00:00:00Z', responseCount: 0, targetAudienceCount: null, questionCount: 10, createdAt: '2026-11-05T00:00:00Z' },
]

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

function routeFetch() {
  vi.mocked(authFetch).mockImplementation(async (url: string) => {
    if (url.includes('/exports/bundle')) return new Response('zip', { status: 200, headers: { 'content-type': 'application/zip' } })
    if (url.includes('/surveys?')) return json({ surveys: SURVEYS })
    if (url.includes('/demographic-fields')) return json({ fields: [{ id: 'f1', companyId: 'c1', field: 'gender', label: 'Gender', type: 'select', options: null, required: false, order: 0, isActive: true, resolvedLocale: 'en', fallbackFields: [] }] })
    if (url.endsWith('/admin/companies')) return json({ companies: [{ id: 'c1', name: 'Cooperativa Austral', emailDomain: null, industry: null, size: null, country: null, subscriptionTier: null, createdAt: '2026-01-01T00:00:00Z' }] })
    return json({})
  })
}

function bundleQuery(): URLSearchParams {
  const url = vi.mocked(authFetch).mock.calls.map((call) => String(call[0])).filter((u) => u.includes('/exports/bundle')).at(-1)!
  return new URL(url, 'https://api.test').searchParams
}

function renderAs(role: string, companyId?: string) {
  setToken(tokenFor({ sub: 'u1', nodoId: '', role, ...(companyId ? { companyId } : {}) }))
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/surveys/exports']}>
        <CompanyContextProvider>
          <Routes>
            <Route path="/surveys/exports" element={<ExportWizardPage />} />
          </Routes>
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

async function next(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: en.common.next }))
}

describe('«Descargar en Excel»', () => {
  beforeEach(() => {
    vi.mocked(authFetch).mockReset()
    vi.mocked(downloadBlobFile).mockReset()
    routeFetch()
  })

  afterEach(() => {
    cleanup()
    clearToken()
  })

  it('never offers a client’s administrator the response workbook, and downloads the other three as a zip', async () => {
    const user = userEvent.setup()
    renderAs('company_admin', 'c1')

    await screen.findByText('Clima 2026')
    expect(screen.queryByRole('radio', { name: 'Cooperativa Austral' })).toBeNull()
    await next(user)

    expect(screen.queryByText(copy.files.responses.title)).toBeNull()
    expect(screen.getByText(copy.files.results.title)).toBeTruthy()
    await next(user)
    await next(user)
    await user.click(screen.getByRole('button', { name: copy.submitZip }))

    await waitFor(() => expect(downloadBlobFile).toHaveBeenCalled())
    const query = bundleQuery()
    expect(query.getAll('file')).toEqual(['questionnaire', 'status', 'results'])
    expect(query.getAll('survey')).toEqual([])
    expect(query.getAll('group')).toEqual(['department'])
    expect(vi.mocked(downloadBlobFile).mock.calls[0][0]).toMatch(/^downloads-\d{4}-\d{2}-\d{2}\.zip$/)
  })

  it('lets a client pick some surveys, never a draft', async () => {
    const user = userEvent.setup()
    renderAs('company_admin', 'c1')

    await screen.findByText('Clima 2026')
    await user.click(screen.getByRole('button', { name: copy.surveys.chosen }))
    expect((screen.getByRole('checkbox', { name: copy.surveys.draftLabel.replace('{title}', 'Borrador') }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(screen.getByRole('checkbox', { name: copy.surveys.includeOne.replace('{title}', 'Pulso') }))
    await next(user)
    await user.click(screen.getByRole('checkbox', { name: new RegExp(copy.files.status.title) }))
    await user.click(screen.getByRole('checkbox', { name: new RegExp(copy.files.results.title) }))
    await next(user)
    await next(user)
    await user.click(screen.getByRole('button', { name: copy.submit }))

    await waitFor(() => expect(downloadBlobFile).toHaveBeenCalled())
    expect(bundleQuery().getAll('survey')).toEqual(['s1'])
    expect(bundleQuery().getAll('file')).toEqual(['questionnaire'])
  })

  it('walks TIMS through the company first and offers the response workbook marked as TIMS only', async () => {
    const user = userEvent.setup()
    renderAs('super_admin')

    await user.click(await screen.findByRole('radio', { name: 'Cooperativa Austral' }))
    await next(user)
    await screen.findByText('Clima 2026')
    await next(user)

    expect(screen.getByText(copy.files.responses.title)).toBeTruthy()
    expect(screen.getAllByText(copy.files.timsOnly).length).toBeGreaterThan(0)
    await next(user)
    await next(user)
    await user.click(screen.getByRole('button', { name: copy.submitZip }))

    await waitFor(() => expect(downloadBlobFile).toHaveBeenCalled())
    expect(bundleQuery().getAll('file')).toEqual(['responses', 'questionnaire', 'status', 'results'])
    expect(vi.mocked(authFetch).mock.calls.some((call) => String(call[0]).includes('/admin/companies/c1/exports/bundle'))).toBe(true)
  })
})
