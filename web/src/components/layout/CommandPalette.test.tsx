import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { CommandPalette, OPEN_COMMAND_PALETTE_EVENT } from './CommandPalette'
import { buildNavSections } from '../../navigation/navSections'
import { TranslationProvider, LanguageSwitcher, LOCALE_STORAGE_KEY } from '../../i18n'
import { setToken, clearToken } from '../../auth/token'
import type { SearchResultItem } from '../../features/search/api/search'
import { tokenFor } from '../../test/jwtFixture'

const COMPANY = '22222222-2222-2222-2222-222222222222'

function hit(overrides: Partial<SearchResultItem> = {}): SearchResultItem {
  return {
    type: 'survey',
    id: '33333333-3333-3333-3333-333333333333',
    title: 'Q3 2026 Climate Survey',
    subtitle: 'Closed · 24 responses',
    companyId: COMPANY,
    parentId: null,
    ...overrides,
  }
}

/** Serves `GET /search` with one group holding `items`, and records every URL asked for. */
function serve(items: SearchResultItem[], seen: string[] = []) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
    seen.push(String(input))
    return Promise.resolve(
      new Response(JSON.stringify({ query: 'x', groups: [{ type: 'survey', items }], totalCount: items.length }), {
        status: 200,
      }),
    )
  })
  return seen
}

/**
 * `switcher` mounts the real language control beside the palette, in the same provider.
 * `role` is the caller's claim, handed to the palette the way `AdminLayout` hands it.
 */
function renderPalette({ switcher = false, role = 'super_admin' } = {}) {
  return render(
    <TranslationProvider>
      {switcher && <LanguageSwitcher compact />}
      <MemoryRouter initialEntries={['/dashboard']}>
        <CommandPalette sections={buildNavSections(role, COMPANY)} role={role} trackingEnabled={false} />
      </MemoryRouter>
    </TranslationProvider>,
  )
}

async function openPalette() {
  await act(async () => {
    window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT))
  })
}

