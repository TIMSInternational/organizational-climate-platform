import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { TranslationProvider } from '../../../i18n'
import { LOCALE_STORAGE_KEY } from '../../../i18n/locale'
import { setToken, clearToken } from '../../../auth/token'
import SurveysListPage from './SurveysListPage'
import type { SurveyListItem } from '../api/surveys'

function row(overrides: Partial<SurveyListItem> = {}): SurveyListItem {
  return {
    id: 's1',
    title: 'Q3 climate survey',
    companyId: 'c1',
    type: 'periodic',
    status: 'draft',
    language: 'en',
    startDate: '2026-09-01T00:00:00Z',
    endDate: '2026-09-30T00:00:00Z',
    responseCount: 4,
    targetAudienceCount: 40,
    questionCount: 8,
    createdAt: '2026-08-01T00:00:00Z',
    ...overrides,
  }
}

/**
 * The company-name eyebrow reads the caller's own `/profile`. It is answered separately
 * from the survey list because a single `Response` cannot serve both — see the note on the
 * mock conversion below.
 */
function profileResponse() {
  return new Response(JSON.stringify({ companyName: 'Acme Corporation' }), { status: 200 })
}

function ok(...rows: SurveyListItem[]) {
  return new Response(JSON.stringify({ surveys: rows }), { status: 200 })
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter>
        <SurveysListPage />
      </MemoryRouter>
    </TranslationProvider>,
  )
}

