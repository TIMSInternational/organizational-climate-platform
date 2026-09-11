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
import tokensCss from '../../../styles/tokens.css?raw'
import themeCss from '../../../styles/theme.css?raw'

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
      // The detail says 11, so a 12 on screen can only be the poll's — the reading the
      // bars are drawn from. With both at 12 the wait passed before the poll landed.
      detail({ responseCount: 11 }),
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

  it('before any reading lands, says there is none — not that nobody wrote', async () => {
    // The detail alone is above the floor; the live read never settles.
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) =>
      String(input).includes('/live-results')
        ? new Promise<Response>(() => {})
        : Promise.resolve(new Response(JSON.stringify(detail()), { status: 200 })),
    )
    renderPage()
    await waitFor(() => expect(figure()).toBe('12'))

    expect(within(wordsBlock()).getByText('No reading of the words yet.')).toBeTruthy()
    expect(screen.queryByText('Nobody has written a word yet.')).toBeNull()
  })

  it('when the first reading fails, still says there is none — not that nobody wrote', async () => {
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) =>
      String(input).includes('/live-results')
        ? Promise.reject(new Error('offline'))
        : Promise.resolve(new Response(JSON.stringify(detail()), { status: 200 })),
    )
    renderPage()
    await waitFor(() => expect(liveCalls()).toBeGreaterThan(0))
    await waitFor(() => expect(figure()).toBe('12'))

    expect(within(wordsBlock()).getByText('No reading of the words yet.')).toBeTruthy()
    expect(screen.queryByText('Nobody has written a word yet.')).toBeNull()
  })

  it('once a reading lands with no word in it, says nobody has written one', async () => {
    routeFetch(detail({ responseCount: 11 }), results({ responseCount: 13, wordCloud: [] }))
    renderPage()
    await waitFor(() => expect(figure()).toBe('13'))

    expect(within(wordsBlock()).getByText('Nobody has written a word yet.')).toBeTruthy()
    expect(screen.queryByText('No reading of the words yet.')).toBeNull()
  })

  it('prints no sentiment, which the server hardcodes', async () => {
    routeFetch(detail(), results({ sentimentScore: 0.42 }))
    renderPage()
    await waitFor(() => expect(figure()).toBe('13'))
    expect(screen.queryByText(/sentiment/i)).toBeNull()
    expect(screen.queryByText(/0\.42/)).toBeNull()
  })
})

/**
 * The QR's two colours, read end to end: the classes the rendered code carries, the
 * `--admin-*` variable `theme.css` resolves each to, and that variable's value in each
 * palette of `tokens.css`, the dark one layered over the light as the browser cascades them.
 */
