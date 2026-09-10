import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import AdminDashboardNextView from './AdminDashboardNextView'
import { sampleModel } from './sampleModel'
import { TranslationProvider } from '../../../i18n'
import { CompanyContextProvider } from '../../../company-context'
import en from '../../../i18n/en.json'

const copy = en.dashboard.next

/**
 * The view alone, handed the sample directly. Which roles reach it — a company_admin,
 * and a super_admin once a tenant is selected — is `DashboardPage`'s dispatch and is
 * proven in `DashboardPage.test.tsx`.
 */
function renderView(model = sampleModel) {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/dashboard']}>
        <CompanyContextProvider>
          <AdminDashboardNextView model={model} />
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

describe('AdminDashboardNextView', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem('preferredLocale', 'en')
  })
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('renders the six sections, and its three actions land somewhere that exists', () => {
    renderView()
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
