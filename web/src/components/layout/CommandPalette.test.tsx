import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { CommandPalette, OPEN_COMMAND_PALETTE_EVENT } from './CommandPalette'
import { buildNavSections } from '../../navigation/navSections'
import { TranslationProvider } from '../../i18n'
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

function renderPalette() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/dashboard']}>
        <CommandPalette sections={buildNavSections('super_admin', COMPANY)} />
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

  /** The nav half must keep working when the API is unreachable. */
  it('still offers destinations when the search request fails', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('offline'))
    renderPalette()
    await openPalette()

    await userEvent.type(screen.getByRole('combobox'), 'benchmarks')

    await waitFor(() => expect(screen.getByText('Benchmarks')).toBeTruthy())
  })
})
