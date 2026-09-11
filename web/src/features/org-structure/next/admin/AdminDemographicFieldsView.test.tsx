import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import raw from '../../../../../scripts/shot-fixtures/super-meridiano.json?raw'
import DemographicsNextPage from '../DemographicsNextPage'
import { LOCALE_STORAGE_KEY, TranslationProvider } from '../../../../i18n'
import { CompanyContextProvider } from '../../../../company-context'
import { clearToken, setToken } from '../../../../auth/token'
import { tokenFor } from '../../../../test/jwtFixture'
import { MERIDIANO_ID, superMeridianoFetch } from '../../../../test/superMeridianoFetch'
import type { DemographicField } from '../../api/demographicFields'
import { PROTECTED_HATCH } from '../../../../components/charts/suppression'
import es from '../../../../i18n/es.json'

/**
 * The company administrator's *Campos demográficos* (`DemographicFields` artboard) through its
 * route page, `DemographicsNextPage`, answered from the Meridiano capture — which has no
 * demographic field, so the proposal is what it draws. Every mean is computed here from the
 * capture's `activeUserCount`.
 */
const FIXTURE = JSON.parse(raw) as Record<string, unknown>
const PEOPLE = (FIXTURE['GET /dashboard/company-admin'] as { activeUserCount: number }).activeUserCount
const T = es.demographicFields.next
const ROUTE = `/admin/companies/${MERIDIANO_ID}/demographic-fields`

function fill(text: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((out, [key, value]) => out.replace(`{${key}}`, String(value)), text)
}

function fetchWith(overrides: Record<string, () => Response | Promise<Response>> = {}) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const pathname = new URL(String(input), 'http://api.test').pathname.replace(/^\/undefined(?=\/)/, '')
    const override = overrides[`${(init?.method ?? 'GET').toUpperCase()} ${pathname}`]
    return override ? Promise.resolve(override()) : superMeridianoFetch(input, init)
  })
}

function field(over: Partial<DemographicField>): DemographicField {
  return {
    id: 'turno',
    companyId: MERIDIANO_ID,
    field: 'turno',
    label: 'Turno',
    type: 'select',
    options: ['Día', 'Noche', 'Mixto'].map((label, order) => ({ order, value: label.toLowerCase(), label })),
    required: false,
    order: 1,
    isActive: true,
    resolvedLocale: 'es',
    fallbackFields: [],
    ...over,
  }
}

const OWN_FIELDS = [
  field({}),
  field({
    id: 'edad',
    field: 'edad',
    label: 'Edad',
    order: 2,
    options: Array.from({ length: 9 }, (_, order) => ({ order, value: `r${order}`, label: `Rango ${order}` })),
  }),
  field({ id: 'ingreso', field: 'ingreso', label: 'Ingreso', type: 'date', options: null, order: 3 }),
  field({ id: 'nivel', field: 'nivel', label: 'Nivel', order: 4, isActive: false }),
]

