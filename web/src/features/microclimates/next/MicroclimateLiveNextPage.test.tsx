import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import MicroclimateLiveNextPage from './MicroclimateLiveNextPage'
import type { LiveResults, MicroclimateDetail } from '../api/microclimates'
import { TranslationProvider } from '../../../i18n'
import { LOCALE_STORAGE_KEY } from '../../../i18n/locale'
import { clearToken, setToken } from '../../../auth/token'
import { CompanyContextProvider } from '../../../company-context'
import { tokenFor } from '../../../test/jwtFixture'

/**
 * The redesigned live session (`/microclimates/:id/live`), against the MicroclimateLive
 * artboard. The old page's guarantees, re-asserted on the new screen: the figure comes
 * from a later poll and not merely from mounting, only an open session polls, a failed
 * read keeps the last good figure and says so, what people wrote is withheld under the
 * floor without leaking how much, and nothing derived from a missing target is printed.
 */

function detail(overrides: Partial<MicroclimateDetail> = {}): MicroclimateDetail {
  return {
    id: 'm1',
    title: 'Friday pulse — how was the week?',
    description: null,
    companyId: 'c1',
    createdBy: 'u1',
    status: 'active',
    responseCount: 12,
    targetParticipantCount: 40,
    startTime: new Date(2026, 8, 9, 21, 6).toISOString(),
    endTime: new Date(2026, 8, 11, 21, 6).toISOString(),
    anonymousResponses: true,
    showLiveResults: true,
    questions: [
      { id: 'q1', text: 'How did it feel?', type: 'likert', options: null, required: true, order: 0 },
      { id: 'q2', text: 'In one word', type: 'open_ended', options: null, required: false, order: 1 },
    ],
    language: 'en',
    resolvedLocale: 'en',
    fallbackFields: [],
    ...overrides,
  }
}

function results(overrides: Partial<LiveResults> = {}): LiveResults {
  return { sentimentScore: 0, engagementLevel: 'medium', wordCloud: [], responseCount: 13, targetParticipantCount: 40, ...overrides }
}

function routeFetch(microclimate: MicroclimateDetail, live: LiveResults) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
    const body = String(input).includes('/live-results') ? live : microclimate
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
  })
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/microclimates/m1/live']}>
        <CompanyContextProvider>
          <Routes>
            <Route path="/microclimates/:id/live" element={<MicroclimateLiveNextPage />} />
          </Routes>
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

function liveCalls(): number {
  return vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes('/live-results')).length
}

function figure(): string | null {
  return document.querySelector('[data-slot="live-figure"]')?.textContent ?? null
}

function wordsBlock(): HTMLElement {
  const block = document.querySelector('[data-slot="live-words"]')
  if (!(block instanceof HTMLElement)) throw new Error('no words block')
  return block
}

beforeEach(() => {
  localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
  setToken(tokenFor({ role: 'company_admin', companyId: 'c1' }))
  vi.stubGlobal('fetch', vi.fn())
  routeFetch(detail(), results())
})

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.clear()
  // Unconditional: two tests install fake timers, and leaving them in place makes every
  // later file in the same worker hang on its first `waitFor`.
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the figure', () => {
  it('reads the count from /live-results, in the figure face', async () => {
    renderPage()
    // The detail says 12; the poll says 13. 13 on screen is proof the poll landed.
    await waitFor(() => expect(figure()).toBe('13'))
    expect(document.querySelector('[data-slot="live-figure"]')?.className).toMatch(/font-mono/)
    expect(screen.getByText('of 40 expected responses')).toBeTruthy()
  })

  it('moves on a later poll, not merely from having mounted', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let count = 13
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const body = String(input).includes('/live-results') ? results({ responseCount: count }) : detail()
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    })
    renderPage()
    await waitFor(() => expect(figure()).toBe('13'))

    count = 15
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(figure()).toBe('13')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    await waitFor(() => expect(figure()).toBe('15'))
  })

  it('keeps the last good figure and says it stopped updating when a read fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderPage()
    await waitFor(() => expect(figure()).toBe('13'))
    expect(screen.getByText(/^Live · updated at /)).toBeTruthy()

    vi.mocked(fetch).mockRejectedValue(new Error('offline'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000)
    })

    await waitFor(() => expect(screen.getByText(/^Not updating · last reading at /)).toBeTruthy())
    expect(figure()).toBe('13')
  })

  it('polls only while the session is open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    routeFetch(detail({ status: 'draft' }), results())
    renderPage()
    await screen.findByText('The session has not opened yet. The figure starts rising when it opens.')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12000)
    })
    expect(liveCalls()).toBe(0)
  })

  it('reads a closed session’s final figure once, never on a loop', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    routeFetch(detail({ status: 'closed' }), results({ responseCount: 18 }))
    renderPage()
    await waitFor(() => expect(figure()).toBe('18'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12000)
    })
    expect(liveCalls()).toBe(1)
    expect(screen.queryByText(/^Live · /)).toBeNull()
  })

  it('keeps the sentence beside the figure however many digits the count grows to', async () => {
    routeFetch(detail(), results({ responseCount: 1234, targetParticipantCount: 2000 }))
    renderPage()
    await waitFor(() => expect(figure()).toBe('1,234'))
    // The artboard's row is flex with its items at the end and no wrap: the sentence
    // narrows and wraps inside its own column. A wrapping row dropped it under the figure
    // the moment the count reached two digits (the 12-response shot, 11 Sep).
    const row = document.querySelector('[data-slot="live-figure"]')!.parentElement!
    expect(row.className.split(/\s+/)).not.toContain('flex-wrap')
    expect(row.lastElementChild!.className.split(/\s+/)).toContain('min-w-0')
  })

  it('prints nothing derived from a target the session does not have', async () => {
    routeFetch(detail({ targetParticipantCount: 0 }), results({ targetParticipantCount: 0, responseCount: 31 }))
    renderPage()
    await waitFor(() => expect(figure()).toBe('31'))

    expect(screen.getByText('responses, with no expected count')).toBeTruthy()
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(document.querySelector('[data-slot="live-scale"]')).toBeNull()
  })
})

