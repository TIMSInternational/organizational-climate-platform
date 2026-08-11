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

const COMPANY = 'company-1'

function tokenFor(claims: Record<string, unknown>): string {
  const body = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `header.${body}.signature`
}

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
  profile?: 'ok' | 'forbidden'
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
      return Promise.resolve(new Response(JSON.stringify(companyDetail()), { status: 200 }))
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
    expect(await screen.findByText('quarterly')).toBeTruthy()
    expect(screen.getByText('730 days')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Load settings' })).toBeNull()
  })

  it('reads the settings with an empty body, which writes nothing', async () => {
    // There is no GET for company settings; PUT with every member absent is the
    // read. If this ever became a PUT with a body, opening the page would edit
    // the company.
    serve()

    renderPage()
    await screen.findByText('quarterly')

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
    expect(await screen.findByText('quarterly')).toBeTruthy()
    expect(screen.getByText('Locked')).toBeTruthy()
    expect(screen.getByText('Operations')).toBeTruthy()
  })

  it('hides the company edit action when the profile could not be read', async () => {
    // The form it opens is built out of the profile; offering it would open an
    // empty form over data nobody has.
    serve({ profile: 'forbidden' })

    await waitFor(async () => {
      renderPage()
      expect(await screen.findByText('quarterly')).toBeTruthy()
    })

    expect(screen.queryByRole('button', { name: 'Edit company' })).toBeNull()
  })
})

describe('CompanyDetailPage editing', () => {
  it('opens the reporting form only on request, and submits the changed values', async () => {
    serve()

    renderPage()
    await screen.findByText('quarterly')

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
