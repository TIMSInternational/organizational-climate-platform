import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import CompanyDetailPage from './CompanyDetailPage'
import { TranslationProvider, LOCALE_STORAGE_KEY } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import { ANONYMITY_FLOOR, isSuppressed } from '../../../components/charts'
import type { CompanyDetail } from '../api/companies'
import type { Department } from '../api/departments'
import type { CompanySettingsResponse } from '../api/companySettings'
import { tokenFor } from '../../../test/jwtFixture'

const COMPANY = 'company-1'

function companyDetail(overrides: Partial<CompanyDetail> = {}): CompanyDetail {
  return {
    id: COMPANY,
    name: 'Northwind Logistics',
    emailDomain: 'northwind.example',
    industry: 'Transportation',
    size: 'large',
    country: 'Colombia',
    subscriptionTier: 'enterprise',
    createdAt: '2025-03-14T09:12:00Z',
    userCount: 208,
    ...overrides,
  }
}

function settingsResponse(): CompanySettingsResponse {
  return {
    companyId: COMPANY,
    settings: {
      surveyFrequency: 'quarterly',
      microclimateEnabled: true,
      aiInsightsEnabled: true,
      anonymousSurveys: true,
      dataRetentionDays: 730,
      timezone: 'America/Bogota',
      language: 'es',
    },
    branding: {
      logoUrl: null,
      primaryColor: '#0d9488',
      secondaryColor: '#0f766e',
      fontFamily: 'Poppins',
      customCss: null,
    },
  }
}

function department(): Department {
  return {
    id: 'd1',
    companyId: COMPANY,
    name: 'Operations',
    description: null,
    parentDepartmentId: null,
    isActive: true,
    employeeCount: 12,
  }
}

interface ServeOptions {
  /** `unset`: the company exists but has left the optional fields empty. */
  profile?: 'ok' | 'forbidden' | 'unset'
  settings?: 'ok' | 'forbidden'
}

function serve({ profile = 'ok', settings = 'ok' }: ServeOptions = {}) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/settings')) {
      if (settings === 'forbidden') {
        return Promise.resolve(new Response(JSON.stringify({ message: 'nope' }), { status: 403 }))
      }
      return Promise.resolve(new Response(JSON.stringify(settingsResponse()), { status: 200 }))
    }
    if (url.includes('/admin/departments')) {
      return Promise.resolve(new Response(JSON.stringify({ departments: [department()] }), { status: 200 }))
    }
    if (url.includes('/admin/companies/')) {
      if (profile === 'forbidden' && (init?.method ?? 'GET') === 'GET') {
        return Promise.resolve(new Response(JSON.stringify({ message: 'nope' }), { status: 403 }))
      }
      const detail =
        profile === 'unset' ? companyDetail({ emailDomain: null, industry: null }) : companyDetail()
      return Promise.resolve(new Response(JSON.stringify(detail), { status: 200 }))
    }
    return Promise.resolve(new Response(null, { status: 404 }))
  })
}

function renderPage(locale: 'en' | 'es' = 'en') {
  localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={[`/admin/companies/${COMPANY}`]}>
        <Routes>
          <Route path="/admin/companies/:id" element={<CompanyDetailPage />} />
        </Routes>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  setToken(tokenFor({ role: 'super_admin', companyId: COMPANY, isActive: 'true' }))
})

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.removeItem(LOCALE_STORAGE_KEY)
  vi.unstubAllGlobals()
})

