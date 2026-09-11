import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { TranslationProvider, LOCALE_STORAGE_KEY } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../company-context'
import { tokenFor } from '../../../test/jwtFixture'
import { downloadBlobFile } from '../../../lib/downloadBlobFile'
import type { ReportListItem } from '../api/reports'
import type { ReportShareSummary } from '../api/reportShares'
import ReportsListNextPage from './ReportsListNextPage'

/**
 * `/admin/companies/:companyId/reports` — the guarantees the route keeps now that the
 * redesigned Informes took it over (the old page's own behaviour stays pinned by
 * `pages/ReportsListPage.test.tsx`, which renders it directly). Rows and links are
 * Grupo Meridiano's as the local API returned them on 10 Sep.
 */

vi.mock('../../../lib/downloadBlobFile', () => ({ downloadBlobFile: vi.fn() }))

const CID = 'c1'

function reportRow(over: Partial<ReportListItem> = {}): ReportListItem {
  return {
    id: 'r-csv',
    title: 'Datos de clima — T3 2026',
    type: 'climate_summary',
    companyId: CID,
    status: 'completed',
    format: 'csv',
    createdAt: '2026-09-10T02:06:09Z',
    isRecurring: false,
    recurrencePattern: null,
    nextGeneration: null,
    ...over,
  }
}

const csv = reportRow()
const pdf = reportRow({ id: 'r-pdf', title: 'Clima organizacional — T3 2026', format: 'pdf' })
const generating = reportRow({ id: 'r-gen', title: 'Resumen en curso', status: 'generating', format: 'pdf' })

function share(over: Partial<ReportShareSummary> = {}): ReportShareSummary {
  return {
    id: 'live',
    createdAt: '2026-09-10T02:14:45Z',
    expiresAt: '2026-10-10T02:14:45Z',
    revokedAt: null,
    accessCount: 2,
    lastAccessedAt: null,
    isActive: true,
    ...over,
  }
}

const sharesByReport: Record<string, ReportShareSummary[]> = {
  'r-csv': [share(), ...[1, 2, 3, 4, 5].map((n) => share({ id: `dead${n}`, isActive: false, revokedAt: '2026-09-10T02:55:09Z' }))],
  'r-pdf': [],
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function routeFetch(
  options: { list?: ReportListItem[]; listStatus?: number; download?: () => Response; sharesFail?: string[] } = {},
) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://test.local')
    const method = init?.method ?? 'GET'
    if (method === 'GET' && url.pathname.endsWith('/admin/reports')) {
      return Promise.resolve(options.listStatus ? json({ message: 'nope' }, options.listStatus) : json(options.list ?? [csv, pdf]))
    }
    const shares = url.pathname.match(/\/admin\/reports\/([^/]+)\/shares$/)
    if (method === 'GET' && shares && options.sharesFail?.includes(shares[1])) {
      return Promise.resolve(json({ message: 'boom' }, 500))
    }
    if (method === 'GET' && shares) return Promise.resolve(json(sharesByReport[shares[1]] ?? []))
    if (method === 'POST' && /\/download$/.test(url.pathname)) {
      return Promise.resolve(options.download ? options.download() : new Response(new Blob(['"section"\r\n']), { status: 200 }))
    }
    if (method === 'POST' && url.pathname.endsWith('/admin/reports')) return Promise.resolve(json({ ...csv, id: 'r-new' }))
    return Promise.resolve(new Response(null, { status: 404 }))
  })
}

function calls(predicate: (url: URL, method: string) => boolean): URL[] {
  return vi
    .mocked(fetch)
    .mock.calls.map((call) => ({ url: new URL(String(call[0]), 'http://test.local'), method: (call[1] as RequestInit | undefined)?.method ?? 'GET' }))
    .filter(({ url, method }) => predicate(url, method))
    .map(({ url }) => url)
}

