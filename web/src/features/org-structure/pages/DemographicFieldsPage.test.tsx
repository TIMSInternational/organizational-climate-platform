import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import DemographicFieldsPage from './DemographicFieldsPage'
import { TranslationProvider } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import type { DemographicField } from '../api/demographicFields'
import { tokenFor } from '../../../test/jwtFixture'

const COMPANY = 'company-1'

function field(overrides: Partial<DemographicField> = {}): DemographicField {
  return {
    id: 'f1',
    companyId: COMPANY,
    field: 'location',
    label: 'Location',
    type: 'select',
    options: [
      { order: 0, value: 'north', label: 'North' },
      { order: 1, value: 'south', label: 'South' },
    ],
    required: false,
    order: 0,
    isActive: true,
    resolvedLocale: 'en',
    fallbackFields: [],
    ...overrides,
  }
}

/** N options, so a test can say how finely a field cuts without listing values. */
function options(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    order: index,
    value: `v${index}`,
    label: `V${index}`,
  }))
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={[`/admin/companies/${COMPANY}/demographic-fields`]}>
        <Routes>
          <Route
            path="/admin/companies/:companyId/demographic-fields"
            element={<DemographicFieldsPage />}
          />
        </Routes>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

/**
 * Serves the field list, and optionally the headcount behind the readings.
 *
 * `people` omitted means `GET /dashboard/company-admin` 404s, which is the
 * page's optional half failing — the case that must cost the measured columns and
 * nothing else.
 */
function serve(fields: () => DemographicField[], people?: number) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    if (/\/admin\/demographic-fields/.test(url)) {
      return Promise.resolve(new Response(JSON.stringify({ fields: fields() }), { status: 200 }))
    }
    if (people !== undefined && /\/dashboard\/company-admin/.test(url)) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ companyId: COMPANY, activeUserCount: people, userCount: people + 99, departments: [] }),
          { status: 200 },
        ),
      )
    }
    return Promise.resolve(new Response(null, { status: 404 }))
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  setToken(tokenFor({ role: 'super_admin', companyId: '' }))
})

afterEach(() => {
  cleanup()
  clearToken()
  vi.unstubAllGlobals()
})

