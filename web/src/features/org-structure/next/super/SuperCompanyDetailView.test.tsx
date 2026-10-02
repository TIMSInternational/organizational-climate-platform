import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import CompanyDetailPage from '../../pages/CompanyDetailPage'
import { TranslationProvider, LOCALE_STORAGE_KEY } from '../../../../i18n'
import { CompanyContextProvider } from '../../../../company-context'
import { setToken, clearToken } from '../../../../auth/token'
import { tokenFor } from '../../../../test/jwtFixture'
import en from '../../../../i18n/en.json'

/**
 * `/admin/companies/:id` for a super administrator — the per-role canvas's Detalle de
 * empresa. Rendered through `CompanyDetailPage`, so the dispatch is pinned with the view;
 * `CompanyDetailPage.test.tsx` keeps pinning the page a company administrator gets.
 */
const copy = en.superadmin.next.companyDetail
const C = 'c1'

const DETAIL = {
  id: C,
  name: 'Grupo Meridiano S.A.',
  emailDomain: 'meridiano.test',
  industry: 'Servicios',
  size: 'medium',
  country: 'Costa Rica',
  subscriptionTier: 'basic',
  createdAt: '2026-09-10T01:58:51Z',
  userCount: 3,
}

const SETTINGS = {
  companyId: C,
  settings: { surveyFrequency: 'quarterly', microclimateEnabled: true, aiInsightsEnabled: true, anonymousSurveys: true, dataRetentionDays: 2555, timezone: 'America/Costa_Rica', language: 'es' },
  branding: { logoUrl: null, primaryColor: '#0d9488', secondaryColor: '#0f766e', fontFamily: 'Poppins', customCss: null },
}

const BANDS = { opportunityMin: 3, strengthMin: 4, criticalName: null, opportunityName: null, strengthName: null }

function user(name: string, role: string) {
  return { id: name, email: `${name}@meridiano.test`, name, role, departmentId: null, isActive: true, lastLoginAt: null, createdAt: '2026-09-10T00:00:00Z' }
}

interface Call {
  method: string
  url: string
  body: string | undefined
}

let calls: Call[] = []

function serve({ settings = 'ok' as 'ok' | 'forbidden', openWave = false, bands = true } = {}) {
  calls = []
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ method, url, body: typeof init?.body === 'string' ? init.body : undefined })
    const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    if (url.includes(`/admin/companies/${C}/settings`)) {
      if (settings !== 'ok') return Promise.resolve(new Response(JSON.stringify({ message: 'no' }), { status: 403 }))
      // An API older than the bands sends none; a write answers with the scale it kept.
      if (!bands) return ok(SETTINGS)
      const sent = (typeof init?.body === 'string' ? JSON.parse(init.body) : {}) as { resultBands?: typeof BANDS }
      return ok({ ...SETTINGS, resultBands: sent.resultBands ?? BANDS })
    }
    if (url.includes(`/admin/companies/${C}`)) return ok(DETAIL)
    if (url.includes('/admin/departments')) {
      return ok({
        departments: [
          { id: 'd1', companyId: C, name: 'Finanzas', description: null, parentDepartmentId: null, isActive: true, employeeCount: 6 },
          { id: 'd2', companyId: C, name: 'Calidad 79', description: null, parentDepartmentId: null, isActive: false, employeeCount: 0 },
        ],
      })
    }
    if (url.includes('/admin/users')) return ok({ users: [user('ana', 'company_admin'), user('luis', 'leader'), user('diego', 'employee')] })
    if (url.includes('/admin/demographic-fields')) return ok({ fields: [] })
    if (url.includes('/admin/reports')) {
      return ok([
        { id: 'r1', title: 'Clima — T3', type: 'climate_summary', companyId: C, status: 'completed', format: 'pdf', createdAt: '2026-09-10T02:06:09Z', isRecurring: false, recurrencePattern: null, nextGeneration: null },
      ])
    }
    if (url.includes('/admin/benchmarks')) return ok([])
    // The open wave's anonymity lives only on its detail (`settings.anonymous`).
    if (url.includes('/surveys/s-open')) return ok({ id: 's-open', settings: { anonymous: false } })
    if (url.includes('/surveys')) {
      return ok({
        surveys: openWave
          ? [{ id: 's-open', companyId: C, title: 'Encuesta de Clima Q4 (abierta)', status: 'active', type: 'periodic', language: 'es', startDate: '2026-09-03T02:03:39Z', endDate: '2026-10-10T02:03:39Z', responseCount: 3, targetAudienceCount: 24, questionCount: 6, createdAt: '2026-09-03T02:03:39Z' }]
          : [],
      })
    }
    if (url.includes('/dashboard/company-admin')) {
      return ok({ companyId: C, companyName: DETAIL.name, userCount: 3, activeUserCount: 3, departmentCount: 1, surveyCount: 0, activeSurveyCount: 0, draftSurveyCount: 0, responseCount: 0, completedResponseCount: 0, openActionPlanCount: 4, overdueActionPlanCount: 0, ongoingSurveys: [], departments: [] })
    }
    return Promise.resolve(new Response(null, { status: 404 }))
  })
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={[`/admin/companies/${C}`]}>
        <CompanyContextProvider>
          <Routes>
            <Route path="/admin/companies/:id" element={<CompanyDetailPage />} />
          </Routes>
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

