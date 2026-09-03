import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import MicroclimateResultsPage from './MicroclimateResultsPage'
import { TranslationProvider } from '../../../i18n'
import { LOCALE_STORAGE_KEY } from '../../../i18n/locale'
import { setToken, clearToken } from '../../../auth/token'
import type { LiveResults, MicroclimateDetail } from '../api/microclimates'

function detail(overrides: Partial<MicroclimateDetail> = {}): MicroclimateDetail {
  return {
    id: 'm1',
    title: 'Friday pulse',
    description: null,
    companyId: 'c1',
    createdBy: 'u1',
    status: 'closed',
    responseCount: 24,
    targetParticipantCount: 40,
    startTime: '2026-08-07T09:00:00Z',
    endTime: '2026-08-07T09:20:00Z',
    anonymousResponses: true,
    showLiveResults: true,
    questions: [
      { id: 'q1', text: 'How was the week?', type: 'open_ended', options: null, required: true, order: 1 },
    ],
    language: 'en',
    resolvedLocale: 'en',
    fallbackFields: [],
    ...overrides,
  }
}

function results(overrides: Partial<LiveResults> = {}): LiveResults {
  return {
    sentimentScore: 0,
    engagementLevel: 'high',
    wordCloud: [
      { text: 'workload', value: 9, language: 'en' },
      { text: 'trabajo', value: 5, language: 'es' },
    ],
    responseCount: 24,
    targetParticipantCount: 40,
    ...overrides,
  }
}

function routeFetch(microclimate: MicroclimateDetail, live: LiveResults) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) =>
    Promise.resolve(
      new Response(JSON.stringify(String(input).includes('/live-results') ? live : microclimate), {
        status: 200,
      }),
    ),
  )
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/microclimates/m1/results']}>
        <Routes>
          <Route path="/microclimates/:id/results" element={<MicroclimateResultsPage />} />
        </Routes>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

beforeEach(() => {
  localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
  setToken('test-token')
  vi.stubGlobal('fetch', vi.fn())
  routeFetch(detail(), results())
})

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('MicroclimateResultsPage', () => {
  it('reads the detail and the live results together, and does not poll', async () => {
    renderPage()
    await screen.findByText('Questions asked')

    const before = vi.mocked(fetch).mock.calls.length
    expect(before).toBe(2)
    // A results page is a page load. Polling behind static content would show a
    // counter ticking above panels that never move.
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(vi.mocked(fetch).mock.calls.length).toBe(before)
  })

  it('states that there is no per-question breakdown rather than leaving a gap', async () => {
    // Microclimate answers are counted into an aggregate; there is no
    // `microclimate_responses` table. An admin who does not know that keeps looking.
    renderPage()

    expect(await screen.findByText('No per-question breakdown')).toBeTruthy()
    expect(screen.getByText(/Use a survey when you need that/)).toBeTruthy()
  })

  it('keeps the two languages in separate bars', async () => {
    // `CountWordFrequencies` keys on (language, word) so "work" and "trabajo" are not
    // one entry. Summing them here would undo that on the way to the screen.
    renderPage()
    // The heading appears twice by design: once as the section `<h2>` and once as
    // the chart's own accessible title.
    await screen.findAllByText('Most frequent words')

    expect((await screen.findAllByText('workload')).length).toBeGreaterThan(0)
    expect((await screen.findAllByText('trabajo')).length).toBeGreaterThan(0)
  })

  it('withholds wording below the disclosure floor', async () => {
    routeFetch(detail({ responseCount: 3 }), results({ responseCount: 3 }))
    renderPage()

    expect(await screen.findByText('Word cloud withheld')).toBeTruthy()
    expect(screen.queryByText('workload')).toBeNull()
  })

  it('omits the participation split rather than drawing a whole out of nothing', async () => {
    // A part-to-whole chart with a target of zero would render one 100% wedge, which
    // claims full participation from a session that recorded no expected audience.
    routeFetch(detail({ targetParticipantCount: 0 }), results({ targetParticipantCount: 0 }))
    renderPage()

    expect(
      await screen.findByText('No invitation total, so there is no response rate to show'),
    ).toBeTruthy()
  })

  it('lists the questions that were asked, with translated type names', async () => {
    renderPage()

    expect(await screen.findByText('How was the week?')).toBeTruthy()
    expect(screen.getByText('Text Response')).toBeTruthy()
  })

  it('renders the load failure with a retry rather than a blank page', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('offline'))
    renderPage()

    // The retry affordance is what this test is named for. It used to prove that by
    // asserting the EXCEPTION text was on screen, which quietly made "show the user
    // err.message" a guarantee the suite defended — and a browser TypeError then put
    // the words "Failed to fetch" in front of an end user. `authFetch` now turns a
    // transport failure into a sentence, so the stand-in message no longer surfaces.
    expect(await screen.findByText(/Network error/)).toBeTruthy()
    expect(screen.queryByText('offline')).toBeNull()

    routeFetch(detail(), results())
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByText('Questions asked')).toBeTruthy())
  })

  it('offers the live view only while the session is still open', async () => {
    renderPage()
    await screen.findByText('Questions asked')
    expect(screen.queryByRole('link', { name: 'View Live' })).toBeNull()

    cleanup()
    routeFetch(detail({ status: 'active' }), results())
    renderPage()
    expect(await screen.findByRole('link', { name: 'View Live' })).toBeTruthy()
  })
})

