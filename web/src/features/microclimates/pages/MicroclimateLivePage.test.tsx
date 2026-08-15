import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, cleanup, waitFor } from '@testing-library/react'
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
  // Unconditional: one test swaps in fake timers, and leaving them installed
  // makes every later file in the same worker hang on its first `waitFor`.
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('MicroclimateLivePage', () => {
  it('shows participation from the live endpoint, not from the detail payload', async () => {
    // The detail is fetched once and goes stale the instant somebody answers. Every
    // number on this page has to come off the poll.
    routeFetch(detail({ responseCount: 0 }), results({ responseCount: 19 }))
    renderPage()

    expect((await screen.findAllByText('19')).length).toBeGreaterThan(0)
  })

  it('sets every reading in the figure face, which is the whole typographic thesis', async () => {
    routeFetch(detail(), results({ responseCount: 19, targetParticipantCount: 40 }))
    renderPage()

    // `tabular-nums` is the load-bearing half: a count that ticks over every four
    // seconds must not shift width as it goes from 9 to 10.
    const reading = await screen.findByText('19')
    expect(reading.className).toContain('font-mono')
    expect(reading.className).toContain('tabular-nums')

    // The label beside it stays in the sans face -- if everything is mono, nothing
    // reads as a reading.
    expect(screen.getByText('Responses').className).not.toContain('font-mono')
  })

  it('prints the participation rate once, not as two different roundings', async () => {
    // 31/48 is 64.583%. `formatMetric` defaults to one decimal for a non-integer,
    // so the tile read "64.6%" beside the meter's rounded "65%" -- one ratio,
    // printed twice, in two numbers that do not match.
    routeFetch(detail(), results({ responseCount: 31, targetParticipantCount: 48 }))
    renderPage()

    // The tile and the meter, agreeing.
    expect(await screen.findAllByText('65%')).toHaveLength(2)
    expect(screen.queryByText('64.6%')).toBeNull()
  })

  it('re-renders from a later poll, not merely from having mounted', async () => {
    // The trap this repository already paid for: a test that asserts on the "Live"
    // badge proves the component mounted, because `usePolling` reports `isStale`
    // as `failures > 0 && data !== null` and therefore reads "Live" during the
    // window before the first poll has returned anything. The only honest proof
    // that polling works is a number that CHANGES on a later tick.
    vi.useFakeTimers({ shouldAdvanceTime: true })

    let responseCount = 12
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      const body = url.includes('/live-results') ? results({ responseCount }) : detail()
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    })

    renderPage()
    await screen.findByText('12')

    // Two responses land. Nothing on screen knows yet.
    responseCount = 14
    expect(screen.queryAllByText('14')).toHaveLength(0)

    // A short advance is not enough, so this cannot be satisfied by a re-render
    // on some other cause. It is not a precise assertion about `POLL_MS` itself:
    // `shouldAdvanceTime` ties fake time to real time, so `waitFor` below moves
    // the clock on by up to its own timeout as well. What it does pin down is
    // that the interval fires at all — mutating `usePolling`'s `setInterval` to a
    // no-op turns this test red, while leaving the initial mount fetch intact.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(screen.queryAllByText('14')).toHaveLength(0)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    // `findAllByText`, not `findByText`: once a second distinct total has arrived
    // the trend line has two points, so `ChartFrame` also renders 14 in the table
    // it exposes to screen readers.
    await waitFor(() => expect(screen.getAllByText('14').length).toBeGreaterThan(0))
    // Yet to respond moved with it: 40 - 14. Only the reading carries this one.
    expect(screen.getByText('26')).toBeTruthy()
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

  it('withholds what people wrote below the floor, and shows that it is withholding', async () => {
    // Two respondents, and an admin who knows the team can read back what each of
    // them typed. Blanking the panel would read as "nobody wrote anything" -- so
    // the panel is replaced by a hatched, padlocked, labelled cell instead.
    routeFetch(
      detail(),
      results({
        responseCount: 2,
        wordCloud: [{ text: 'visa', value: 2, language: 'en' }],
      }),
    )
    renderPage()

    // `ProtectedCell` renders the hatch as `role="img"` with the floor in its name,
    // so a screen reader gets the same statement the hatch makes visually.
    const hatch = await screen.findByRole('img', {
      name: 'What people wrote: protected — withheld below 5 responses',
    })
    expect(hatch).toBeTruthy()
    expect(screen.getByText('Protected')).toBeTruthy()
    expect(screen.queryByText('visa')).toBeNull()
  })

  it('never leaks the sub-floor count through the withheld panel', async () => {
    // The count itself is deliberately public -- "2 of 40 so far" identifies
    // nobody and is what tells an admin whether to keep chasing. What must not
    // appear is a sub-floor BREAKDOWN, and the subtle version of that leak is
    // arithmetic: "3 more responses needed" is inverted in one step to recover the
    // exact count the floor exists to hide.
    routeFetch(
      detail(),
      results({
        responseCount: 2,
        wordCloud: [
          { text: 'visa', value: 2, language: 'en' },
          { text: 'redundancy', value: 1, language: 'en' },
        ],
      }),
    )
    renderPage()

    const hatch = await screen.findByRole('img', {
      name: 'What people wrote: protected — withheld below 5 responses',
    })
    const panel = hatch.closest('section')
    expect(panel).not.toBeNull()

    // Every number anywhere in that panel, including its accessible names. The
    // only figure it is allowed to state is the floor itself, which is a published
    // constant rather than a fact about these two people.
    const text = `${panel?.textContent ?? ''} ${panel?.querySelector('[role="img"]')?.getAttribute('aria-label') ?? ''}`
    expect(text.match(/\d+/g)).toEqual(['5', '5'])

    // The count is still on the page, in the readings row, where it belongs.
    expect(screen.getByText('2')).toBeTruthy()
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
    // a KPI label on screen is proof the first poll succeeded. (It used to anchor
    // on the 'Live Participation' heading `KPIDisplay` drew; the redesign replaced
    // that card grid with the flat `KpiTile` strip, which has no heading of its
    // own -- the tile labels are the equivalent, and they are equally only ever
    // rendered from a poll result.)
    await screen.findByText('Expected participants')

    vi.mocked(fetch).mockRejectedValue(new Error('offline'))
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    await waitFor(() => expect(screen.getByText('Updates stalled')).toBeTruthy())
    expect(screen.getByText('Expected participants')).toBeTruthy()
  })

  it('states the disclosure floor before anything is withheld, not only after', async () => {
    // An admin watching a session with four responses should be able to see WHY
    // the wording is not there yet. The floor is on the session plate, which is
    // rendered from the one-shot detail fetch and therefore present in every
    // state -- including this one, where nothing is being withheld at all.
    routeFetch(detail(), results({ responseCount: 12 }))
    renderPage()

    expect(await screen.findByText('Disclosure floor')).toBeTruthy()
    const floor = screen.getByText('Disclosure floor').nextElementSibling
    expect(floor?.textContent).toBe('5')
  })

  it('puts the session facts on the plate rather than inside the polled panel', async () => {
    // None of these move while the session runs, so they are fetched once. A value
    // that never changes, redrawn every four seconds inside a block labelled
    // "live", teaches the reader to distrust the block.
    routeFetch(
      detail({
        anonymousResponses: false,
        questions: [
          { id: 'q1', text: 'How was the week?', type: 'likert', options: null, required: true, order: 1 },
          { id: 'q2', text: 'Anything else?', type: 'open_ended', options: null, required: false, order: 2 },
        ],
      }),
      results(),
    )
    renderPage()

    expect(await screen.findByText('Questions')).toBeTruthy()
    expect(screen.getByText('Questions').nextElementSibling?.textContent).toBe('2')
    // A word, not a reading -- and it says which of the two modes this session is
    // in, rather than leaving the reader to infer it from the missing link.
    expect(screen.getByText('Signed in')).toBeTruthy()
  })

  it('says the content is in the other language rather than substituting silently', async () => {
    routeFetch(detail({ language: 'es', resolvedLocale: 'es' }), results())
    renderPage()

    expect(await screen.findByText('Language of this content')).toBeTruthy()
  })

  it('gates the plate on the plate, never on the viewport', async () => {
    // happy-dom has no layout, so this cannot check that the row is unbroken --
    // that was measured in Chromium. What it CAN pin is the thing that made the
    // row break: a viewport query standing in for a width the viewport does not
    // determine. `AdminLayout` renders a fixed 220px rail from `md` upward
    // (`hidden md:flex`, `--admin-size-sidebar: 220px`), so widening the window
    // from 700px to 768px makes this section NARROWER, and any `sm:`/`md:`/`lg:`
    // gate on it is wrong in that direction by construction.
    renderPage()

    const plate = (await screen.findByText('Opened')).closest('dl')
    expect(plate).not.toBeNull()
    expect(plate?.parentElement?.className).toContain('@container')

    const gates = [...(plate?.className ?? '').matchAll(/(\S+):grid-cols-\d+/g)].map(
      (match) => match[1],
    )
    expect(gates.length).toBeGreaterThan(0)
    expect(gates.filter((gate) => !gate.startsWith('@'))).toEqual([])
  })

  it('drops every reading derived from a target the session does not have', async () => {
    // `targetParticipantCount` is not required to be positive, so this state is
    // reachable. Printing "expected participants 0" and "yet to respond 0" beside
    // a non-zero response count states three things that cannot all be true.
    routeFetch(
      detail({ targetParticipantCount: 0 }),
      results({ responseCount: 7, targetParticipantCount: 0 }),
    )
    renderPage()

    expect(await screen.findByText('Responses')).toBeTruthy()
    expect(screen.queryByText('Expected participants')).toBeNull()
    expect(screen.queryByText('Yet to respond')).toBeNull()
    expect(screen.queryByText('Participation')).toBeNull()
    // And the strip narrows to what it has, rather than stranding empty cells.
    const strip = screen.getByText('Responses').closest('[class*="grid-cols-"]')
    expect(strip?.className).toContain('grid-cols-1')
    expect(strip?.className).not.toContain('grid-cols-4')
  })
})