const writes = () => calls.filter((call) => call.method === 'PUT' && call.body !== '{}')

beforeEach(() => {
  localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
  setToken(tokenFor({ role: 'super_admin', companyId: '' }))
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('SuperCompanyDetailView', () => {
  it('sends a super administrator to the canvas’s detail, reading the tenant into one form', async () => {
    serve()
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: copy.title })).toBeTruthy()
    expect((screen.getByLabelText(new RegExp(`^${copy.company.name}( \\*)?$`)) as HTMLInputElement).value).toBe('Grupo Meridiano S.A.')
    expect((screen.getByLabelText(new RegExp(`^${copy.surveys.language}`)) as HTMLSelectElement).value).toBe('es')
    expect((screen.getByLabelText(copy.surveys.retention) as HTMLInputElement).value).toBe('2555')
    // As wide as its digits (monospace), so the unit follows the value instead of the field's edge.
    expect((screen.getByLabelText(copy.surveys.retention) as HTMLInputElement).style.width).toBe('4ch')
  })

  it('offers both actions from the start, and a save with nothing changed sends nothing and says so', async () => {
    serve()
    renderPage()
    await screen.findByRole('heading', { level: 1, name: copy.title })
    const save = screen.getByRole('button', { name: copy.save })
    expect(save.hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: copy.discard }).hasAttribute('disabled')).toBe(false)
    await userEvent.click(save)
    expect((await screen.findAllByText(copy.nothingToSave)).length).toBeGreaterThan(0)
    expect(writes()).toEqual([])
  })

  it('names the open wave’s own anonymity under the default, read from its detail', async () => {
    serve({ openWave: true })
    renderPage()
    expect(
      await screen.findByText(
        copy.surveys.anonymityHelperOpen.replace('{code}', 'Q4').replace('{state}', copy.surveys.stateNamed),
      ),
    ).toBeTruthy()
  })

  it('reaches the four pages this role opens only from here, each with its own reading', async () => {
    serve()
    renderPage()
    await screen.findByRole('heading', { level: 1, name: copy.title })
    const hrefOf = (name: string) => screen.getByRole('link', { name: new RegExp(`^${name}`) }).getAttribute('href')
    expect(hrefOf(en.navigation.users)).toBe(`/admin/companies/${C}/users`)
    expect(hrefOf(en.navigation.demographicFields)).toBe(`/admin/companies/${C}/demographic-fields`)
    expect(hrefOf(en.navigation.reports)).toBe(`/admin/companies/${C}/reports`)
    expect(hrefOf(en.navigation.analytics)).toBe(`/admin/companies/${C}/analytics`)
    expect(screen.getByText(copy.links.usersSub.replace('{people}', '3').replace('{leaders}', '1'))).toBeTruthy()
    expect(screen.getByText(copy.company.readPlansNoneOverdue.replace('{open}', '4'))).toBeTruthy()
  })

  it('saves only what changed — the profile first, then the settings — and reads the tenant again', async () => {
    serve()
    renderPage()
    const country = await screen.findByLabelText(copy.company.country)
    await userEvent.selectOptions(country, 'Panama')
    await userEvent.selectOptions(screen.getByLabelText(new RegExp(`^${copy.surveys.language}`)), 'en')
    await userEvent.click(screen.getByRole('button', { name: copy.save }))

    await waitFor(() => expect(writes()).toHaveLength(2))
    const [profile, settings] = writes()
    expect(profile.url).toMatch(new RegExp(`/admin/companies/${C}$`))
    expect(JSON.parse(profile.body ?? '')).toEqual({ country: 'Panama' })
    expect(settings.url).toContain(`/admin/companies/${C}/settings`)
    expect(JSON.parse(settings.body ?? '')).toEqual({ language: 'en' })
    await waitFor(() => expect(calls.filter((call) => call.method === 'GET' && call.url.endsWith(`/admin/companies/${C}`))).toHaveLength(2))
  })

  it('offers País as the canvas’s select over the countries, with the tenant’s own value selected', async () => {
    serve()
    renderPage()
    const country = (await screen.findByLabelText(copy.company.country)) as HTMLSelectElement
    expect(country.tagName).toBe('SELECT')
    expect(country.value).toBe('Costa Rica')
    expect([...country.options].map((option) => option.value)).toContain('Colombia')
  })

  it('puts the form back on Discard, and offers no save for a retention it would refuse', async () => {
    serve()
    renderPage()
    const name = await screen.findByLabelText(new RegExp(`^${copy.company.name}( \\*)?$`))
    await userEvent.type(name, ' Holding')
    expect(screen.getByRole('button', { name: copy.save }).hasAttribute('disabled')).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: copy.discard }))
    expect((name as HTMLInputElement).value).toBe('Grupo Meridiano S.A.')

    const retention = screen.getByLabelText(copy.surveys.retention)
    await userEvent.clear(retention)
    await userEvent.type(retention, 'siete')
    expect(screen.getByRole('button', { name: copy.save }).hasAttribute('disabled')).toBe(true)
  })

  it('says the settings could not be read and saves the profile alone, never guessing the settings', async () => {
    serve({ settings: 'forbidden' })
    renderPage()
    expect((await screen.findAllByText(en.companySettings.settingsUnavailable)).length).toBe(2)
    const country = screen.getByLabelText(copy.company.country)
    await userEvent.selectOptions(country, 'Panama')
    await userEvent.click(screen.getByRole('button', { name: copy.save }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0].url).not.toContain('/settings')
  })
})