function renderAs(claims: Record<string, unknown>, path = `/admin/companies/${CID}/reports`) {
  setToken(tokenFor({ sub: 'u1', nodoId: '', ...claims }))
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={[path]}>
        <CompanyContextProvider>
          <Routes>
            <Route path="/admin/companies/:companyId/reports" element={<ReportsListNextPage />} />
          </Routes>
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

function rowOf(id: string): HTMLElement {
  const row = document.querySelector(`tr[data-report-id="${id}"]`)
  expect(row, `row ${id}`).not.toBeNull()
  return row as HTMLElement
}

async function menuItems(id: string): Promise<string[]> {
  await userEvent.click(within(rowOf(id)).getByRole('button', { name: /Más acciones/ }))
  const items = await screen.findAllByRole('menuitem')
  const names = items.map((item) => item.textContent ?? '')
  await userEvent.keyboard('{Escape}')
  return names
}

const ADMIN = { role: 'company_admin', companyId: CID }

beforeEach(() => {
  window.localStorage.clear()
  window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
  vi.stubGlobal('fetch', vi.fn())
  vi.mocked(downloadBlobFile).mockClear()
})

afterEach(() => {
  cleanup()
  clearToken()
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

describe('ReportsListNextPage — what it reads', () => {
  it('asks for the URL company\'s reports in the reader\'s language, and the links of the completed ones only', async () => {
    routeFetch({ list: [csv, pdf, generating] })
    renderAs(ADMIN)
    await screen.findByText('Datos de clima — T3 2026')

    const list = calls((url) => url.pathname.endsWith('/admin/reports'))
    expect(list).toHaveLength(1)
    expect(list[0].searchParams.get('companyId')).toBe(CID)
    expect(list[0].searchParams.get('lang')).toBe('es')
    const read = calls((url) => url.pathname.endsWith('/shares')).map((url) => url.pathname.replace(/^.*\/admin\//, '/admin/'))
    expect(read.sort()).toEqual(['/admin/reports/r-csv/shares', '/admin/reports/r-pdf/shares'])
  })

  it('reads the three tiles off the rows and their links', async () => {
    routeFetch()
    renderAs(ADMIN)
    await screen.findByText('Datos de clima — T3 2026')
    const tiles = [...document.querySelectorAll('[data-slot="reports-tiles"] [data-slot="kpi-tile"]')].map((tile) => tile.textContent)
    expect(tiles[0]).toContain('2')
    expect(tiles[0]).toContain('de Encuesta de Clima Q3')
    expect(tiles[0]).toContain('un CSV con los datos y un PDF para leer')
    expect(tiles[1]).toContain('1')
    expect(tiles[1]).toContain('enlace')
    expect(tiles[1]).toContain('sin contraseña · vence el 10 oct · revísalo antes de reenviarlo')
    expect(tiles[2]).toContain('0')
    expect(tiles[2]).toContain('ninguno se genera solo; Programar está en el menú de cada informe')
  })

  it('prints each row\'s links as the artboard does, and "Ninguno" only when the list was read', async () => {
    routeFetch()
    renderAs(ADMIN)
    await screen.findByText('Datos de clima — T3 2026')
    expect(rowOf('r-csv').querySelector('[data-slot="report-links"]')?.textContent).toBe('1 activovence el 10 oct · 2 aperturas')
    expect(rowOf('r-pdf').querySelector('[data-slot="report-links"]')?.textContent).toBe('Ninguno')
  })

  it('labels the type as words, never as the slug the seeds write', async () => {
    routeFetch()
    renderAs(ADMIN)
    await screen.findByText('Datos de clima — T3 2026')
    expect(rowOf('r-csv').querySelector('[data-slot="report-meta"]')?.textContent).toBe(
      'Resumen de clima · creado el 10 sept · Sin programar',
    )
    expect(document.body.textContent).not.toContain('climate_summary')
  })

  it('wears the sample chip exactly where sample data sits — Contiene and the survey it names — and nowhere else', async () => {
    routeFetch()
    renderAs(ADMIN)
    await screen.findByText('Datos de clima — T3 2026')
    const chips = [...document.querySelectorAll('[data-slot="sample-chip"]')]
    expect(chips).toHaveLength(2)
    expect(chips.some((chip) => chip.closest('th') !== null)).toBe(true)
    const tiles = [...document.querySelectorAll('[data-slot="reports-tiles"] [data-slot="kpi-tile"]')]
    expect(tiles[0].querySelector('[data-slot="sample-chip"]')).not.toBeNull()
    expect(tiles[1].querySelector('[data-slot="sample-chip"]')).toBeNull()
    expect(tiles[2].querySelector('[data-slot="sample-chip"]')).toBeNull()
  })

  it('names a protected group without a number, and states the floor where a file goes out', async () => {
    routeFetch()
    renderAs(ADMIN)
    await screen.findByText('Datos de clima — T3 2026')
    const contents = rowOf('r-csv').querySelector('[data-slot="report-contents"]')!.textContent ?? ''
    expect(contents).toContain('4 de 5 grupos · Finanzas protegido')
    expect(contents).not.toMatch(/Finanzas\s*·?\s*\d/)
    expect(document.querySelector('[data-slot="floor-note"]')?.textContent).toContain('menos de 5 respuestas')
  })

  it('prints no number on the links tile when a completed report\'s links could not be read — never "0 enlaces"', async () => {
    routeFetch({ sharesFail: ['r-csv'] })
    renderAs(ADMIN)
    await screen.findByText('Datos de clima — T3 2026')
    const tile = document.querySelectorAll('[data-slot="reports-tiles"] [data-slot="kpi-tile"]')[1]
    expect(tile.textContent).toContain('no se pudieron leer los enlaces de todos los informes')
    // The unread count is absent, not 0: "0" would say nobody can open a report without a
    // login while one CSV still opens for anyone holding its link.
    expect(tile.textContent).not.toMatch(/\d/)
    expect(rowOf('r-csv').querySelector('[data-slot="report-links"]')?.textContent).toBe('Sin leer')
    // The report whose links WERE read keeps its reading.
    expect(rowOf('r-pdf').querySelector('[data-slot="report-links"]')?.textContent).toBe('Ninguno')
  })

  it('stamps no contents on a report that is not completed — there is no document to contain anything', async () => {
    const failed = reportRow({ id: 'r-fail', title: 'Informe fallido', status: 'failed', format: 'csv' })
    routeFetch({ list: [csv, generating, failed] })
    const { unmount } = renderAs(ADMIN)
    await screen.findByText('Resumen en curso')
    expect(rowOf('r-csv').querySelector('[data-slot="report-contents"]')).not.toBeNull()
    for (const id of ['r-gen', 'r-fail']) {
      expect(rowOf(id).querySelector('[data-slot="report-contents"]'), id).toBeNull()
      expect(rowOf(id).textContent, id).not.toContain('respuestas')
    }
    unmount()

    // With no completed report, nothing is sample-fed, so no chip is worn anywhere.
    routeFetch({ list: [generating] })
    renderAs(ADMIN)
    await screen.findByText('Resumen en curso')
    expect(document.querySelector('[data-slot="sample-chip"]')).toBeNull()
  })

  it('says so with a retry when the list cannot be read', async () => {
    routeFetch({ listStatus: 500 })
    renderAs(ADMIN)
    expect(await screen.findByRole('button', { name: 'Reintentar' })).toBeTruthy()
  })

  it('says there are no reports rather than drawing an empty table', async () => {
    routeFetch({ list: [] })
    renderAs(ADMIN)
    expect(await screen.findByText('Aún no hay informes')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})

describe('ReportsListNextPage — one action per row', () => {
  it('draws Descargar on the row and keeps Compartir and Programar in its ··· menu', async () => {
    routeFetch()
    renderAs(ADMIN)
    await screen.findByText('Datos de clima — T3 2026')
    const buttons = within(rowOf('r-csv'))
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent)
    expect(buttons).toEqual(['Descargar', 'Más acciones para Datos de clima — T3 2026'])
    expect(await menuItems('r-csv')).toEqual(['Compartir', 'Programar'])
  })

  it('draws Nuevo informe, Descargar and ··· as the canvas\'s 34px buttons', async () => {
    routeFetch()
    renderAs(ADMIN)
    await screen.findByText('Datos de clima — T3 2026')
    expect(screen.getByRole('button', { name: 'Nuevo informe' }).className).toContain('h-control-canvas')
    const row = within(rowOf('r-csv'))
    const download = row.getByRole('button', { name: 'Descargar' }).className
    expect(download).toContain('h-control-canvas')
    expect(download).not.toContain('h-control-lg')
    const more = row.getByRole('button', { name: 'Más acciones para Datos de clima — T3 2026' }).className
    expect(more).toContain('size-control-canvas')
    // 28 wide from xl, as the artboard's 150px actions column draws it.
    expect(more).toContain('xl:w-7')
  })

  it('offers Compartir only for a completed report, and Descargar only once there is a file', async () => {
    routeFetch({ list: [csv, generating] })
    renderAs(ADMIN)
    await screen.findByText('Resumen en curso')
    expect((within(rowOf('r-gen')).getByRole('button', { name: 'Descargar' }) as HTMLButtonElement).disabled).toBe(true)
    expect(await menuItems('r-gen')).toEqual(['Programar'])
  })

  it('opens the share dialog from the menu, and addressed as ?share=<id>', async () => {
    routeFetch()
    renderAs(ADMIN)
    await screen.findByText('Datos de clima — T3 2026')
    await userEvent.click(within(rowOf('r-csv')).getByRole('button', { name: /Más acciones/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Compartir' }))
    expect(await screen.findByRole('heading', { name: 'Compartir con un enlace público' })).toBeTruthy()
  })

  it('opens the share dialog from the address, and never for a report that is not completed', async () => {
    routeFetch({ list: [csv, generating] })
    const { unmount } = renderAs(ADMIN, `/admin/companies/${CID}/reports?share=r-csv`)
    expect(await screen.findByRole('heading', { name: 'Compartir con un enlace público' })).toBeTruthy()
    unmount()

    renderAs(ADMIN, `/admin/companies/${CID}/reports?share=r-gen`)
    await screen.findByText('Resumen en curso')
    expect(screen.queryByRole('heading', { name: 'Compartir con un enlace público' })).toBeNull()
  })

  it('saves the file named for its format, asking for it in the reader\'s language', async () => {
    routeFetch()
    renderAs(ADMIN)
    await screen.findByText('Datos de clima — T3 2026')
    await userEvent.click(within(rowOf('r-csv')).getByRole('button', { name: 'Descargar' }))

    await waitFor(() => expect(downloadBlobFile).toHaveBeenCalledTimes(1))
    expect(vi.mocked(downloadBlobFile).mock.calls[0][0]).toBe('report-r-csv.csv')
    const post = calls((url, method) => method === 'POST' && url.pathname.endsWith('/download'))
    expect(post[0].pathname.endsWith('/admin/reports/r-csv/download')).toBe(true)
    expect(post[0].searchParams.get('lang')).toBe('es')
    expect((await screen.findByText(/Se descargó Datos de clima — T3 2026 como report-r-csv.csv/)).getAttribute('role')).toBe('status')
  })

  it('shows the refusal and saves nothing when the download fails', async () => {
    routeFetch({ download: () => json({ message: 'El informe aún no está listo' }, 400) })
    renderAs(ADMIN)
    await screen.findByText('Datos de clima — T3 2026')
    await userEvent.click(within(rowOf('r-csv')).getByRole('button', { name: 'Descargar' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(downloadBlobFile).not.toHaveBeenCalled()
  })

  it('creates a report from the dialog, scoped to the company in the URL', async () => {
    routeFetch()
    renderAs(ADMIN)
    await screen.findByText('Datos de clima — T3 2026')
    await userEvent.click(screen.getByRole('button', { name: 'Nuevo informe' }))
    await userEvent.type(await screen.findByLabelText('Título'), 'Informe de prueba')
    await userEvent.click(screen.getByRole('button', { name: 'Crear informe' }))
    await waitFor(() => {
      const post = vi.mocked(fetch).mock.calls.find(
        (call) => (call[1] as RequestInit | undefined)?.method === 'POST' && String(call[0]).endsWith('/admin/reports'),
      )
      expect(post).toBeTruthy()
      expect(JSON.parse(String((post![1] as RequestInit).body))).toMatchObject({ companyId: CID, title: 'Informe de prueba' })
    })
  })
})

describe('ReportsListNextPage — one test per role that matters', () => {
  it('company_admin of this company: the list, the links, Nuevo informe, Compartir', async () => {
    routeFetch()
    renderAs(ADMIN)
    await screen.findByText('Datos de clima — T3 2026')
    expect(screen.getByRole('button', { name: 'Nuevo informe' })).toBeTruthy()
    expect(calls((url) => url.pathname.endsWith('/shares')).length).toBe(2)
  })

  it('company_admin of another company: no request the server would refuse, and a sentence', async () => {
    routeFetch()
    renderAs({ role: 'company_admin', companyId: 'c2' })
    expect(await screen.findByText('Los informes de esta empresa son de su administración')).toBeTruthy()
    expect(calls((url) => url.pathname.includes('/admin/reports'))).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Nuevo informe' })).toBeNull()
  })

  it('super_admin with no company chosen: the reports of the company in the URL, and no links it may not list', async () => {
    routeFetch()
    renderAs({ role: 'super_admin', companyId: '' })
    await screen.findByText('Datos de clima — T3 2026')
    expect(screen.getByRole('button', { name: 'Nuevo informe' })).toBeTruthy()
    // `canShareReports` is false until a company is chosen, so the links are neither read
    // nor offered — and the tile says why instead of printing "0".
    expect(calls((url) => url.pathname.endsWith('/shares'))).toHaveLength(0)
    expect(screen.getByText('tu cuenta no puede ver los enlaces de esta empresa')).toBeTruthy()
    expect(await menuItems('r-csv')).toEqual(['Programar'])
  })

  it('super_admin with no company chosen: ?share=<id> opens no dialog, since the links are not theirs to list', async () => {
    routeFetch()
    renderAs({ role: 'super_admin', companyId: '' }, `/admin/companies/${CID}/reports?share=r-csv`)
    await screen.findByText('Datos de clima — T3 2026')
    // The report is completed and in the list, so only `mayShare` stands between the
    // address and a dialog that would read and mint links `canShareReports` refuses.
    expect(screen.queryByRole('heading', { name: 'Compartir con un enlace público' })).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(calls((url) => url.pathname.endsWith('/shares'))).toHaveLength(0)
  })

  it('super_admin with the company chosen: the links too', async () => {
    window.localStorage.setItem(COMPANY_CONTEXT_STORAGE_KEY, CID)
    routeFetch()
    renderAs({ role: 'super_admin', companyId: '' })
    await screen.findByText('Datos de clima — T3 2026')
    await waitFor(() => expect(calls((url) => url.pathname.endsWith('/shares')).length).toBe(2))
    expect(await menuItems('r-csv')).toEqual(['Compartir', 'Programar'])
  })

  it.each(['leader', 'supervisor', 'employee'])('%s: no request, and a sentence saying whose page it is', async (role) => {
    routeFetch()
    renderAs({ role, companyId: CID })
    expect(await screen.findByText('Los informes de esta empresa son de su administración')).toBeTruthy()
    expect(calls((url) => url.pathname.includes('/admin/reports'))).toHaveLength(0)
  })
})