describe('what people wrote', () => {
  it('under the floor, is the hatch and the published floor — no word, and no count of what is held back', async () => {
    routeFetch(detail(), results({ responseCount: 3, wordCloud: [{ text: 'visa', value: 2, language: 'en' }, { text: 'handover', value: 1, language: 'en' }] }))
    renderPage()
    await waitFor(() => expect(figure()).toBe('3'))

    const block = wordsBlock()
    expect(within(block).getByText('Protected until 5 responses')).toBeTruthy()
    expect(block.querySelector('[data-slot="words-hatch"]')).toBeTruthy()
    expect(screen.queryByText('visa')).toBeNull()
    expect(screen.queryByText('handover')).toBeNull()
    // "2 words held back" or "2 more to go" inverts into the sub-floor count. The only
    // number this block may carry is the floor itself.
    expect((block.textContent ?? '').replace(/5/g, '')).not.toMatch(/\d/)
  })

  it('above the floor, is word frequencies: the rare words dropped and reported, never an answer', async () => {
    routeFetch(
      detail(),
      results({
        responseCount: 12,
        wordCloud: [
          { text: 'support', value: 4, language: 'en' },
          { text: 'workload', value: 7, language: 'en' },
          { text: 'visa', value: 1, language: 'en' },
        ],
      }),
    )
    renderPage()

    // Inside the words block: the breadcrumb is a list too, and comes first.
    await waitFor(() => expect(figure()).toBe('12'))
    const bars = within(wordsBlock()).getByRole('list')
    const items = within(bars).getAllByRole('listitem').map((item) => item.textContent)
    expect(items).toEqual(['workload7', 'support4'])
    expect(screen.queryByText('visa')).toBeNull()
    expect(screen.getByText('1 rare word is held back.')).toBeTruthy()
    expect(within(wordsBlock()).queryByText('Protected until 5 responses')).toBeNull()
  })

  it('prints no sentiment, which the server hardcodes', async () => {
    routeFetch(detail(), results({ sentimentScore: 0.42 }))
    renderPage()
    await waitFor(() => expect(figure()).toBe('13'))
    expect(screen.queryByText(/sentiment/i)).toBeNull()
    expect(screen.queryByText(/0\.42/)).toBeNull()
  })
})

describe('to respond', () => {
  it('offers the link and its QR on an open anonymous session', async () => {
    renderPage()
    const link = await screen.findByText((_, node) => node?.getAttribute('data-slot') === 'respond-link')

    expect(link.textContent).toMatch(/\/microclimates\/m1\/respond$/)
    expect(link.textContent).not.toMatch(/^https?:/)
    expect(screen.getByRole('img', { name: 'QR code of the respond link' })).toBeTruthy()
  })

  it('copies the absolute respond URL', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Copy' }))

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/microclimates/m1/respond`)
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy()
  })

  it('offers neither link nor QR for a named session', async () => {
    routeFetch(detail({ anonymousResponses: false }), results())
    renderPage()

    expect(await screen.findByText(/This session is named/)).toBeTruthy()
    expect(document.querySelector('[data-slot="respond-link"]')).toBeNull()
    expect(screen.queryByRole('img', { name: 'QR code of the respond link' })).toBeNull()
    expect(screen.getByText('Named · disclosure floor 5')).toBeTruthy()
  })

  it('states the questions and the floor among the facts', async () => {
    renderPage()
    expect(await screen.findByText('2 · a scale from 1 to 5, one word (optional)')).toBeTruthy()
    expect(screen.getByText('Anonymous · disclosure floor 5')).toBeTruthy()
  })

  it('wears no sample chip: every field has an endpoint', async () => {
    renderPage()
    await waitFor(() => expect(figure()).toBe('13'))
    expect(screen.queryByText('Sample data')).toBeNull()
  })
})

describe('by role', () => {
  it('a company administrator may close an open session, through PUT with the status', async () => {
    let status = 'active'
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'PUT') status = 'closed'
      const body = url.includes('/live-results') ? results() : detail({ status })
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Close the session' }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close the session' }))

    await waitFor(() => expect(screen.getByText('Closed')).toBeTruthy())
    const put = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(String(put?.[0])).toMatch(/\/microclimates\/m1$/)
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ status: 'closed' })
    // Closed: nothing left to close.
    expect(screen.queryByRole('button', { name: 'Close the session' })).toBeNull()
  })

  it('a super administrator watches and may close with no company chosen: the id names the session', async () => {
    setToken(tokenFor({ role: 'super_admin' }))
    renderPage()
    await waitFor(() => expect(figure()).toBe('13'))
    expect(screen.getByRole('button', { name: 'Close the session' })).toBeTruthy()
  })

  it('offers no close on a session that is not open', async () => {
    routeFetch(detail({ status: 'draft' }), results())
    renderPage()
    await screen.findByText('The session has not opened yet. The figure starts rising when it opens.')
    expect(screen.queryByRole('button', { name: 'Close the session' })).toBeNull()
  })

  it.each(['leader', 'supervisor', 'employee'])('a %s is told whose screen this is, and never sent a request that could only 403', async (role) => {
    setToken(tokenFor({ role, companyId: 'c1' }))
    renderPage()

    expect(await screen.findByText('Microclimates belong to the administration')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Close the session' })).toBeNull()
    await waitFor(() => expect(vi.mocked(fetch)).not.toHaveBeenCalled())
  })
})
