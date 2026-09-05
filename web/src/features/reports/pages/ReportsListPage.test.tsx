import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import ReportsListPage from './ReportsListPage'
import { TranslationProvider } from '../../../i18n'
import { setToken } from '../../../auth/token'
import { downloadBlobFile } from '../../../lib/downloadBlobFile'
import type { ReportListItem } from '../api/reports'

// The real helper creates an object URL and clicks an anchor; happy-dom has neither a
// download manager nor `URL.createObjectURL`. Mocked exactly as SurveyResultsPage.test.tsx
// mocks it, so the assertion is on the (name, blob) pair the page hands over.
vi.mock('../../../lib/downloadBlobFile', () => ({ downloadBlobFile: vi.fn() }))

function reportRow(overrides: Partial<ReportListItem> = {}): ReportListItem {
  return {
    id: 'r1',
    title: 'Q3 climate summary',
    type: 'summary',
    companyId: 'c1',
    status: 'completed',
    format: 'pdf',
    createdAt: '2026-07-01T09:00:00Z',
    // A report carries no schedule until somebody sets one -- `is_recurring` defaults to
    // false in the column, which is the state every report in production is in.
    isRecurring: false,
    recurrencePattern: null,
    nextGeneration: null,
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
    vi.mocked(downloadBlobFile).mockClear()
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

  it('saves the rendered file and names it for the row format', async () => {
    // The response body IS the document now. Before this change the download returned a
    // `ReportDetail` and the page could only report a counter; a test asserting on that
    // counter went green against an endpoint that produced no file at all.
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse([reportRow({ format: 'csv' })]))
      .mockResolvedValueOnce(new Response(new Blob(['"section"\r\n']), { status: 200 }))
    renderPage()

    await screen.findByText('Q3 climate summary')
    await userEvent.click(screen.getByRole('button', { name: 'Download' }))

    await waitFor(() => expect(vi.mocked(downloadBlobFile)).toHaveBeenCalled())
    const [fileName, blob] = vi.mocked(downloadBlobFile).mock.calls.at(-1)!
    expect(fileName).toBe('report-r1.csv')
    expect(await blob.text()).toBe('"section"\r\n')

    const notice = await screen.findByText(/Downloaded Q3 climate summary/)
    expect(notice.getAttribute('role')).toBe('status')
    expect(notice.textContent).toContain('report-r1.csv')
  })

  it('shows the backend refusal and saves nothing when the download fails', async () => {
    // `authFetch` turns a non-2xx into a throw, so a failed download must not hand
    // `downloadBlobFile` a blob of the error JSON -- which is what a browser saves as a
    // .pdf if the page does not check.
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse([reportRow()]))
      .mockResolvedValueOnce(jsonResponse({ message: 'Report is not ready for download' }, 400))
    renderPage()

    await screen.findByText('Q3 climate summary')
    await userEvent.click(screen.getByRole('button', { name: 'Download' }))

    expect(await screen.findByText('Report is not ready for download')).toBeTruthy()
    expect(vi.mocked(downloadBlobFile)).not.toHaveBeenCalled()
  })

  it('offers Share only for a completed report, and absent rather than disabled', async () => {
    // A share link to a report that is not `completed` resolves to the public page's flat
    // 404 (`ReportShareEndpoints.ResolveAsync`), so an admin who minted one would forward a
    // link that shows the recipient nothing. Absent, not disabled: a disabled Download says
    // "not yet"; a disabled Share would advertise a public link for a document that does not
    // exist.
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse([
        reportRow({ id: 'r1', title: 'Ready', status: 'completed' }),
        reportRow({ id: 'r2', title: 'Still generating', status: 'generating' }),
      ]),
    )
    renderPage()

    await screen.findByText('Ready')
    expect(screen.getAllByRole('button', { name: 'Download' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Share' })).toHaveLength(1)
  })

  it('opens the share panel for the row that was clicked', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse([reportRow({ id: 'r7', title: 'Ready' })]))
      // The panel's own first call, listing that report's links.
      .mockResolvedValueOnce(jsonResponse([]))
    renderPage()

    await screen.findByText('Ready')
    await userEvent.click(screen.getByRole('button', { name: 'Share' }))

    expect(await screen.findByRole('dialog')).toBeTruthy()
    // Scoped to r7, not to whatever row the state happened to hold.
    await waitFor(() =>
      // `VITE_API_BASE_URL` is unset under vitest, so the page's baseUrl is `undefined` --
      // the assertion is on the PATH, which is what carries the report id.
      expect(String(vi.mocked(fetch).mock.calls[1][0])).toContain(
        '/admin/reports/r7/shares',
      ),
    )
  })

  it('no longer claims that rendering is not built', async () => {
    // The banner this page carried for a year (`reports.generationStubbed`) said "no file is
    // produced". A stale disclosure is worse than none: an admin who reads it concludes the
    // file they just saved is not real.
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([reportRow()]))
    renderPage()

    await screen.findByText('Q3 climate summary')
    expect(screen.queryByText(/rendering is not built/i)).toBeNull()
    expect(screen.queryByText(/no file is produced/i)).toBeNull()
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

  // -- recurring schedules (#91) --------------------------------------------------------
  //
  // The columns these exercise were read by `ScheduledReportJob` and written by nothing, so
  // the sweep selected no row, ever. The page half of the fix is that a schedule is visible
  // from the row and changeable without leaving the list.

  /** What the PUT/DELETE hand back -- the whole report, schedule included. */
  function scheduledReport(overrides: Record<string, unknown> = {}) {
    return {
      id: 'r1',
      title: 'Q3 climate summary',
      description: null,
      type: 'summary',
      companyId: 'c1',
      createdBy: 'u1',
      templateId: null,
      status: 'completed',
      format: 'pdf',
      reportOutput: null,
      downloadCount: 0,
      generationStartedAt: null,
      generationCompletedAt: null,
      createdAt: '2026-07-01T09:00:00Z',
      isRecurring: true,
      recurrencePattern: 'weekly',
      nextGeneration: '2026-07-08T09:00:00Z',
      ...overrides,
    }
  }

  it('says a report is not scheduled, and names the pattern once it is', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse([
        reportRow(),
        reportRow({
          id: 'r2',
          title: 'Monthly board pack',
          isRecurring: true,
          recurrencePattern: 'monthly',
          nextGeneration: '2026-08-01T09:00:00Z',
        }),
      ]),
    )
    renderPage()

    expect(await screen.findByText('Not scheduled')).toBeTruthy()
    // The pattern reads as the word the form offers, not as the wire value `monthly`.
    expect(screen.getByText('Monthly')).toBeTruthy()
  })

  it('saves the chosen pattern and updates the row without refetching the list', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([reportRow()]))
    renderPage()
    await screen.findByText('Q3 climate summary')

    await userEvent.click(screen.getByRole('button', { name: 'Schedule' }))
    await userEvent.selectOptions(screen.getByLabelText('Repeats'), 'weekly')

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(scheduledReport()))
    await userEvent.click(screen.getByRole('button', { name: 'Save schedule' }))

    await waitFor(() => expect(screen.getByText('Weekly')).toBeTruthy())

    const [url, init] = vi.mocked(fetch).mock.calls[1]
    expect(String(url)).toContain('/admin/reports/r1/schedule')
    expect(init?.method).toBe('PUT')
    const body = JSON.parse(init?.body as string) as Record<string, unknown>
    expect(body.pattern).toBe('weekly')
    // No first run was typed, so none is sent -- the server then computes one period ahead in
    // the COMPANY's timezone, which this browser does not know.
    expect('startAt' in body).toBe(false)

    // Two calls total: the list, then the PUT. The response carries the new schedule, so a
    // third request to re-read what was just returned would be a spinner for nothing.
    expect(vi.mocked(fetch).mock.calls).toHaveLength(2)
  })

  it('stops a recurring report and the row goes back to not scheduled', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse([
        reportRow({ isRecurring: true, recurrencePattern: 'weekly', nextGeneration: '2026-07-08T09:00:00Z' }),
      ]),
    )
    renderPage()
    await screen.findByText('Weekly')

    await userEvent.click(screen.getByRole('button', { name: 'Schedule' }))
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(scheduledReport({ isRecurring: false, recurrencePattern: null, nextGeneration: null })),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Stop recurring' }))

    await waitFor(() => expect(screen.getByText('Not scheduled')).toBeTruthy())
    expect(vi.mocked(fetch).mock.calls[1][1]?.method).toBe('DELETE')
  })

  it('offers Stop only for a report that is actually recurring', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([reportRow()]))
    renderPage()
    await screen.findByText('Q3 climate summary')

    await userEvent.click(screen.getByRole('button', { name: 'Schedule' }))

    // Present, it would answer 200 and change nothing on every report in the company.
    expect(screen.queryByRole('button', { name: 'Stop recurring' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Save schedule' })).toBeTruthy()
  })

  it("surfaces the server's own refusal rather than a generic message", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([reportRow()]))
    renderPage()
    await screen.findByText('Q3 climate summary')

    await userEvent.click(screen.getByRole('button', { name: 'Schedule' }))
    // The two refusals the endpoint can send both name what to do about them; replacing them
    // with "Something went wrong" would throw away the only actionable part.
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ message: 'The first occurrence must be in the future.' }, 400),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save schedule' }))

    expect(await screen.findByText('The first occurrence must be in the future.')).toBeTruthy()
  })
})
