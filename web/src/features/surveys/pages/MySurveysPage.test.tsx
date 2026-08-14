import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { TranslationProvider } from '../../../i18n'
import { LOCALE_STORAGE_KEY } from '../../../i18n/locale'
import { setToken, clearToken } from '../../../auth/token'
import MySurveysPage from './MySurveysPage'
import type { MySurveyListItem } from '../api/surveys'

/**
 * The respondent surface. Its acceptance criterion is that it works for a *plain
 * employee*, which is why none of these tests establish a role: the page reads no
 * role claim, and `GET /surveys/my` resolves the caller's own user row instead.
 *
 * ## Why the fixtures are relative to `Date.now()` and the clock is never pinned
 *
 * The page counts whole UTC calendar days, so an offset of an exact multiple of a
 * day is exact whatever the hour the suite runs at: `Date.now() + 6 * DAY` is six
 * days later at 00:00 and at 23:59 alike. Fake timers would buy nothing and would
 * have to be unwound around React's async render.
 */

const DAY = 86_400_000

/** An ISO instant exactly `days` whole days from now — negative for the past. */
function inDays(days: number): string {
  return new Date(Date.now() + days * DAY).toISOString()
}

function row(overrides: Partial<MySurveyListItem> = {}): MySurveyListItem {
  return {
    id: 's1',
    title: 'Q4 Climate Survey',
    description: 'How the last quarter felt',
    type: 'periodic',
    startDate: inDays(-20),
    endDate: inDays(6),
    questionCount: 12,
    anonymous: true,
    timeLimitMinutes: null,
    ...overrides,
  }
}

function ok(...rows: MySurveyListItem[]) {
  return new Response(JSON.stringify({ surveys: rows }), { status: 200 })
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter>
        <MySurveysPage />
      </MemoryRouter>
    </TranslationProvider>,
  )
}

/** The row element around a survey's title. */
function rowAround(title: string): HTMLElement {
  const found = screen.getByText(title).closest('[data-slot="my-survey-row"]')
  if (!found) throw new Error(`no survey row around "${title}"`)
  return found as HTMLElement
}

function chipIn(element: HTMLElement): HTMLElement {
  const chip = element.querySelector('[data-slot="chip"]')
  if (!chip) throw new Error('no chip in row')
  return chip as HTMLElement
}

beforeEach(() => {
  localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
  setToken('test-token')
})

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('MySurveysPage', () => {
  it('loads for a plain employee, hitting the per-user endpoint and no admin one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(row()))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    expect(await screen.findByText('Q4 Climate Survey')).toBeTruthy()
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/surveys/my')
    // No company or status scoping is sent: the server derives both from the
    // caller's own user row, which is what makes this loadable without an admin role.
    expect(url).not.toContain('companyId')
  })

  it('reads a row out as questions, an estimated duration and a closing day', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(row({ questionCount: 12 }))))
    renderPage()

    // The design's own figure: twelve questions is "about 8 minutes", i.e. forty
    // seconds each. The date is the closing day, not an instant.
    expect(
      await screen.findByText(/^12 questions · about 8 minutes · closes .+$/),
    ).toBeTruthy()
  })

  it('says “under a minute” for a one-question pulse rather than “about 2 minutes”', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(row({ questionCount: 1 }))))
    renderPage()

    expect(await screen.findByText(/^1 question · under a minute · closes .+$/)).toBeTruthy()
  })

  it('chips the days left, in whole calendar days, with singular and today spelled out', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          ok(
            row({ id: 'a', title: 'Six days', endDate: inDays(6) }),
            row({ id: 'b', title: 'One day', endDate: inDays(1) }),
            row({ id: 'c', title: 'Last day', endDate: inDays(0) }),
          ),
        ),
    )
    renderPage()

    expect(await screen.findByText('6 days left')).toBeTruthy()
    expect(screen.getByText('1 day left')).toBeTruthy()
    // Still open on its closing day — it has not closed until the day is past.
    expect(screen.getByText('Closes today')).toBeTruthy()
    expect(screen.queryByText('0 days left')).toBeNull()
  })

  it('lights up only the rows closing soon, and tones their chip to match', async () => {
    // The design accents one of its two open rows and leaves the other plain. The
    // only fact that separates them in this payload is how soon they close, so that
    // is the rule — and the frame and the chip are the same decision, not two.
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          ok(
            row({ id: 'a', title: 'Closing soon', endDate: inDays(6) }),
            row({ id: 'b', title: 'Plenty of time', endDate: inDays(40) }),
          ),
        ),
    )
    renderPage()

    await screen.findByText('Closing soon')
    const urgent = rowAround('Closing soon')
    const relaxed = rowAround('Plenty of time')

    expect(urgent.className).toContain('bg-accent-blue-soft')
    expect(chipIn(urgent).className).toContain('chip-warning')

    expect(relaxed.className).not.toContain('bg-accent-blue-soft')
    expect(chipIn(relaxed).className).toContain('chip-neutral')
  })

  it('offers one action per open row, pointed at the respond route for that survey', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(row({ id: 'abc-123' }))))
    renderPage()

    const answer = await screen.findByRole('link', { name: 'Answer' })
    expect(answer.getAttribute('href')).toBe('/surveys/abc-123/respond')
  })

  it('renders no Closed group for the only payload the API can currently serve', async () => {
    // `SurveyQueries.AssignedTo` hard-filters `Status == Active`, so every row that
    // arrives here is open. The design draws a Closed group the endpoint cannot
    // fill, and an empty heading would assert something untrue about the reader.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(row())))
    renderPage()

    await screen.findByText('Q4 Climate Survey')
    expect(screen.queryByRole('heading', { name: 'Closed' })).toBeNull()
    expect(screen.queryByText('Not recorded as yours')).toBeNull()
    // The footnote is not part of the group: it explains the absence of a tick
    // whether or not a closed row is on screen.
    expect(screen.getByText(/We do not show a tick against a closed anonymous survey/)).toBeTruthy()
  })

  it('groups a row whose window has ended under Closed, and never claims the reader answered it', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          ok(
            row({ id: 'open', title: 'Q4 Climate Survey', endDate: inDays(6) }),
            row({ id: 'past', title: 'Q3 Climate Survey', endDate: inDays(-8) }),
          ),
        ),
    )
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Closed' })).toBeTruthy()

    const past = rowAround('Q3 Climate Survey')
    expect(past.getAttribute('data-open')).toBe('false')
    // Never a tick: `SurveyResponse.UserId` is NULL on an anonymous response, so the
    // product genuinely does not know whether this reader answered.
    expect(chipIn(past).textContent).toBe('Not recorded as yours')
    expect(past.querySelector('a')?.getAttribute('href')).toBe('/dashboard')
    expect(past.textContent).toContain('results published to your department')
    // The open row is still above, in its own group, and still answerable.
    expect(rowAround('Q4 Climate Survey').getAttribute('data-open')).toBe('true')
  })

  it('renders the centred employee empty state rather than an admin “adjust your filters”', async () => {
    // This page has no filters, so the admin listing's empty copy would be nonsense
    // here — and a global super_admin correctly lands on this exact state.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok()))
    renderPage()

    const title = await screen.findByText('Nothing has been sent to you yet')
    expect(screen.getByText('Surveys you are asked to answer appear here, the open ones first.')).toBeTruthy()
    expect(screen.queryByText(/adjusting your filters/)).toBeNull()
    // `fill` — the centred block, not a stub stranded at the top of the card.
    const block = title.closest('[data-slot="error-state"]')
    expect(block?.getAttribute('data-fill')).toBe('true')
  })
})