describe('MicroclimateResultsPage KPI strip', () => {
  /**
   * The redesign's flat strip, asserted through `data-slot` rather than through label text
   * -- the labels also appear in the panels below, so `getByText` could pass by matching
   * one of those. `KPIDisplay` renders no `data-slot="kpi-tile"`, so reverting this screen
   * to the old card grid fails here; without this the whole suite stayed green through the
   * conversion, which is what makes it worth writing.
   */
  it('renders its readings as the redesign\u2019s KPI tiles', async () => {
    const { container } = renderPage()
    await screen.findByText('Questions asked')

    const tiles = [...container.querySelectorAll('[data-slot="kpi-tile"]')]
    expect(tiles.length).toBeGreaterThan(0)
    expect(container.querySelector('[data-slot="kpi-tile"] .font-mono')).not.toBeNull()
  })

  describe('the CSV export', () => {
    /**
     * `GET /microclimates/{id}/export/csv` existed for a month with no caller. These pin
     * the three things a caller can get wrong: the URL shape (the path form, not the legacy
     * `?format=csv`), the bearer header (an `<a href>` would send cookies and 401), and the
     * language request.
     */
    function routeFetchWithCsv(csvBody = 'question,answer\n') {
      vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/export/csv')) {
          return Promise.resolve(new Response(csvBody, { status: 200, headers: { 'content-type': 'text/csv' } }))
        }
        return Promise.resolve(new Response(JSON.stringify(url.includes('/live-results') ? results() : detail()), { status: 200 }))
      })
    }

    it('fetches /export/csv with the bearer token and the reader\u2019s language, then hands the blob to the browser', async () => {
      routeFetchWithCsv()
      const createObjectURL = vi.fn(() => 'blob:csv')
      const revokeObjectURL = vi.fn()
      vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }))
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

      renderPage()
      await screen.findByRole('heading', { name: 'Friday pulse' })
      await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }))

      await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1))
      const exportCall = vi.mocked(fetch).mock.calls.find(([input]) => String(input).includes('/export'))
      expect(exportCall).toBeDefined()
      const [input, init] = exportCall!
      expect(String(input)).toMatch(/\/microclimates\/m1\/export\/csv\?lang=en$/)
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-token')
      expect(click).toHaveBeenCalledTimes(1)
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:csv')
    })

    it('reports a failed export in the page\u2019s own words, on the page, without replacing it', async () => {
      vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/export/csv')) {
          return Promise.resolve(new Response(JSON.stringify({ message: 'raw server text' }), { status: 500 }))
        }
        return Promise.resolve(new Response(JSON.stringify(url.includes('/live-results') ? results() : detail()), { status: 200 }))
      })
      renderPage()
      await screen.findByRole('heading', { name: 'Friday pulse' })
      await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }))

      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toContain('The export did not download')
      expect(alert.textContent).toContain('Failed to export data. Please try again.')
      // The raw exception never reaches the screen, and the page it was on is still there.
      expect(alert.textContent).not.toContain('raw server text')
      expect(screen.getByRole('heading', { name: 'Friday pulse' })).toBeTruthy()
      expect((screen.getByRole('button', { name: 'Export CSV' }) as HTMLButtonElement).disabled).toBe(false)
    })

    it('is offered for a closed microclimate too — the export is not a live-session feature', async () => {
      routeFetch(detail({ status: 'closed' }), results())
      renderPage()
      await screen.findByRole('heading', { name: 'Friday pulse' })
      expect(screen.getByRole('button', { name: 'Export CSV' })).toBeTruthy()
      expect(screen.queryByRole('link', { name: /live/i })).toBeNull()
    })
  })
})