describe('CommandPalette search (#135)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    setToken(tokenFor({ role: 'super_admin', companyId: COMPANY }))
  })

  afterEach(() => {
    cleanup()
    clearToken()
    localStorage.removeItem(LOCALE_STORAGE_KEY)
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('offers data alongside destinations, not only nav entries', async () => {
    serve([hit()])
    renderPalette()
    await openPalette()

    await userEvent.type(screen.getByRole('combobox'), 'climate')

    expect(await screen.findByText('Q3 2026 Climate Survey')).toBeTruthy()
    // The subtitle becomes the row's second line, the same slot a nav description uses.
    expect(screen.getByText('Closed · 24 responses')).toBeTruthy()
  })

  /**
   * A one-character query is too broad to be worth a round-trip per keystroke, and the
   * server clamps nothing about how often it is asked.
   */
  it('does not call the API for a query below the minimum length', async () => {
    const seen = serve([hit()])
    renderPalette()
    await openPalette()

    await userEvent.type(screen.getByRole('combobox'), 'c')
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(seen.filter((url) => url.includes('/search'))).toHaveLength(0)
  })

  /**
   * The row is dropped, not rendered dead. A user hit with no `companyId` cannot be routed
   * (`/admin/companies/:companyId/users`), and a palette entry that navigates nowhere is
   * worse than one that omits the hit.
   */
  it('drops a hit it cannot route rather than rendering a dead row', async () => {
    serve([hit({ type: 'user', title: 'Ada Lovelace', companyId: null, subtitle: 'ada@example.com' })])
    renderPalette()
    await openPalette()

    await userEvent.type(screen.getByRole('combobox'), 'ada')
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(screen.queryByText('Ada Lovelace')).toBeNull()
  })

  /**
   * `GET /search` answers a leader, a supervisor and an employee with the surveys they are
   * asked to answer (`SearchEndpoints.AssignedSurveysAccess`), and a survey hit routes to
   * `/surveys/{id}` -- the administrator's Detalle, whose `GET /surveys/{id}` is
   * `CanAdminister`. Since 2026-11-12 the supervisor's strip carries the palette chip, so the
   * shell itself was inviting them to a page that answers 403. A hit is offered only where
   * `roleCapabilities.ts` says the role can load it.
   */
  it.each(['supervisor', 'leader', 'employee'])(
    'does not offer a %s a hit on a page their role cannot load',
    async (role) => {
      setToken(tokenFor({ role, companyId: COMPANY }))
      const seen = serve([hit()])
      renderPalette({ role })
      await openPalette()

      await userEvent.type(screen.getByRole('combobox'), 'climate')
      await waitFor(() => expect(seen.some((url) => url.includes('/search'))).toBe(true))
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(screen.queryByText('Q3 2026 Climate Survey')).toBeNull()
    },
  )

  /**
   * The other side, so "drop every hit" cannot pass: each kind `hrefForResult` routes is a
   * page both administrator roles hold in `roleCapabilities.ts`. `action_plan` is absent
   * because it routes only where the tracking service is not configured, which the
   * `offered.test.ts` pair covers; a hit of every other kind must still arrive.
   */
  it.each(['super_admin', 'company_admin'])('still offers %s a hit of every routed kind', async (role) => {
    setToken(tokenFor({ role, companyId: COMPANY }))
    serve([
      hit(),
      hit({ type: 'question', id: 'q1', title: 'A question hit', parentId: '44444444-4444-4444-4444-444444444444' }),
      hit({ type: 'department', id: 'd1', title: 'A department hit' }),
      hit({ type: 'user', id: 'u1', title: 'A user hit' }),
      hit({ type: 'report', id: 'r1', title: 'A report hit' }),
    ])
    renderPalette({ role })
    await openPalette()

    await userEvent.type(screen.getByRole('combobox'), 'hit')

    for (const title of ['Q3 2026 Climate Survey', 'A question hit', 'A department hit', 'A user hit', 'A report hit']) {
      expect(await screen.findByText(title)).toBeTruthy()
    }
  })

  /** The nav half must keep working when the API is unreachable. */
  it('still offers destinations when the search request fails', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('offline'))
    renderPalette()
    await openPalette()

    await userEvent.type(screen.getByRole('combobox'), 'benchmarks')

    await waitFor(() => expect(screen.getByText('Benchmarks')).toBeTruthy())
  })

  /**
   * `SearchEndpoints.ToItem` resolves each hit's title and subtitle for `lang`. The palette
   * never sent it, so a Spanish reader searching a Spanish product was offered the English
   * half of every bilingual survey, plan and report. A *stored* choice, not the provider's
   * default: a hardcoded 'en' would pass a test rendered in English.
   */
  it('asks for the hits in the reader\'s language', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    const seen = serve([hit()])
    renderPalette()
    await openPalette()

    await userEvent.type(screen.getByRole('combobox'), 'climate')

    await waitFor(() => expect(seen.some((url) => url.includes('/search'))).toBe(true))
    const url = new URL(seen.find((entry) => entry.includes('/search'))!, 'http://test.local')
    expect(url.searchParams.get('q')).toBe('climate')
    expect(url.searchParams.get('lang')).toBe('es')
  })

  /**
   * The debounced effect keys on `locale`: the hits on screen are titled for the language
   * they were asked in, so a switch mid-search has to ask again with the same query.
   */
  it('asks again in the new language when the reader switches locale mid-search', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    const seen = serve([hit()])
    const searches = () => seen.filter((url) => url.includes('/search'))
    const langOf = (url: string) => new URL(url, 'http://test.local').searchParams.get('lang')
    renderPalette({ switcher: true })
    await openPalette()

    // Two comboboxes are mounted now -- the palette's input and the language <select> --
    // so each is addressed by its accessible name.
    await userEvent.type(screen.getByRole('combobox', { name: 'Command palette' }), 'climate')

    await waitFor(() => expect(searches()).toHaveLength(1))
    expect(langOf(searches()[0])).toBe('en')

    // The palette is a Radix `Dialog` (modal): while it is open the rest of the document is
    // `aria-hidden`, and role queries skip hidden elements unless told not to. The control
    // still works; it is only the accessibility tree that has set it aside.
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Switch Language', hidden: true }), 'es')

    await waitFor(() => expect(searches()).toHaveLength(2))
    const second = new URL(searches()[1], 'http://test.local')
    expect(second.searchParams.get('q')).toBe('climate')
    expect(second.searchParams.get('lang')).toBe('es')
  })
})