describe('CompanyDetailPage readings', () => {
  it('shows identity and reporting without anyone pressing a Load button', async () => {
    // The settings used to sit behind a "Load settings" press. A settings screen
    // that opens with the settings missing is the defect this replaces.
    serve()

    renderPage()

    // Twice on purpose: the badge beside the page title, and the first reading
    // in the Identity tile.
    expect((await screen.findAllByText('Northwind Logistics')).length).toBe(2)
    expect(screen.getByText('northwind.example')).toBeTruthy()
    // `Quarterly`, not the wire token `quarterly`: the cadence goes through
    // `surveyFrequencyLabelKey` so a Spanish administrator stops reading English
    // under *Frecuencia de encuestas*. These assertions previously pinned the raw
    // token, i.e. the defect. A cadence outside the conventional four still renders
    // verbatim — `labels.test.ts` covers that, since the field is free text on the
    // wire and the fallback is the ordinary path rather than a safety net.
    expect(await screen.findByText('Quarterly')).toBeTruthy()
    expect(screen.getByText('730 days')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Load settings' })).toBeNull()
  })

  it('reads the settings with an empty body, which writes nothing', async () => {
    // There is no GET for company settings; PUT with every member absent is the
    // read. If this ever became a PUT with a body, opening the page would edit
    // the company.
    serve()

    renderPage()
    await screen.findByText('Quarterly')

    const settingsCalls = vi
      .mocked(fetch)
      .mock.calls.filter((call) => String(call[0]).includes('/settings'))
    expect(settingsCalls.length).toBe(1)
    expect((settingsCalls[0][1] as RequestInit).method).toBe('PUT')
    expect((settingsCalls[0][1] as RequestInit).body).toBe('{}')
  })

  it('sets the readings in mono and leaves the prose alone', async () => {
    serve()

    renderPage()

    const domain = await screen.findByText('northwind.example')
    expect(domain.className).toContain('font-mono')
    const industry = screen.getByText('Transportation')
    expect(industry.className ?? '').not.toContain('font-mono')
  })

  it('gives every readout a box that grows instead of a fixed control height', async () => {
    // happy-dom does no layout, so nothing here can catch the overflow itself.
    // What it can catch is the cause: a hard `h-control-lg` on a box holding
    // wrapping prose. Rendered in Chromium at 390px, `logistica.northwind-
    // colombia.example` (36 chars, well inside the column's 255) wrapped to two
    // lines, 39px of text in a 32px box, and the border was painted through
    // both. Every readout on the screen is asserted, not just one, because the
    // hazard is the class and the class is shared.
    serve()

    renderPage()
    await screen.findByText('northwind.example')

    const readings = [
      'Northwind Logistics',
      'northwind.example',
      'Transportation',
      '208',
      'Quarterly',
      '730 days',
      'Enabled',
    ]
    for (const reading of readings) {
      // The company name is also the PageTopBar badge; the readout is the one
      // whose parent is the bordered box.
      const box = screen
        .getAllByText(reading)
        .map((node) => node.parentElement!)
        .find((parent) => parent.className.includes('bg-surface-input'))!
      const classes = box.className.split(/\s+/)
      expect(classes).toContain('min-h-control-lg')
      // Substring matching would pass on `min-h-control-lg` itself.
      expect(classes).not.toContain('h-control-lg')
      expect(classes).toContain('py-1')
    }
  })

  it('reports an unset value in a tone that meets AA against the inset', async () => {
    // `Not set` is the answer the page gives, not an input placeholder and not a
    // disabled control, so none of 1.4.3's exceptions cover it. `text-fg-light`
    // is `--admin-font-light`: #999999 on #ffffff is 2.85:1 and #555555 on
    // #1e1e1e is 2.24:1, both under 4.5:1. `text-fg-secondary` is 9.29:1 /
    // 7.95:1 and keeps the de-emphasis by sitting below `--admin-font-primary`,
    // which the set values inherit.
    serve({ profile: 'unset' })

    renderPage()

    const notSet = await screen.findAllByText('Not set')
    expect(notSet.length).toBe(2)
    for (const node of notSet) {
      expect(node.className).toContain('text-fg-secondary')
      expect(node.className).not.toContain('text-fg-light')
    }
  })
})

describe('CompanyDetailPage anonymity floor', () => {
  it('shows the floor as locked, with the words that say which way it moves', async () => {
    serve()

    renderPage()

    expect(await screen.findByText('Locked')).toBeTruthy()
    expect(screen.getByText('The anonymity floor cannot be lowered')).toBeTruthy()
    expect(screen.getByText(/higher floor is accepted/i).textContent).toMatch(/refused/i)
  })

  it('offers no control that could change the floor', async () => {
    // The API cannot store a different floor, so an editable field would accept a
    // number, look saved, and change nothing -- the failure the copy promises
    // does not happen.
    serve()

    renderPage()
    await screen.findByText('Locked')

    const floorLabel = screen.getByText('Anonymity floor')
    const block = floorLabel.parentElement!
    expect(block.querySelectorAll('input, select, textarea, button').length).toBe(0)
  })

  it('states the floor even when the settings request is refused', async () => {
    // It is a platform guarantee, not a value this screen looked up. Losing the
    // promise because one request 403'd would be the worst possible moment to
    // stop making it.
    serve({ settings: 'forbidden' })

    renderPage()

    expect(await screen.findByText('Locked')).toBeTruthy()
    expect(screen.getByText('Reporting settings could not be loaded.')).toBeTruthy()
    expect(screen.getByText(String(ANONYMITY_FLOOR))).toBeTruthy()
  })

  it('promises the number the suppression predicate actually enforces', async () => {
    serve()

    renderPage()
    const shown = Number((await screen.findByText(String(ANONYMITY_FLOOR))).textContent)

    expect(isSuppressed(shown - 1)).toBe(true)
    expect(isSuppressed(shown)).toBe(false)
  })
})

describe('CompanyDetailPage partial failures', () => {
  it('keeps reporting, the floor and departments when the profile is SuperAdmin-only', async () => {
    // GET /admin/companies/{id} is stricter than the rest of this page, so a
    // company_admin always 403s on it. That must degrade one tile, not the page.
    serve({ profile: 'forbidden' })

    renderPage()

    expect(
      await screen.findByText('Company profile details are only visible to a platform administrator.'),
    ).toBeTruthy()
    expect(await screen.findByText('Quarterly')).toBeTruthy()
    expect(screen.getByText('Locked')).toBeTruthy()
    expect(screen.getByText('Operations')).toBeTruthy()
  })

  it('hides the company edit action when the profile could not be read', async () => {
    // The form it opens is built out of the profile; offering it would open an
    // empty form over data nobody has.
    serve({ profile: 'forbidden' })

    await waitFor(async () => {
      renderPage()
      expect(await screen.findByText('Quarterly')).toBeTruthy()
    })

    expect(screen.queryByRole('button', { name: 'Edit company' })).toBeNull()
  })
})

describe('CompanyDetailPage editing', () => {
  it('opens the reporting form only on request, and submits the changed values', async () => {
    serve()

    renderPage()
    await screen.findByText('Quarterly')

    expect(screen.queryByRole('button', { name: 'Save settings' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Edit reporting' }))
    const frequency = await screen.findByLabelText('Survey frequency')
    await userEvent.clear(frequency)
    await userEvent.type(frequency, 'monthly')
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    await waitFor(() => {
      const writes = vi
        .mocked(fetch)
        .mock.calls.filter(
          (call) => String(call[0]).includes('/settings') && (call[1] as RequestInit).body !== '{}',
        )
      expect(writes.length).toBe(1)
      expect(String((writes[0][1] as RequestInit).body)).toContain('monthly')
    })
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
  it('names the design’s section, not the nav section', async () => {
    // Unlike its sibling screens this page holds a loading paragraph until the
    // profile resolves, so the header does not exist synchronously.
    serve()

    renderPage()

    await screen.findAllByText('Northwind Logistics')
    const eyebrow = document.querySelector('[data-slot="page-eyebrow"]')
    expect(eyebrow?.textContent).toBe('Company Administration')
  })
})
