import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import MicroclimateLivePage from './MicroclimateLivePage'
import { TranslationProvider } from '../../../i18n'
import { LOCALE_STORAGE_KEY } from '../../../i18n/locale'
import { setToken, clearToken } from '../../../auth/token'
import type { LiveResults, MicroclimateDetail } from '../api/microclimates'

function detail(overrides: Partial<MicroclimateDetail> = {}): MicroclimateDetail {
  return {
    id: 'm1',
    title: 'Friday pulse',
    description: 'How the week went',
    companyId: 'c1',
    createdBy: 'u1',
    status: 'active',
    responseCount: 12,
    targetParticipantCount: 40,
    startTime: '2026-08-07T09:00:00Z',
    endTime: '2026-08-07T09:20:00Z',
    anonymousResponses: true,
    showLiveResults: true,
    questions: [],
    language: 'en',
    resolvedLocale: 'en',
    fallbackFields: [],
    ...overrides,
  }
}

function results(overrides: Partial<LiveResults> = {}): LiveResults {
  return {
    sentimentScore: 0,
    engagementLevel: 'medium',
    wordCloud: [],
    responseCount: 12,
    targetParticipantCount: 40,
    ...overrides,
  }
}

function routeFetch(microclimate: MicroclimateDetail, live: LiveResults) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    const body = url.includes('/live-results') ? live : microclimate
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
  })
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/microclimates/m1/live']}>
        <Routes>
          <Route path="/microclimates/:id/live" element={<MicroclimateLivePage />} />
        </Routes>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

function liveCalls(): number {
  return vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes('/live-results'))
    .length
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

describe('MicroclimateLivePage', () => {
  it('shows participation from the live endpoint, not from the detail payload', async () => {
    // The detail is fetched once and goes stale the instant somebody answers. Every
    // number on this page has to come off the poll.
    routeFetch(detail({ responseCount: 0 }), results({ responseCount: 19 }))
    renderPage()

    // Rendered twice on purpose -- once in the KPI row and once as the animated
    // headline counter -- so this asserts presence, not uniqueness.
    expect((await screen.findAllByText('19')).length).toBeGreaterThan(0)
  })

  it('polls only while the session is open', async () => {
    routeFetch(detail({ status: 'closed' }), results())
    renderPage()

    expect(await screen.findByText('This session has closed')).toBeTruthy()
    await waitFor(() => expect(screen.getByText(/only available while/)).toBeTruthy())
    // A page left open on a closed session must not keep hitting the API for a
    // number that cannot change.
    expect(liveCalls()).toBe(0)
  })

  it('tells a draft session when it opens instead of showing an empty dashboard', async () => {
    routeFetch(detail({ status: 'draft' }), results())
    renderPage()

    expect(await screen.findByText('Microclimate Scheduled')).toBeTruthy()
    expect(liveCalls()).toBe(0)
  })

  it('designs the no-responses state rather than leaving a blank panel', async () => {
    routeFetch(detail(), results({ responseCount: 0 }))
    renderPage()

    expect(await screen.findByText('No responses yet')).toBeTruthy()
    // The counters stay: "0 of 40" identifies nobody and is exactly the number that
    // says whether to keep chasing.
    expect(screen.getByText('Expected participants')).toBeTruthy()
  })

  it('withholds the word cloud below the disclosure floor, visibly', async () => {
    // Two respondents, and an admin who knows the team can read back what each of
    // them typed. Blanking the panel would read as "nobody wrote anything".
    routeFetch(
      detail(),
      results({
        responseCount: 2,
        wordCloud: [{ text: 'visa', value: 2, language: 'en' }],
      }),
    )
    renderPage()

    expect(await screen.findByText('Word cloud withheld')).toBeTruthy()
    expect(screen.queryByText('visa')).toBeNull()
  })

  it('shows the words once there are enough responses, and reports what it dropped', async () => {
    routeFetch(
      detail(),
      results({
        responseCount: 12,
        wordCloud: [
          { text: 'workload', value: 6, language: 'en' },
          { text: 'visa', value: 1, language: 'en' },
        ],
      }),
    )
    renderPage()

    // `ChartFrame` also renders the same data as a table for screen readers, so the
    // word appears more than once in the DOM by design.
    expect((await screen.findAllByText('workload')).length).toBeGreaterThan(0)
    expect(screen.queryByText('visa')).toBeNull()
    expect(screen.getByText(/1 words said only once are withheld/)).toBeTruthy()
  })

  it('renders no sentiment figure, because the server hardcodes it to zero', async () => {
    // `SubmitResponseAsync` assigns SentimentScore = 0 on every submission. A gauge
    // at neutral is a claim about the workforce; a stated absence is not.
    routeFetch(detail(), results({ sentimentScore: 0 }))
    renderPage()

    expect(await screen.findByText('Sentiment analysis is not enabled')).toBeTruthy()
  })

  it('surfaces the respondent link on an anonymous session', async () => {
    renderPage()
    expect(await screen.findByText(/\/microclimates\/m1\/respond$/)).toBeTruthy()
  })

  it('does not offer a public link when responses require signing in', async () => {
    routeFetch(detail({ anonymousResponses: false }), results())
    renderPage()

    await screen.findByText('Live Results')
    expect(screen.queryByText(/\/microclimates\/m1\/respond$/)).toBeNull()
  })

  it('keeps the last good numbers and marks them stalled when a poll fails', async () => {
    // The failure `LiveResultsPanel` had: a bare `catch {}` left a plausible figure
    // on screen with nothing saying it had stopped updating.
    renderPage()

    // Anchored on the panel's CONTENT, not on the 'Live' badge — this is the fix for a
    // flake that turned main red on 2026-08-09 (node 25 only, 1 of 1647).
    //
    // `usePolling` derives `isStale = consecutiveFailures > 0 && data !== null`, and the
    // badge reads 'Live' whenever polling is enabled and not stale — which includes the
    // window BEFORE the first poll has returned anything. So `findByText('Live')` could
    // resolve while `data` was still null; the rejecting mock installed straight after it
    // then produced a failure that could never satisfy the `data !== null` half, and
    // 'Updates stalled' never appeared. Under full-suite load the first poll is slower,
    // which is exactly why this only ever failed on a busy runner and passed in isolation.
    //
    // The render prop below `RealTimeChartContainer` is only invoked with data, so
    // 'Live Participation' on screen is proof the first poll succeeded.
    await screen.findByText('Live Participation')

    vi.mocked(fetch).mockRejectedValue(new Error('offline'))
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    await waitFor(() => expect(screen.getByText('Updates stalled')).toBeTruthy())
    expect(screen.getByText('Expected participants')).toBeTruthy()
  })

  it('says the content is in the other language rather than substituting silently', async () => {
    routeFetch(detail({ language: 'es', resolvedLocale: 'es' }), results())
    renderPage()

    expect(await screen.findByText('Language of this content')).toBeTruthy()
  })
})
