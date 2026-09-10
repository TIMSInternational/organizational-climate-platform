import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import DashboardNextPage from './DashboardNextPage'
import AdminDashboardNextView from './AdminDashboardNextView'
import { sampleModel } from './sampleModel'
import { TranslationProvider } from '../../../i18n'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../company-context'
import { setToken } from '../../../auth/token'
import { tokenFor } from '../../../test/jwtFixture'
import en from '../../../i18n/en.json'

const copy = en.dashboard.next

function renderAt(role: string, companyId = 'c1') {
  setToken(tokenFor({ role, companyId }))
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/dashboard/next']}>
        <CompanyContextProvider>
          <Routes>
            <Route path="/dashboard/next" element={<DashboardNextPage />} />
            <Route path="/dashboard" element={<div data-testid="home" />} />
          </Routes>
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

/**
 * The view reads the viewer's capabilities off the stored token, so every render names a
 * viewer. The default is the company administrator the screen is drawn for; the role
 * tests below hand it the others.
 */
function renderView(model = sampleModel, viewer: Record<string, unknown> = { role: 'company_admin' }) {
  setToken(tokenFor({ sub: 'u1', companyId: 'c1', nodoId: '', ...viewer }))
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/dashboard/next']}>
        <CompanyContextProvider>
          <AdminDashboardNextView model={model} />
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

/** Every `href` on the screen that matches `pattern` — the role tests assert this is empty. */
function linksMatching(pattern: RegExp): string[] {
  return screen
    .queryAllByRole('link')
    .map((link) => link.getAttribute('href') ?? '')
    .filter((href) => pattern.test(href))
}

describe('DashboardNextPage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem('preferredLocale', 'en')
  })
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('renders the six sections for a company administrator', () => {
    renderAt('company_admin')
    expect(screen.getByRole('heading', { level: 1, name: copy.title })).toBeTruthy()
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings).toEqual([
      copy.whereHeading,
      copy.movedHeading,
      copy.byGroupHeading.replace('{wave}', 'Q3'),
      copy.attentionHeading,
      copy.cycleHeading,
    ])
    expect(screen.getByRole('link', { name: copy.newSurvey }).getAttribute('href')).toBe('/surveys/new')
    expect(screen.getByRole('link', { name: copy.launchMicroclimate }).getAttribute('href')).toBe(
      '/microclimates/new',
    )
    expect(screen.getByRole('link', { name: copy.openResults }).getAttribute('href')).toBe(
      '/surveys/s-q3/results',
    )
    expect(screen.getByRole('link', { name: copy.viewSession }).getAttribute('href')).toBe(
      '/microclimates/mc-1/live',
    )
  })

  it('sends every other role back to /dashboard', () => {
    for (const role of ['employee', 'leader', 'supervisor']) {
      renderAt(role)
      expect(screen.getByTestId('home')).toBeTruthy()
      expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
      cleanup()
    }
    // A SuperAdmin without a tenant chosen has no company to show.
    renderAt('super_admin', '')
    expect(screen.getByTestId('home')).toBeTruthy()
    cleanup()
    window.localStorage.setItem(COMPANY_CONTEXT_STORAGE_KEY, 'c9')
    renderAt('super_admin', '')
    expect(screen.getByRole('heading', { level: 1, name: copy.title })).toBeTruthy()
  })

  it('prints no digit anywhere on a protected map row', () => {
    renderView()
    const header = screen.getByRole('rowheader', { name: /Finanzas/ })
    const row = header.closest('tr')
    expect(row).not.toBeNull()
    expect(row?.textContent ?? '').not.toMatch(/\d/)
    // The disclosed rows do print their readings, so the absence above is the floor's doing.
    const disclosed = screen.getByRole('rowheader', { name: /Operaciones/ }).closest('tr')
    expect(disclosed?.textContent ?? '').toMatch(/2\.4/)
  })

  it('marks exactly the two dimensions below the target as below target', () => {
    renderView()
    const chips = screen.getAllByText(copy.belowTarget)
    expect(chips).toHaveLength(2)
    const dimensions = chips
      .map((chip) => chip.closest('[data-slot="trend-card"]')?.getAttribute('data-dimension'))
      .sort()
    expect(dimensions).toEqual(['carga', 'reconocimiento'])
  })

  it('renders the three attention items, each with its action as a link', () => {
    renderView()
    const items = document.querySelectorAll('[data-slot="attention-item"]')
    expect(items).toHaveLength(3)
    const hrefs = Array.from(items).map((item) => within(item as HTMLElement).getByRole('link').getAttribute('href'))
    expect(hrefs).toEqual(['/action-plans/ap-1', '/tracking/planes/tp-1', '/surveys/s-q4'])
    // The lowest cell is derived from the map, not typed: Operaciones × Carga de trabajo at 2.4.
    expect(items[0].textContent).toContain('Operaciones')
    expect(items[0].textContent).toContain('2.4')
    // 30 days from the model's `asOf` to the close, computed, not the calendar's.
    expect(items[2].textContent).toContain('30')
  })

  it('offers an employee viewer none of the top-bar actions and none of the attention actions', () => {
    renderView(sampleModel, { role: 'employee' })
    expect(screen.queryByRole('link', { name: copy.newSurvey })).toBeNull()
    expect(screen.queryByRole('link', { name: copy.launchMicroclimate })).toBeNull()
    expect(screen.queryByRole('button', { name: copy.export })).toBeNull()
    // The rows still inform; they just offer nothing the server would refuse.
    const items = document.querySelectorAll('[data-slot="attention-item"]')
    expect(items).toHaveLength(3)
    for (const item of Array.from(items)) {
      expect(within(item as HTMLElement).queryByRole('link')).toBeNull()
    }
    // Nor the two section links: `/surveys/{id}/results` is `CanAdminister` and the live
    // microclimate loader is `CanAccessCompany` — both 403 for an employee.
    expect(screen.queryByRole('link', { name: copy.openResults })).toBeNull()
    expect(screen.queryByRole('link', { name: copy.viewSession })).toBeNull()
    expect(linksMatching(/^\/surveys\/[^/]+\/results$/)).toEqual([])
    expect(linksMatching(/^\/microclimates\/[^/]+\/live$/)).toEqual([])
  })

  it('offers a leader their own node’s progress action and their export, and nothing else', () => {
    renderView(sampleModel, { role: 'leader', nodoId: 'nodo-finanzas' })
    expect(screen.queryByRole('link', { name: copy.newSurvey })).toBeNull()
    expect(screen.queryByRole('link', { name: copy.launchMicroclimate })).toBeNull()
    expect(screen.getByRole('button', { name: copy.export })).toBeTruthy()
    const items = Array.from(document.querySelectorAll('[data-slot="attention-item"]')) as HTMLElement[]
    expect(items).toHaveLength(3)
    expect(within(items[0]).queryByRole('link')).toBeNull()
    expect(within(items[1]).getByRole('link').getAttribute('href')).toBe('/tracking/planes/tp-1')
    expect(within(items[2]).queryByRole('link')).toBeNull()
    // A leader is not an admin: no results link and no live-session link either.
    expect(linksMatching(/^\/surveys\/[^/]+\/results$/)).toEqual([])
    expect(linksMatching(/^\/microclimates\/[^/]+\/live$/)).toEqual([])
    cleanup()
    // The leader of another node may read the overdue plan but not record on it.
    renderView(sampleModel, { role: 'leader', nodoId: 'nodo-operaciones' })
    const other = Array.from(document.querySelectorAll('[data-slot="attention-item"]')) as HTMLElement[]
    expect(within(other[1]).queryByRole('link')).toBeNull()
  })

  it('marks the open wave, and only it, as the current step of the cycle', () => {
    renderView()
    const current = document.querySelectorAll('[data-slot="cycle-step"][data-current="true"]')
    expect(current).toHaveLength(1)
    expect(current[0].textContent).toContain('Q4')
    expect(document.querySelectorAll('[data-slot="cycle-step"]')).toHaveLength(5)
  })

  it('shows the sample chip while the model is the sample, and not otherwise', () => {
    renderView()
    expect(screen.getByText(copy.sampleChip)).toBeTruthy()
    cleanup()
    renderView({ ...sampleModel, isSample: false })
    expect(screen.queryByText(copy.sampleChip)).toBeNull()
  })

  it('derives the headline average and its delta from the dimension series', () => {
    renderView()
    // (4.0 + 3.8 + 3.8 + 3.7 + 3.4 + 3.3) / 6 = 3.67; Q2 was 3.35, so +0.32.
    const tiles = document.querySelectorAll('[data-slot="kpi-tile"]')
    expect(tiles[0].textContent).toContain('3.67')
    expect(tiles[0].textContent).toContain('0.32')
    expect(tiles[1].textContent).toContain('100%')
    expect(tiles[1].textContent).toContain('Finanzas')
    expect(tiles[3].textContent).toContain('Finanzas')
  })
})