function qrPalettes(): { light: Record<string, string>; dark: Record<string, string> } {
  const cut = tokensCss.indexOf(":root[data-admin-theme='dark']")
  expect(cut, 'tokens.css no longer declares a dark palette').toBeGreaterThan(0)
  const declarations = (block: string): Record<string, string> =>
    Object.fromEntries([...block.matchAll(/(--admin-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
  const light = declarations(tokensCss.slice(tokensCss.indexOf(':root {'), cut))
  return { light, dark: { ...light, ...declarations(tokensCss.slice(cut)) } }
}

function adminVariableOf(utility: string): string {
  const declared = new RegExp(`--color-${utility}:\\s*var\\((--admin-[\\w-]+)\\)`).exec(themeCss)
  expect(declared, `theme.css declares no --color-${utility}`).not.toBeNull()
  return declared![1]
}

function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex)
  expect(match, `not a six-digit hex: ${hex}`).not.toBeNull()
  const [r, g, b] = [0, 2, 4].map((i) => {
    const scaled = Number.parseInt(match![1].slice(i, i + 2), 16) / 255
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

describe('the QR', () => {
  it('prints dark modules on white paper in both themes, at 7:1 or more, for a code meant to be projected', async () => {
    renderPage()
    const qr = await screen.findByRole('img', { name: 'QR code of the respond link' })
    const ink = /(?:^|\s)text-([a-z0-9-]+)/.exec(qr.getAttribute('class') ?? '')
    const paper = /(?:^|\s)fill-([a-z0-9-]+)/.exec(qr.querySelector('rect')?.getAttribute('class') ?? '')
    expect(ink, 'the code carries no text-* ink class').not.toBeNull()
    expect(paper, 'the paper carries no fill-* class').not.toBeNull()
    const inkVariable = adminVariableOf(ink![1])
    const paperVariable = adminVariableOf(paper![1])

    const { light, dark } = qrPalettes()
    for (const [theme, palette] of [['light', light], ['dark', dark]] as const) {
      // Dark on light, as ISO/IEC 18004 assumes: an inverted code is at the scanner's mercy.
      expect(relativeLuminance(palette[inkVariable]), theme).toBeLessThan(relativeLuminance(palette[paperVariable]))
      expect(contrastRatio(palette[inkVariable], palette[paperVariable]), theme).toBeGreaterThanOrEqual(7)
    }
  })

  it("measures a real failure too: the share panel's red and a theme-following ink both miss 7:1", () => {
    // Guard the guard. The accent red clears AA on white and not 7:1; the primary ink
    // flips with the theme and is near-white in dark. If either passed, the measurement
    // above would be broken, not the tokens.
    const { light, dark } = qrPalettes()
    expect(contrastRatio(light['--admin-accent-blue-fill'], light['--admin-font-on-accent'])).toBeLessThan(7)
    expect(contrastRatio(dark['--admin-font-primary'], dark['--admin-font-on-accent'])).toBeLessThan(7)
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

  it.each([
    ['draft', /^The link is shared once the session opens, on /],
    ['closed', /^The session has closed; the link no longer takes responses\.$/],
  ] as const)('offers neither link nor QR for a %s session, anonymous or not: it takes no answers', async (status, hint) => {
    routeFetch(detail({ status, anonymousResponses: true }), results())
    renderPage()

    expect(await screen.findByText(hint)).toBeTruthy()
    expect(document.querySelector('[data-slot="respond-link"]')).toBeNull()
    expect(screen.queryByRole('img', { name: 'QR code of the respond link' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull()
    // Anonymous all the same — the facts say so — so the withheld link is the status's doing.
    expect(screen.getByText('Anonymous · disclosure floor 5')).toBeTruthy()
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

describe('the glyphs', () => {
  it('draws the artboard’s own glyphs, outlined: the page, the sheet, the clock and the padlock', async () => {
    routeFetch(detail(), results({ responseCount: 3 }))
    renderPage()
    await waitFor(() => expect(figure()).toBe('3'))

    // The canvas's own paths in its 16-unit box, stroked 2 and never filled: the render
    // measures as an outline (MicroclimateLive.png, the page glyph's rows 121-127).
    const resultsLink = screen.getByRole('link', { name: 'Results' })
    const page = resultsLink.querySelector('path[d="M4 2h5l3 3v9H4z"]')
    expect(page).toBeTruthy()
    expect(page?.getAttribute('fill')).toBeNull()
    expect(resultsLink.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 16 16')
    expect(resultsLink.querySelector('svg')?.getAttribute('stroke-width')).toBe('2')
    const copy = screen.getByRole('button', { name: 'Copy' })
    const sheet = copy.querySelector('rect[x="5"][y="5"]')
    expect(sheet).toBeTruthy()
    expect(sheet?.getAttribute('fill')).toBeNull()
    const close = screen.getByRole('button', { name: 'Close the session' })
    expect(close.querySelector('path[d="M8 5v3l2 1.5"]')).toBeTruthy()
    expect(wordsBlock().querySelector('[data-slot="words-hatch"] path[d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"]')).toBeTruthy()
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
