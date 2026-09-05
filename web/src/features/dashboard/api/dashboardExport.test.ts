import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import {
  dashboardExportFileName,
  getCompanyDashboardExport,
  getDepartmentDashboardExport,
} from './dashboardExport'

const baseUrl = 'http://api.test'

function file(): Response {
  return new Response(new Blob(['"section","label","value"\r\n']), { status: 200 })
}

function requestedUrl(): string {
  return vi.mocked(fetch).mock.calls[0][0] as string
}

/**
 * These assert the **URL and the headers**, which together are the whole contract.
 *
 * The headers matter as much as the query string here, and more than they do for a JSON
 * client: an authorized download fetched the wrong way fails in the one way nobody notices
 * in review — an `<a href>` sends cookies rather than the bearer token, so the request is
 * anonymous and the server answers 401 with a file dialog already open.
 */
describe('dashboard export client', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the bearer token, because a download link would send cookies instead', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(file())

    await getCompanyDashboardExport(baseUrl, 'csv')

    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer test-token')
  })

  it('always names a format, so the server never has to guess', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(file())

    await getCompanyDashboardExport(baseUrl, 'pdf')

    expect(requestedUrl()).toBe(`${baseUrl}/dashboard/company-admin/export?format=pdf`)
  })

  it('omits a company id rather than serialising undefined', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(file())

    await getCompanyDashboardExport(baseUrl, 'csv', { companyId: undefined, lang: 'es' })

    expect(requestedUrl()).toBe(`${baseUrl}/dashboard/company-admin/export?format=csv&lang=es`)
    expect(requestedUrl()).not.toContain('undefined')
  })

  it('passes a company id when a super admin supplies one', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(file())

    await getCompanyDashboardExport(baseUrl, 'csv', { companyId: 'abc-123' })

    expect(requestedUrl()).toBe(`${baseUrl}/dashboard/company-admin/export?format=csv&companyId=abc-123`)
  })

  it('asks for the department export with no department id by default', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(file())

    await getDepartmentDashboardExport(baseUrl, 'csv')

    expect(requestedUrl()).toBe(`${baseUrl}/dashboard/department-admin/export?format=csv`)
  })

  it('returns the body as a blob rather than parsing it', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(file())

    const blob = await getCompanyDashboardExport(baseUrl, 'csv')

    expect(blob).toBeInstanceOf(Blob)
    expect(await blob.text()).toContain('"section","label","value"')
  })
})

/**
 * The name is what makes the file findable in a folder three months later, so it is pinned
 * rather than left to whatever the browser would have guessed from the URL.
 */
describe('dashboard export file name', () => {
  const day = new Date(2026, 8, 5)

  it('slugs the subject and stamps the day', () => {
    expect(dashboardExportFileName('Acme Costa Rica', 'pdf', day)).toBe('acme-costa-rica-20260905.pdf')
  })

  it('keeps accented letters and collapses punctuation, matching the server', () => {
    // The server's `Content-Disposition` name uses `char.IsLetterOrDigit`, which keeps `í`
    // and `ñ`. If these two rules disagree the same export has two names.
    expect(dashboardExportFileName('Ingeniería & Diseño', 'csv', day)).toBe('ingeniería-diseño-20260905.csv')
  })

  it('falls back to a usable name when the subject slugs to nothing', () => {
    expect(dashboardExportFileName('———', 'csv', day)).toBe('dashboard-20260905.csv')
  })

  it('pads single-digit months and days, so names sort chronologically', () => {
    expect(dashboardExportFileName('Acme', 'csv', new Date(2026, 0, 7))).toBe('acme-20260107.csv')
  })
})
