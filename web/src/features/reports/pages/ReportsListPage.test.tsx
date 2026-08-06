import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import ReportsListPage from './ReportsListPage'
import { TranslationProvider } from '../../../i18n'
import { setToken } from '../../../auth/token'
import type { ReportListItem } from '../api/reports'

function reportRow(overrides: Partial<ReportListItem> = {}): ReportListItem {
  return {
    id: 'r1',
    title: 'Q3 climate summary',
    type: 'summary',
    companyId: 'c1',
    status: 'completed',
    format: 'pdf',
    createdAt: '2026-07-01T09:00:00Z',
    ...overrides,
  }
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/admin/companies/c1/reports']}>
        <Routes>
          <Route path="/admin/companies/:companyId/reports" element={<ReportsListPage />} />
        </Routes>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

describe('ReportsListPage', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    // No `globals: true` in vite.config.ts, so RTL's auto-cleanup never registers.
    cleanup()
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('scopes the request to the company in the URL, not to the viewer', async () => {
    // The whole reason this page is safe for a SuperAdmin: the company comes from the
    // address bar, so there is no implicit scope to be silently wrong about. If this
    // ever started reading claims.companyId instead, a SuperAdmin would be shown their
    // own user row's company while the URL said otherwise.
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([reportRow()]))
    renderPage()

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain('/admin/reports?companyId=c1')
  })

  it('shows a loading state before the first response arrives, announced once', async () => {
    let resolve: (value: Response) => void = () => {}
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise<Response>((r) => {
        resolve = r
      }),
    )
    renderPage()

    const region = document.querySelector('[data-slot="loading-region"]')
    expect(region?.getAttribute('aria-busy')).toBe('true')
    // Exactly one -- the sr-only live region inside LoadingRegion. A visible
    // "Loading..." paragraph alongside it would make a screen reader say it twice.
    expect(screen.getAllByText('Loading...')).toHaveLength(1)
    expect(document.querySelector('[data-slot="skeleton-text"]')).toBeTruthy()

    resolve(jsonResponse([]))
    await waitFor(() => expect(screen.queryByText('Loading...')).toBeNull())
  })

  it('shows an empty state rather than a bare table when there are no reports', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([]))
    renderPage()

    expect(await screen.findByText('No reports yet')).toBeTruthy()
    expect(document.querySelector('table')).toBeNull()
  })

  it('shows an error state with a working retry when the list fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ message: 'Boom' }, 500))
    renderPage()

    expect(await screen.findByText('Boom')).toBeTruthy()

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([reportRow()]))
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Q3 climate summary')).toBeTruthy()
  })

  it('renders the table inside the overflow container the Table primitive owns', async () => {
    // #218: a bare <table> no longer gets `width: 100%` from the base layer, and more
    // importantly gets no scroll container, so six columns escape a 320px viewport.
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([reportRow()]))
    renderPage()

    await screen.findByText('Q3 climate summary')
    const table = document.querySelector('table')
    expect(table?.parentElement?.getAttribute('data-slot')).toBe('table-container')
  })

  it('shows the same labels the create form offered, not the raw wire values', async () => {
    // The form's dropdown says "Summary" / "PDF"; a row that then said `summary` /
    // `pdf` reads as though the choice was not saved -- and in Spanish it would still
    // say `summary` next to a form that said "Resumen".
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse([reportRow({ type: 'executive', format: 'csv' })]),
    )
    renderPage()

    await screen.findByText('Q3 climate summary')
    expect(screen.getByText('Executive')).toBeTruthy()
    expect(screen.getByText('CSV')).toBeTruthy()
    expect(screen.queryByText('executive')).toBeNull()
  })

  it('falls back to the server value for a type it ships no label for', async () => {
    // `type` and `format` are unvalidated free text on the wire, so an unknown value
    // must render as itself rather than as a missing catalogue key.
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([reportRow({ type: 'bespoke' })]))
    renderPage()

    await screen.findByText('Q3 climate summary')
    expect(screen.getByText('bespoke')).toBeTruthy()
  })

  it('only offers Download for a completed report, because the backend 400s otherwise', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse([
        reportRow({ id: 'r1', title: 'Ready', status: 'completed' }),
        reportRow({ id: 'r2', title: 'Still generating', status: 'generating' }),
      ]),
    )
    renderPage()

    await screen.findByText('Ready')
    const buttons = screen.getAllByRole('button', { name: 'Download' }) as HTMLButtonElement[]
    expect(buttons).toHaveLength(2)
    expect(buttons[0].disabled).toBe(false)
    expect(buttons[1].disabled).toBe(true)
  })

  it('reports the download count from the response, which the list projection does not carry', async () => {
    // `ReportListItem` has no `downloadCount` -- only the detail returned by the
    // download call does -- so reloading the list would throw the number away.
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse([reportRow()]))
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'r1',
          title: 'Q3 climate summary',
          description: null,
          type: 'summary',
          companyId: 'c1',
          createdBy: 'u1',
          templateId: null,
          status: 'completed',
          format: 'pdf',
          reportOutput: '"stub"',
          downloadCount: 3,
          generationStartedAt: null,
          generationCompletedAt: null,
          createdAt: '2026-07-01T09:00:00Z',
        }),
      )
    renderPage()

    await screen.findByText('Q3 climate summary')
    await userEvent.click(screen.getByRole('button', { name: 'Download' }))

    const notice = await screen.findByText(/Download recorded for Q3 climate summary/)
    expect(notice.getAttribute('role')).toBe('status')
    expect(notice.textContent).toContain('3')
  })

  it('omits an untouched description instead of sending an empty string', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({}, 201))
      .mockResolvedValueOnce(jsonResponse([]))
    renderPage()

    await screen.findByText('No reports yet')
    await userEvent.click(screen.getByRole('button', { name: 'New report' }))
    await userEvent.type(screen.getByLabelText('Title'), 'Ad hoc')
    await userEvent.click(screen.getByRole('button', { name: 'Create report' }))

    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(1))
    const [, init] = vi.mocked(fetch).mock.calls[1]
    const body = JSON.parse(init?.body as string) as Record<string, unknown>
    expect(body.title).toBe('Ad hoc')
    expect(body.companyId).toBe('c1')
    expect('description' in body).toBe(false)
  })
})
