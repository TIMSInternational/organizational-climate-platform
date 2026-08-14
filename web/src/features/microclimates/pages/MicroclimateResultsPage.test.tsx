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

    expect(await screen.findByText('offline')).toBeTruthy()

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
})
