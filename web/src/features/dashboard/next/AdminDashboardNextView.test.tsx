import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import AdminDashboardNextView from './AdminDashboardNextView'
import { getCompanyDashboardExport } from '../api/dashboardExport'
import { downloadBlobFile } from '../../../lib/downloadBlobFile'
import { sampleModel } from './sampleModel'
import type { AdminDashboardModel, RegionStatuses } from './model'
import { TranslationProvider } from '../../../i18n'
import { CompanyContextProvider } from '../../../company-context'
import { setToken } from '../../../auth/token'
import { tokenFor } from '../../../test/jwtFixture'
import en from '../../../i18n/en.json'
import { calendarDay } from '../../../lib/calendarDay'

const copy = en.dashboard.next

vi.mock('../api/dashboardExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/dashboardExport')>()),
  getCompanyDashboardExport: vi.fn(),
}))
vi.mock('../../../lib/downloadBlobFile', () => ({ downloadBlobFile: vi.fn() }))

/**
 * The view reads the viewer's capabilities off the stored token, so every render names a
 * viewer. The default is the company administrator the screen is drawn for; the role
 * tests below hand it the others.
 */
function renderView(
  model: AdminDashboardModel = sampleModel,
  viewer: Record<string, unknown> = { role: 'company_admin' },
  regions?: RegionStatuses,
) {
  setToken(tokenFor({ sub: 'u1', companyId: 'c1', nodoId: '', ...viewer }))
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/dashboard']}>
        <CompanyContextProvider>
          <AdminDashboardNextView model={model} regions={regions} />
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

describe('AdminDashboardNextView', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem('preferredLocale', 'en')
    vi.mocked(getCompanyDashboardExport).mockReset()
    vi.mocked(downloadBlobFile).mockReset()
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
    expect(screen.getByRole('link', { name: copy.viewSession }).getAttribute('href')).toBe(
      '/microclimates/mc-1/live',
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
    // Counted on the cards: the map's key says the same words, "bajo la meta", by design.
    const chips = screen.getAllByText(copy.belowTarget).filter((chip) => chip.closest('[data-slot="trend-card"]'))
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
    expect(hrefs).toEqual(['/action-plans/ap-1', '/tracking/planes/tp-1', '/surveys/s-q4/distribution'])
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

  it('offers a leader their own node’s progress action, and not the company’s export', () => {
    renderView(sampleModel, { role: 'leader', nodoId: 'nodo-finanzas' })
    expect(screen.queryByRole('link', { name: copy.newSurvey })).toBeNull()
    expect(screen.queryByRole('link', { name: copy.launchMicroclimate })).toBeNull()
    // The button now fetches `/dashboard/company-admin/export`, which is the whole
    // company's file: an admin with a company. A leader's export is the department's
    // (`DashboardEndpoints.cs:124`), on the dashboard a leader actually lands on.
    expect(screen.queryByRole('button', { name: copy.export })).toBeNull()
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

  it('signs the change on every trend card from the series, never from a literal', () => {
    renderView()
    // Pertenencia went 3.7 → 4.0, so the card says +0.3; Carga 3.0 → 3.3, also up.
    const card = document.querySelector('[data-slot="trend-card"][data-dimension="pertenencia"]')
    expect(card?.textContent).toContain('+0.3')
    expect(card?.textContent).not.toContain('-0.3')
  })

  it('names, in its own section, each region that fell back to the sample — and only those', () => {
    const live: RegionStatuses = {
      company: { status: 'live' },
      surveys: { status: 'live' },
      trends: { status: 'live' },
      map: { status: 'fallback', reason: 'failed', error: 'Service unavailable' },
      actionPlans: { status: 'live' },
      tracking: { status: 'off' },
      microclimates: { status: 'fallback', reason: 'empty' },
    }
    renderView(sampleModel, undefined, live)
    const notices = document.querySelectorAll('[data-slot="region-fallback"]')
    expect(Array.from(notices).map((node) => node.getAttribute('data-region'))).toEqual(['map', 'microclimates'])
    expect(notices[0].textContent).toBe(
      copy.fallbackRegion.replace('{region}', copy.regionMap).replace('{error}', 'Service unavailable'),
    )
    expect(notices[1].textContent).toBe(copy.fallbackEmpty.replace('{region}', copy.regionMicroclimates))
    // The map notice sits inside the map's own section.
    expect(notices[0].closest('section')?.getAttribute('aria-labelledby')).toBe('next-by-group')
  })

  it('offers to create a plan when none covers the lowest cell, and says only what it knows about reminders', () => {
    const attention = sampleModel.attention.map((item) =>
      item.kind === 'lowest-cell'
        ? { ...item, plan: null }
        : item.kind === 'low-participation'
          ? { ...item, remindersSent: null }
          : item,
    )
    renderView({ ...sampleModel, attention })
    const items = document.querySelectorAll('[data-slot="attention-item"]')
    expect(items[0].textContent).toContain(copy.lowestCellNoPlanSub)
    expect(within(items[0] as HTMLElement).getByRole('link', { name: copy.createPlan }).getAttribute('href')).toBe(
      '/action-plans',
    )
    expect(items[2].textContent).not.toContain('no reminder sent yet')
    expect(items[2].textContent).toContain('Q3 closed at 100%')
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
  it('wires Exportar to the file the server renders: one button, two formats, fetched with the bearer', async () => {
    vi.mocked(getCompanyDashboardExport).mockResolvedValue(new Blob(['csv']))
    renderView()
    await userEvent.click(screen.getByRole('button', { name: copy.export }))
    await userEvent.click(await screen.findByRole('menuitem', { name: en.dashboard.exportCsv }))
    await waitFor(() => expect(vi.mocked(downloadBlobFile)).toHaveBeenCalledTimes(1))
    expect(vi.mocked(getCompanyDashboardExport).mock.calls[0]?.slice(1)).toEqual(['csv', { companyId: undefined, lang: 'en' }])
  })

  it('says so when the export fails, and does not swallow it', async () => {
    vi.mocked(getCompanyDashboardExport).mockRejectedValue(new Error('Request failed: 500'))
    renderView()
    await userEvent.click(screen.getByRole('button', { name: copy.export }))
    await userEvent.click(await screen.findByRole('menuitem', { name: en.dashboard.exportPdf }))
    expect((await screen.findByRole('alert')).textContent).toBe(en.dashboard.exportFailed)
    expect(vi.mocked(downloadBlobFile)).not.toHaveBeenCalled()
  })

  it('judges "below target" at the decimal the card prints: a 3.67 reads 3.7 and is on target', () => {
    const dimensions = sampleModel.dimensions.map((dimension) =>
      dimension.key === 'confianza' ? { ...dimension, values: [2.96, 3.33, 3.67] } : dimension,
    )
    renderView({ ...sampleModel, dimensions })
    const card = document.querySelector('[data-slot="trend-card"][data-dimension="confianza"]') as HTMLElement
    expect(card.textContent).toContain('3.7')
    expect(card.getAttribute('data-below-target')).toBe('false')
    expect(within(card).queryByText(copy.belowTarget)).toBeNull()
  })

  it('draws the trend cards highest latest reading first, whatever order the model holds them in', () => {
    renderView({ ...sampleModel, dimensions: [...sampleModel.dimensions].reverse() })
    const order = [...document.querySelectorAll('[data-slot="trend-card"]')].map((card) => card.getAttribute('data-dimension'))
    // 4.0, then the two 3.8s in the order they came, then 3.7, 3.4, 3.3.
    expect(order).toEqual(['pertenencia', 'seguridad', 'desarrollo', 'confianza', 'reconocimiento', 'carga'])
  })

  it('shows the climate move signed and without an arrow, in the good-news ink when it rose', () => {
    renderView()
    const move = document.querySelector('[data-slot="climate-move"]') as HTMLElement
    expect(move.textContent).toContain('+0.32')
    expect(move.textContent).not.toMatch(/[▲▼]/)
    expect(move.className).toContain('text-accent-green-ink')
  })

  it('projects the next quarter as a hollow "to plan" step when nothing is planned after the open wave', () => {
    renderView({ ...sampleModel, waves: sampleModel.waves.filter((wave) => wave.status !== 'planned') })
    const steps = [...document.querySelectorAll('[data-slot="cycle-step"]')]
    expect(steps).toHaveLength(5)
    expect(steps[4].textContent).toContain('Q1 2027')
    expect(steps[4].textContent).toContain(copy.wavePlanned)
    // The open wave names itself as the canvas does, "Q4 open", over what its date means.
    expect(steps[3].textContent).toContain(copy.waveOpen.replace('{code}', 'Q4'))
    expect(steps[3].textContent).toContain(copy.waveCloses.replace('{date}', calendarDay(Date.parse('2026-10-10'), 'en')))
  })

  it('writes the overdue plan’s due date in words and its progress as the percentage it is', () => {
    renderView()
    const items = document.querySelectorAll('[data-slot="attention-item"]')
    expect(items[1].textContent).toContain('August 20')
    expect(items[1].textContent).toContain('0%')
  })
  it('draws the six sparklines on one scale, so their slopes compare', () => {
    renderView()
    const rules = [...document.querySelectorAll('[data-slot="trend-card"] line[data-slot="trend-target"]')]
    expect(rules).toHaveLength(6)
    // Fitted one by one, each target rule would sit at its own height.
    expect(new Set(rules.map((rule) => rule.getAttribute('y1'))).size).toBe(1)
  })

  it('paints every map cell the step the Dashboard artboard paints it, rings none, and keys the steps by word', () => {
    renderView()
    const rows = [...document.querySelectorAll('table tbody tr')].filter(
      (row) => row.querySelector('th[scope="row"]')?.textContent !== 'Finanzas',
    )
    const steps = rows.map((row) =>
      [...row.querySelectorAll('td div')].map((cell) =>
        (cell as HTMLElement).style.backgroundColor.replace(/^var\(--admin-chart-div-(.*)\)$/, '$1'),
      ),
    )
    // build_admin.py tint() over the artboard's own cells: Ingeniería, Operaciones, Personas, Ventas.
    expect(steps).toEqual([
      ['pos-1', 'mid', 'pos-1', 'mid', 'pos-2', 'pos-2'],
      ['neg-2', 'neg-2', 'neg-1', 'neg-1', 'neg-1', 'neg-1'],
      ['pos-2', 'pos-1', 'pos-1', 'mid', 'pos-2', 'pos-2'],
      ['pos-1', 'neg-1', 'pos-1', 'mid', 'pos-1', 'pos-1'],
    ])
    expect([...document.querySelectorAll('table td div')].some((cell) => (cell as HTMLElement).style.outline !== '')).toBe(false)
    const legend = document.querySelector('[data-slot="climate-map-legend"]') as HTMLElement
    expect(
      [...legend.querySelectorAll('[data-legend]')].map((group) => [group.textContent, group.querySelectorAll('span').length]),
    ).toEqual([
      [en.charts.next.legendBelow, 2],
      [en.charts.next.legendOn, 1],
      [en.charts.next.legendAbove, 2],
    ])
    expect(legend.textContent).toContain(en.charts.next.legendProtected.replace('{threshold}', '5'))
  })

  it('heads the map with whole dimension names in the model’s column order, the whole name on hover', () => {
    renderView()
    const heads = [...document.querySelectorAll('table thead th')]
    expect(heads.map((head) => head.textContent)).toEqual([
      'Seguridad psicológica',
      'Carga de trabajo',
      'Confianza',
      'Reconocimiento',
      'Desarrollo',
      'Pertenencia',
    ])
    expect(heads.map((head) => head.getAttribute('title'))).toEqual(heads.map((head) => head.textContent))
  })

  it('prints each card’s move as the difference of the readings it prints: 3,33 → 3,67 is +0,4', () => {
    const dimensions = sampleModel.dimensions.map((dimension) =>
      dimension.key === 'confianza' ? { ...dimension, values: [2.96, 3.33, 3.67] } : dimension,
    )
    renderView({ ...sampleModel, dimensions })
    const card = document.querySelector('[data-slot="trend-card"][data-dimension="confianza"]') as HTMLElement
    expect(card.querySelector('[data-slot="trend-move"]')?.textContent).toBe('+0.4')
  })

  it('words the climate tile, the moves legend and the rail as the artboard does', () => {
    renderView()
    expect(document.querySelector('[data-slot="climate-move"]')?.textContent).toContain(copy.riseOrdinal['2'])
    expect(document.body.textContent).toContain(
      copy.movedLegend.replace('{target}', '3.7').replace('{count}', copy.countWord['3']),
    )
    const steps = [...document.querySelectorAll('[data-slot="cycle-step"]')]
    // The verb is on screen, not only for a screen reader.
    expect(steps[0].textContent).toContain(copy.waveClosed.replace('{date}', calendarDay(Date.parse('2026-02-12'), 'en')))
    expect(steps[0].querySelector('.sr-only')).toBeNull()
  })

  it('names the open survey as a sentence does and the live pulse by its head', () => {
    const openSurvey = sampleModel.openSurvey ? { ...sampleModel.openSurvey, name: 'Encuesta de Clima Q4 (abierta)' } : null
    renderView({ ...sampleModel, openSurvey })
    const items = document.querySelectorAll('[data-slot="attention-item"]')
    expect(items[2].textContent).toContain('Encuesta de Clima Q4 has')
    expect(items[2].textContent).not.toContain('(abierta)')
    const live = document.querySelector('[data-slot="live-microclimate"]') as HTMLElement
    expect(live.textContent).toContain(copy.liveNamed.replace('{name}', 'Pulso semanal'))
    expect(live.textContent).not.toContain('¿cómo fue la semana?')
  })

  it('sets the four tiles at the artboard’s hero size', () => {
    renderView()
    const values = [...document.querySelectorAll('[data-slot="kpi-value"]')]
    expect(values).toHaveLength(4)
    expect(values.every((value) => value.className.includes('text-kpi-hero'))).toBe(true)
  })
})