describe('DemographicFieldsPage states', () => {
  it('separates a 200-with-no-rows from a failed request', async () => {
    serve(() => [], 100)
    renderPage()

    expect(await screen.findByText('No demographic fields defined yet.')).toBeTruthy()
    expect(screen.queryByText('Failed to load demographic fields. Please try again.')).toBeNull()
  })

  it('does not claim the company has no fields while the request is still in flight', async () => {
    // The list never settles, so the page stays in its loading state. The designed
    // empty panel must not be what a reader sees in the meantime.
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}))

    renderPage()

    expect(await screen.findByText('Loading demographic fields...')).toBeTruthy()
    expect(screen.queryByText('No demographic fields defined yet.')).toBeNull()
  })

  it('shows an error with a retry, not an empty state, when the list fails', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403 }),
    )

    renderPage()

    expect(await screen.findByText('Failed to load demographic fields. Please try again.')).toBeTruthy()
    expect(screen.queryByText('No demographic fields defined yet.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})

describe('DemographicFieldsPage as an instrument', () => {
  it('sets the value count in the mono, tabular face', async () => {
    serve(() => [field({ label: 'Location', options: options(6) })], 120)

    renderPage()

    const row = (await screen.findByText('Location')).closest('tr')!
    const values = within(row).getByText('6')
    expect(values.className).toContain('font-mono')
    expect(values.className).toContain('tabular-nums')
  })

  it('reports the mean group size a cut leaves, and calls it usable', async () => {
    // 120 active people across 6 values averages 20 each, well clear of 5.
    serve(() => [field({ label: 'Location', options: options(6) })], 120)

    renderPage()

    const row = (await screen.findByText('Location')).closest('tr')!
    expect(within(row).getByText('20')).toBeTruthy()
    expect(within(row).getByText('Yes')).toBeTruthy()
    expect(within(row).queryByRole('img')).toBeNull()
  })

  it('calls a cut that is too narrow too narrow, and does not pretend to hide the arithmetic', async () => {
    // 31 people across 14 values averages 2 -- so at least one value holds fewer
    // than five people, provably. The verdict carries the padlock; the mean does
    // not, because a padlock over it would be theatre: 31 is on the "Active
    // people" tile and 14 is in this row's own Values cell, so the reader can do
    // the division in their head from one frame. See DemographicFieldList.tsx.
    serve(() => [field({ label: 'Team', field: 'team', options: options(14) })], 31)

    renderPage()

    const row = (await screen.findByText('Team')).closest('tr')!
    expect(within(row).getByText('Too narrow')).toBeTruthy()
    // No claimed guarantee anywhere in the row.
    expect(within(row).queryByRole('img')).toBeNull()
    expect(row.textContent).not.toContain('protected')
    // The mean is stated, in the instrument face, like every other reading.
    const mean = within(row).getByText('2')
    expect(mean.className).toContain('font-mono')
    expect(mean.className).toContain('tabular-nums')
  })

  it('says a deactivated field is not offered as a cut, and leaves it out of the usable count', async () => {
    // Deactivation is what decides the column here: the arithmetic clears the
    // floor easily, so a row that read "Yes" would contradict the tile beside it.
    serve(
      () => [field({ label: 'Shift', field: 'shift', options: options(2), isActive: false })],
      100,
    )

    renderPage()

    const row = (await screen.findByText('Shift')).closest('tr')!
    expect(within(row).getByText('Not offered')).toBeTruthy()
    expect(within(row).queryByText('Yes')).toBeNull()
    const tile = screen.getByText('Usable cuts').parentElement!
    expect(within(tile).getByText('0')).toBeTruthy()
  })

  it('says a field with no fixed value list cannot be checked, rather than failing it', async () => {
    serve(() => [field({ label: 'Start date', field: 'start_date', type: 'date', options: null })], 120)

    renderPage()

    const row = (await screen.findByText('Start date')).closest('tr')!
    expect(within(row).getByText('Unbounded')).toBeTruthy()
    expect(within(row).getByText('Not checkable')).toBeTruthy()
    expect(within(row).queryByText('Too narrow')).toBeNull()
  })

  it('drops both measured columns when the headcount could not be loaded', async () => {
    serve(() => [field({ label: 'Location', options: options(6) })])

    renderPage()
    await screen.findByText('Location')

    expect(screen.queryByText('People per value')).toBeNull()
    expect(screen.queryByText('Usable as a cut')).toBeNull()
    // The definition columns are unaffected: the optional half failing is not a
    // page error.
    expect(screen.getByText('Values')).toBeTruthy()
    expect(screen.queryByText('Failed to load demographic fields. Please try again.')).toBeNull()
  })

  it('counts only the cuts that can clear the floor', async () => {
    serve(
      () => [
        field({ id: 'a', field: 'location', label: 'Location', options: options(6) }),
        field({ id: 'b', field: 'team', label: 'Team', options: options(14) }),
        field({ id: 'c', field: 'notes', label: 'Notes', type: 'text', options: null }),
      ],
      31,
    )

    renderPage()
    await screen.findByText('Location')

    // 31/6 = 5 clears the floor; 31/14 = 2 does not; a text field is not countable.
    const tile = screen.getByText('Usable cuts').parentElement!
    expect(within(tile).getByText('1')).toBeTruthy()
  })

  it('translates the server type enum instead of printing it raw', async () => {
    serve(() => [field({ label: 'Location', type: 'select', options: options(6) })], 120)

    renderPage()

    const row = (await screen.findByText('Location')).closest('tr')!
    expect(within(row).getByText('List')).toBeTruthy()
    expect(within(row).queryByText('select')).toBeNull()
  })
})

describe('the curated page eyebrow', () => {
  /**
   * The approved design gives this screen the eyebrow "Company Administration". Left to itself
   * `PageTopBar` derives the NAV SECTION instead, which can only ever be one of three
   * words ("Administration", "Workspace", "Communication") — so the design's curated
   * label is a prop the page has to pass, and deleting that prop is completely silent:
   * every other test in this file still passed with it removed. Hence this one.
   */
  it('names the design’s section, not the nav section', () => {
    renderPage()
    const eyebrow = document.querySelector('[data-slot="page-eyebrow"]')
    expect(eyebrow?.textContent).toBe('Company Administration')
  })
})