function lastUrl(fetchMock: ReturnType<typeof vi.fn>): string {
  // The SURVEY request, not merely the most recent one: the company-name eyebrow's
  // /profile lookup can land last, and an assertion about survey scoping that read it
  // would pass no matter what this page sent.
  const urls = fetchMock.mock.calls.map((call) => String(call[0])).filter((url) => !url.includes('/profile'))
  return urls[urls.length - 1]
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

describe('SurveysListPage', () => {
  it('sends no companyId, so a super admin gets a real cross-company view', async () => {
    // `ListAsync` applies NO company predicate for a super_admin who sends no
    // companyId, and overwrites the scope with their own company for anyone else. So
    // omitting it is correct for both roles — and it is why this page needs neither a
    // role gate nor a claim read, unlike /action-plans.
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) =>
      Promise.resolve(String(input).includes('/profile') ? profileResponse() : ok(row())),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await screen.findByText('Q3 climate survey')
    expect(lastUrl(fetchMock)).not.toContain('companyId')
  })

  it('keeps status off the wire, because the chips count statuses the response would not contain', async () => {
    // The chip row states a count per status. A response to `?status=active` holds no
    // scheduled surveys, so those counts cannot be derived from it — which is why this
    // one filter is applied over the full result set instead. Type and search stay the
    // server's.
    const fetchMock = vi
      .fn()
      .mockImplementation((input: RequestInfo | URL) =>
      Promise.resolve(String(input).includes('/profile') ? profileResponse() : ok(row({ status: 'active' }), row({ id: 's2', title: 'Next quarter', status: 'scheduled' }))),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await screen.findByText('Q3 climate survey')

    await userEvent.click(screen.getByRole('button', { name: /^Scheduled/ }))

    expect(lastUrl(fetchMock)).not.toContain('status=')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('narrows the rows on screen to the chosen status', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation((input: RequestInfo | URL) =>
      Promise.resolve(String(input).includes('/profile') ? profileResponse() : 
          ok(row({ status: 'active' }), row({ id: 's2', title: 'Next quarter', status: 'scheduled' })),
        ),
    ),
    )
    renderPage()
    await screen.findByText('Q3 climate survey')

    await userEvent.click(screen.getByRole('button', { name: /^Scheduled/ }))

    expect(screen.getByText('Next quarter')).toBeTruthy()
    expect(screen.queryByText('Q3 climate survey')).toBeNull()
  })

  it('gives every status a chip carrying its count, including the statuses with no rows', async () => {
    // An absent chip is indistinguishable from a filter that does not exist; a chip
    // reading 0 says what it means. The counts come from the whole result set, not
    // from the visible rows.
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation((input: RequestInfo | URL) =>
      Promise.resolve(String(input).includes('/profile') ? profileResponse() : 
          ok(row({ status: 'active' }), row({ id: 's2', title: 'Next quarter', status: 'scheduled' })),
        ),
    ),
    )
    renderPage()
    await screen.findByText('Q3 climate survey')

    const chips = screen
      .getByRole('group', { name: 'Filter by status' })
      .querySelectorAll('button')
    expect(Array.from(chips).map((chip) => chip.textContent)).toEqual([
      'All2',
      'Draft0',
      'Scheduled1',
      'Active1',
      'Closed0',
      'Archived0',
    ])
  })

  it('marks the selected chip with aria-pressed, so the state is not carried by colour alone', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL) =>
      Promise.resolve(String(input).includes('/profile') ? profileResponse() : ok(row({ status: 'active' }))),
    ))
    renderPage()
    await screen.findByText('Q3 climate survey')

    expect(screen.getByRole('button', { name: /^All/ }).getAttribute('aria-pressed')).toBe('true')
    await userEvent.click(screen.getByRole('button', { name: /^Active/ }))
    expect(screen.getByRole('button', { name: /^Active/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /^All/ }).getAttribute('aria-pressed')).toBe('false')
  })

  it('does not refetch on every keystroke in the search box', async () => {
    // Draft-vs-applied filter state. Typing eight characters must not issue eight
    // requests.
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) =>
      Promise.resolve(String(input).includes('/profile') ? profileResponse() : ok(row())),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await screen.findByText('Q3 climate survey')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await userEvent.type(screen.getByLabelText('Search'), 'climate')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('button', { name: 'Filter' }))
    await waitFor(() => expect(lastUrl(fetchMock)).toContain('q=climate'))
  })

  it('offers only the types actually present, because Survey.Type has no closed vocabulary', async () => {
    // The server validates `type` as non-empty and nothing more, so an enumerated
    // list would promise filters that match nothing.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) =>
      Promise.resolve(String(input).includes('/profile') ? profileResponse() : ok(row(), row({ id: 's2', title: 'Weekly pulse', type: 'pulse' }))),
    ),
    )
    renderPage()
    await screen.findByText('Weekly pulse')

    const options = Array.from(
      screen.getByLabelText('Survey Type').querySelectorAll('option'),
    ).map((option) => option.getAttribute('value'))
    expect(options).toEqual(['', 'periodic', 'pulse'])
  })

  it('degrades a null targetAudienceCount to the bare count, never a fabricated denominator', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL) =>
      Promise.resolve(String(input).includes('/profile') ? profileResponse() : ok(row({ targetAudienceCount: null }))),
    ))
    renderPage()

    await screen.findByText('Q3 climate survey')
    expect(screen.getByText('4')).toBeTruthy()
    expect(screen.queryByText(/4 of/)).toBeNull()
  })

  it('prints no denominator when the expected audience is zero, matching the dash beside it', async () => {
    // The two cells used to disagree: Participation routed a non-positive
    // denominator to an em dash meaning "there is nothing to measure against",
    // while Responses tested only for null and printed "5 of 0" in the same row.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) =>
      Promise.resolve(String(input).includes('/profile') ? profileResponse() : ok(row({ responseCount: 5, targetAudienceCount: 0 }))),
    ),
    )
    renderPage()
    await screen.findByText('Q3 climate survey')

    expect(screen.queryByText('5 of 0')).toBeNull()
    expect(screen.getByText('5')).toBeTruthy()
    expect(
      screen.getByTitle(
        'No expected number of respondents was set for this survey, so it has no participation rate.',
      ),
    ).toBeTruthy()
  })

  it('keeps a reading on one line, so it cannot break mid-value', async () => {
    // happy-dom does no layout, so this asserts the rule rather than the pixels:
    // at 1024px in Spanish the Responses cell wrapped "175 de 208" onto two lines,
    // which is what the tabular-figures rule exists to prevent. The screenshot is
    // the evidence that it stopped; this is the evidence it stays stopped.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) =>
      Promise.resolve(String(input).includes('/profile') ? profileResponse() : ok(row({ responseCount: 175, targetAudienceCount: 208 }))),
    ),
    )
    renderPage()

    const cell = (await screen.findByText('175 of 208')).closest('td')
    expect(cell?.className).toContain('whitespace-nowrap')
    expect(cell?.className).toContain('tabular-nums')
  })

  it('breaks a long title rather than widening the table past the panel', async () => {
    // A title is free text with no length limit. One long unbroken word sets the
    // column's minimum width, which pushed the trailing Open action into
    // horizontal scroll and clipped it at the panel edge.
    //
    // `wrap-anywhere`, not `break-words`: only `overflow-wrap: anywhere` lowers the
    // min-content width an auto-layout table column is sized from. Rendering it at
    // 1024px is what established that; happy-dom cannot tell the two apart.
    const long = 'Leadership360DegreeFeedbackAndCalibrationCycleForAllPeopleManagers'
    vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL) =>
      Promise.resolve(String(input).includes('/profile') ? profileResponse() : ok(row({ title: long }))),
    ))
    renderPage()

    expect((await screen.findByText(long)).className).toContain('wrap-anywhere')
  })

  it('renders participation as a bar plus a mono figure, with the bar hidden from the reading', async () => {
    // The bar duplicates the figure beside it, so announcing both would read the same
    // quantity twice. The figure is the reading, and it is set in the mono face.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) =>
      Promise.resolve(String(input).includes('/profile') ? profileResponse() : ok(row({ responseCount: 175, targetAudienceCount: 208 }))),
    ),
    )
    const { container } = renderPage()
    await screen.findByText('Q3 climate survey')

    const figure = screen.getByText('84%')
    expect(figure.className).toContain('font-mono')
    expect(figure.className).toContain('tabular-nums')

    const bar = container.querySelector('td [aria-hidden="true"] > span[style]')
    expect(bar?.getAttribute('style')).toContain('width: 84%')
  })

  it('clamps the bar at full while still printing a participation above 100', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) =>
      Promise.resolve(String(input).includes('/profile') ? profileResponse() : ok(row({ responseCount: 56, targetAudienceCount: 50 }))),
    ),
    )
    const { container } = renderPage()
    await screen.findByText('Q3 climate survey')

    expect(screen.getByText('112%')).toBeTruthy()
    const bar = container.querySelector('td [aria-hidden="true"] > span[style]')
    expect(bar?.getAttribute('style')).toContain('width: 100%')
  })

  it('draws no bar at all when the survey declares no expected audience', async () => {
    // A bar at zero would say "nobody responded", which is a different statement from
    // "there is nothing to measure against".
    vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL) =>
      Promise.resolve(String(input).includes('/profile') ? profileResponse() : ok(row({ targetAudienceCount: null }))),
    ))
    const { container } = renderPage()
    await screen.findByText('Q3 climate survey')

    expect(container.querySelector('td [aria-hidden="true"] > span[style]')).toBeNull()
    expect(screen.getByTitle('No expected number of respondents was set for this survey, so it has no participation rate.')).toBeTruthy()
  })

  it('names each row action for the survey it opens', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL) =>
      Promise.resolve(String(input).includes('/profile') ? profileResponse() : ok(row())),
    ))
    renderPage()

    const link = await screen.findByRole('link', { name: 'Open Q3 climate survey' })
    expect(link.getAttribute('href')).toBe('/surveys/s1')
  })

  it('offers a Results link on active and closed rows, and never on a draft', async () => {
    // Decision 07 of the admin round: before this link the best screen in the
    // product was reachable only by typing its URL. A draft has no responses to
    // show, and a link to an empty results page teaches the reader it is noise.
    vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL) =>
      Promise.resolve(
        String(input).includes('/profile')
          ? profileResponse()
          : ok(
              row({ status: 'closed' }),
              row({ id: 's2', title: 'Pulse check', status: 'active' }),
              row({ id: 's3', title: 'Next quarter', status: 'draft' }),
            ),
      ),
    ))
    renderPage()

    const closed = await screen.findByRole('link', { name: 'Results for Q3 climate survey' })
    expect(closed.getAttribute('href')).toBe('/surveys/s1/results')
    expect(
      screen.getByRole('link', { name: 'Results for Pulse check' }).getAttribute('href'),
    ).toBe('/surveys/s2/results')
    expect(screen.queryByRole('link', { name: 'Results for Next quarter' })).toBeNull()
  })

  it('falls back to a label when a survey has no title in any language', async () => {
    // The resolver returns null rather than an empty string or a key path (#195).
    vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL) =>
      Promise.resolve(String(input).includes('/profile') ? profileResponse() : ok(row({ title: null }))),
    ))
    renderPage()

    expect(await screen.findByText('Untitled survey')).toBeTruthy()
  })

  it('shows the server’s message on a failed load, with a retry that refetches', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Boom' }), { status: 500 }))
      .mockResolvedValueOnce(ok(row()))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    expect(await screen.findByText('Boom')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Q3 climate survey')).toBeTruthy()
  })
})

describe('the company-name eyebrow', () => {
  /**
   * The brief puts the COMPANY on this screen's eyebrow, not the nav section. It comes
   * from the caller's own `/profile`, the one source every role that can open this screen
   * is permitted to read -- `/admin/companies/{id}` would 403 for a leader.
   */
  it('names the company, not the nav section', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) =>
        Promise.resolve(String(input).includes('/profile') ? profileResponse() : ok(row())),
      ),
    )

    renderPage()

    await waitFor(() => {
      expect(document.querySelector('[data-slot="page-eyebrow"]')?.textContent).toBe('Acme Corporation')
    })
  })
})