describe('SuperCompanyDetailView Encuestas card', () => {
  it('offers no AI insights switch: the canvas’s card has six fields, and the setting is left as the tenant has it', async () => {
    serve()
    renderPage()
    await screen.findByText(copy.onlyHereLead)
    expect(screen.queryByText(copy.surveys.aiInsights)).toBeNull()
  })
})

describe('SuperCompanyDetailView Escala de resultados', () => {
  const bandsCopy = en.resultBands.settings
  const box = (name: string) => screen.getByLabelText(name) as HTMLInputElement

  it('draws the company’s scale, read with its settings', async () => {
    serve()
    renderPage()
    const card = (await screen.findByRole('heading', { name: bandsCopy.heading })).closest('section') as HTMLElement
    expect(box(bandsCopy.nameLabel.replace('{colour}', 'red')).value).toBe(en.resultBands.name.critical)
    expect(box(bandsCopy.fromLabel.replace('{band}', en.resultBands.name.opportunity)).value).toBe('3.00')
    expect(box(bandsCopy.fromLabel.replace('{band}', en.resultBands.name.strength)).value).toBe('4.00')
    expect(within(card).getByRole('status').textContent).toBe(bandsCopy.valid)
  })

  it('names a gap and holds Guardar cambios while the scale is not whole', async () => {
    serve()
    renderPage()
    await screen.findByRole('heading', { name: bandsCopy.heading })
    const from = box(bandsCopy.fromLabel.replace('{band}', en.resultBands.name.opportunity))
    await userEvent.clear(from)
    await userEvent.type(from, '3.10')
    expect(screen.getByRole('alert').textContent).toContain(
      bandsCopy.errorGap.replace('{from}', '2.99').replace('{to}', '3.10').replace('{example}', '3.05'),
    )
    expect(screen.getByRole('button', { name: copy.save }).hasAttribute('disabled')).toBe(true)
    expect(writes()).toEqual([])
  })

  it('sends the whole scale to this company’s settings — the defaults as null — and nothing else', async () => {
    serve()
    renderPage()
    await screen.findByRole('heading', { name: bandsCopy.heading })
    const from = box(bandsCopy.fromLabel.replace('{band}', en.resultBands.name.opportunity))
    await userEvent.clear(from)
    await userEvent.type(from, '3.10')
    const to = box(bandsCopy.toLabel.replace('{band}', en.resultBands.name.critical))
    await userEvent.clear(to)
    await userEvent.type(to, '3.09')
    expect(screen.queryByRole('alert')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: copy.save }))

    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0].url).toMatch(new RegExp(`/admin/companies/${C}/settings$`))
    expect(JSON.parse(writes()[0].body ?? '')).toEqual({
      resultBands: { opportunityMin: 3.1, strengthMin: 4, criticalName: null, opportunityName: null, strengthName: null },
    })
  })

  it('draws no card when the settings carry no scale', async () => {
    serve({ bands: false })
    renderPage()
    await screen.findByRole('heading', { level: 1, name: copy.title })
    expect(screen.queryByRole('heading', { name: bandsCopy.heading })).toBeNull()
  })
})