function renderAt(url = ROUTE) {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={[url]}>
        <CompanyContextProvider>
          <Routes>
            <Route path="/admin/companies/:companyId/demographic-fields" element={<DemographicsNextPage />} />
          </Routes>
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

const row = (key: string) => document.querySelector(`tr[data-field="${key}"]`) as HTMLElement

describe('AdminDemographicFieldsView (company administrator)', () => {
  beforeEach(() => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    setToken(tokenFor({ role: 'company_admin', companyId: MERIDIANO_ID }))
  })

  afterEach(() => {
    cleanup()
    clearToken()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('proposes the sample catalogue under the sample chip, divided by the real active people', async () => {
    vi.stubGlobal('fetch', fetchWith())
    renderAt()
    expect(await screen.findByRole('heading', { name: T.catalogue.headingSample })).toBeTruthy()
    expect(screen.getByText(es.dashboard.next.sampleChip)).toBeTruthy()
    expect(screen.getByText(T.tiles.fieldsNone)).toBeTruthy()
    expect(within(row('antiguedad')).getByText(String(Math.floor(PEOPLE / 4)))).toBeTruthy()
    expect(within(row('tipo_jornada')).getByText(String(Math.floor(PEOPLE / 3)))).toBeTruthy()
  })

  it('never prints a mean under the floor: the narrow list reads "menos de 5" and says what would clear it', async () => {
    vi.stubGlobal('fetch', fetchWith())
    renderAt()
    await screen.findByRole('heading', { name: T.catalogue.headingSample })
    const age = row('rango_edad')
    expect(age.querySelector('[data-per-value]')).toBeNull()
    expect(within(age).getByText(fill(T.catalogue.belowFloor, { floor: 5 }))).toBeTruthy()
    // Nine bands merged in pairs until the whole-number mean clears the floor: the board's
    // "con 5 rangos serían 8 por valor" for its 42 people, computed here from the capture.
    let ranges = 9
    while (ranges >= 2 && Math.floor(PEOPLE / ranges) < 5) ranges = Math.ceil(ranges / 2)
    expect(Math.floor(PEOPLE / ranges)).toBeGreaterThanOrEqual(5)
    expect(within(age).getByText(fill(T.catalogue.narrowSub, { ranges, perValue: Math.floor(PEOPLE / ranges) }))).toBeTruthy()
  })

  it('marks a protected mean and the floor legend with the canvas hatch, and draws no figure in either', async () => {
    vi.stubGlobal('fetch', fetchWith())
    renderAt()
    await screen.findByRole('heading', { name: T.catalogue.headingSample })
    const marks = [row('rango_edad'), document.querySelector('[data-slot="floor-band"]') as HTMLElement].map((region) =>
      region.querySelector('[data-slot="protected-swatch"]'),
    )
    for (const mark of marks) {
      expect(mark).not.toBeNull()
      expect(mark?.className).toContain(PROTECTED_HATCH)
      expect(mark?.getAttribute('aria-hidden')).toBe('true')
      expect(mark?.textContent).toBe('')
      expect(mark?.querySelector('svg')).toBeNull()
    }
  })

  it("draws the tenant's own catalogue with no sample chip, and counts only the cuts that clear the floor", async () => {
    vi.stubGlobal('fetch', fetchWith({ 'GET /admin/demographic-fields': () => new Response(JSON.stringify({ fields: OWN_FIELDS })) }))
    renderAt()
    expect(await screen.findByRole('heading', { name: T.catalogue.heading })).toBeTruthy()
    expect(screen.queryByText(es.dashboard.next.sampleChip)).toBeNull()
    expect(within(row('turno')).getByText(T.catalogue.usable)).toBeTruthy()
    expect(within(row('edad')).getByText(T.catalogue.narrow)).toBeTruthy()
    expect(within(row('ingreso')).getByText(T.catalogue.notACut)).toBeTruthy()
    expect(within(row('ingreso')).getByText(T.catalogue.typeDate)).toBeTruthy()
    expect(within(row('nivel')).getByText(T.catalogue.notOffered)).toBeTruthy()
    expect(screen.getByText(T.tiles.cutUnitUsable)).toBeTruthy()
    expect(screen.queryByText('select')).toBeNull()
  })

  it('claims no verdict and prints no mean when the headcount could not be read', async () => {
    vi.stubGlobal('fetch', fetchWith({ 'GET /dashboard/company-admin': () => new Response(null, { status: 500 }) }))
    renderAt()
    expect(await screen.findByText(T.tiles.peopleUnavailable)).toBeTruthy()
    expect(document.querySelector('[data-per-value]')).toBeNull()
    expect(screen.queryByText(T.catalogue.usable)).toBeNull()
  })

  it('says nothing about the catalogue while the list is still in flight', async () => {
    vi.stubGlobal('fetch', fetchWith({ 'GET /admin/demographic-fields': () => new Promise<Response>(() => {}) }))
    renderAt()
    await screen.findByRole('heading', { name: es.navigation.demographicFields })
    expect(screen.queryByText(T.tiles.fieldsNone)).toBeNull()
    expect(screen.queryByRole('heading', { name: T.catalogue.headingSample })).toBeNull()
  })

  it('shows an error with a retry, not the proposal, when the list fails', async () => {
    vi.stubGlobal('fetch', fetchWith({ 'GET /admin/demographic-fields': () => new Response(null, { status: 500 }) }))
    renderAt()
    expect(await screen.findByText(T.loadFailed)).toBeTruthy()
    expect(screen.getByRole('button', { name: es.common.retry })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: T.catalogue.headingSample })).toBeNull()
  })

  it('opens the form from "Nuevo campo", and a sample row starts one from the example', async () => {
    vi.stubGlobal('fetch', fetchWith())
    const user = userEvent.setup()
    renderAt()
    await user.click(await screen.findByRole('button', { name: fill(T.catalogue.useNamed, { label: es.demographicFields.next.sample.tenure }) }))
    expect(screen.getByRole('heading', { name: es.superadmin.next.demographics.form.newHeading })).toBeTruthy()
    expect(screen.getByDisplayValue(es.superadmin.next.demographics.starter.label)).toBeTruthy()
  })

  it('tells a leader the page is not theirs and asks the server for nothing', async () => {
    setToken(tokenFor({ role: 'leader', companyId: MERIDIANO_ID }))
    const fetchMock = fetchWith()
    vi.stubGlobal('fetch', fetchMock)
    renderAt()
    expect(await screen.findByText(T.forbidden)).toBeTruthy()
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/admin/demographic-fields'))).toBe(false)
    expect(screen.queryByRole('button', { name: T.newField })).toBeNull()
  })
})
