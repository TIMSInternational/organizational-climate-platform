import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import SurveyResultsNextPage from './SurveyResultsNextPage'
import { TranslationProvider } from '../../../i18n'
import { CompanyContextProvider } from '../../../company-context'
import { COMPANY_CONTEXT_STORAGE_KEY } from '../../../company-context/companyContext'
import { setToken } from '../../../auth/token'
import { tokenFor } from '../../../test/jwtFixture'
import { downloadBlobFile } from '../../../lib/downloadBlobFile'
import type { ClimateTrendsResponse } from '../api/climateTrends'
import type { SurveyAnalyticsResponse } from '../api/surveyResults'

vi.mock('../../../lib/downloadBlobFile', () => ({ downloadBlobFile: vi.fn() }))

/**
 * `/surveys/:id/results` rendered from the demo tenant's REAL payloads — every GET the
 * page makes, fetched read-only from the local API on 10 Sep as Grupo Meridiano's
 * company administrator and stored unmodified as the shot fixture: Q3's analytics, the
 * survey, the action plans, the climate-trends window that names Q2 as the wave before,
 * and Q2's own analytics. The artboard was drawn from this survey; #468's drill-in was
 * only ever tested on a hand-made payload. In Spanish, as the tenant reads it.
 */
const FIXTURE = join(process.cwd(), 'scripts', 'shot-fixtures', 'survey-results-meridiano.json')
const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>

const SURVEY = '38b2002f-66da-468d-b136-ec112ba3204b'
const Q2 = '7321a9bb-9e83-465a-a31d-73bdc186d626'
const COMPANY = '16c97c29-07f8-4522-86fc-e6cc56298829'
const FIN = 'bff21fd0-422b-4f3b-8c89-d6bfbf5f19e9'
const ENG = '5bfdb04e-8847-4baa-89c8-d4411654a129'
const OPS = '0a9d7637-814c-4d4a-8407-45cfbca3f4e7'
const PER = 'aac7e1b9-5af4-4e04-872b-c11df8f1d4bd'
const VEN = '07f5a4d4-27d8-4df0-afdc-b50db1371062'
const OPS_PLAN = '4f973f47-4ab2-4a5b-9606-af5db05670b8'
const SAMPLE = 'Datos de muestra'
/**
 * Today, pinned: `calendarDayLong` appends the year when it is not the current one, so
 * "cerró el 6 de agosto" reads "…de 2026" from 1 Jan 2027 and an unpinned assertion
 * turns red by itself (measured by the refuter: now = 15 Jan 2027 failed it).
 */
const TODAY = new Date('2026-09-10T15:00:00Z')

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

/** The page's requests, answered with the tenant's payloads; the exports with a file. */
function tenant(input: RequestInfo | URL): Promise<Response> {
  const url = String(input)
  if (url.includes('/export/')) return Promise.resolve(new Response(new Blob(['file']), { status: 200 }))
  if (url.includes('/surveys/climate-trends')) return Promise.resolve(json(fixture['GET /surveys/climate-trends']))
  if (url.includes(`/surveys/${Q2}/analytics`)) return Promise.resolve(json(fixture[`GET /surveys/${Q2}/analytics`]))
  if (url.includes(`/surveys/${SURVEY}/analytics`)) return Promise.resolve(json(fixture['GET /surveys/*/analytics']))
  if (url.includes('/action-plans')) return Promise.resolve(json(fixture['GET /action-plans']))
  if (new RegExp(`/surveys/${SURVEY}(\\?|$)`).test(url)) return Promise.resolve(json(fixture['GET /surveys/*']))
  return Promise.resolve(new Response('{}', { status: 404 }))
}

/** The same, with the climate-trends request answered by `answer` instead. */
function tenantWithTrends(answer: () => Response) {
  return (input: RequestInfo | URL) =>
    String(input).includes('/surveys/climate-trends') ? Promise.resolve(answer()) : tenant(input)
}

function renderAs(claims: Record<string, unknown>) {
  setToken(tokenFor({ sub: 'u1', companyId: COMPANY, nodoId: '', ...claims }))
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={[`/surveys/${SURVEY}/results`]}>
        <CompanyContextProvider>
          <Routes>
            <Route path="/surveys/:id/results" element={<SurveyResultsNextPage />} />
            <Route path="/dashboard" element={<div data-testid="home" />} />
          </Routes>
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

/** The page, loaded, as Ana Rojas (company administrator) reads it. */
async function open() {
  renderAs({ role: 'company_admin' })
  return screen.findByTestId('cell-panel')
}

const cell = (name: RegExp) => screen.getByRole('button', { name })
const heading = (name: string) => screen.getByRole('heading', { level: 2, name })
/** The last cell of a row: "Frente a Q2". */
const vsQ2 = (testId: string) => screen.getByTestId(testId).querySelector('td:last-child')?.textContent
const meanOf = (testId: string) => screen.getByTestId(testId).querySelector('td:nth-last-child(2)')?.textContent
const requested = () => vi.mocked(fetch).mock.calls.map((call) => String(call[0]))

describe('the survey results on the tenant’s real payload', () => {
  let scrolled: ReturnType<typeof vi.fn>
  const original = HTMLElement.prototype.scrollIntoView

  beforeEach(() => {
    // Only `Date`: the timers user-event and waitFor run on stay real.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(TODAY)
    window.localStorage.clear()
    window.localStorage.setItem('preferredLocale', 'es')
    vi.stubGlobal('fetch', vi.fn().mockImplementation(tenant))
    scrolled = vi.fn()
    // The suite's DOM has no layout; the page calls this to bring the opened cell up.
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: scrolled, configurable: true, writable: true })
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.mocked(downloadBlobFile).mockClear()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: original, configurable: true, writable: true })
    window.localStorage.clear()
  })

  it('names the day the survey closed, not the day of its last response, and the wave it compares with', async () => {
    await open()
    const eyebrow = document.querySelector('[data-slot="page-eyebrow"]')
    expect(eyebrow?.textContent).toBe('Encuesta de Clima Q3 · cerró el 6 de agosto')
    expect(eyebrow?.textContent).not.toContain('última respuesta')
    expect(screen.getByRole('heading', { level: 1, name: 'Resultados de Encuesta de Clima Q3' })).toBeTruthy()
    expect(screen.getByText('Qué encontró esta encuesta, qué cambió desde Q2 y por dónde empezar a mirar.')).toBeTruthy()
  })

  it('measures the tiles against the target of 3,7, and the change against Q2’s own analytics', async () => {
    await open()
    const tiles = screen.getByRole('region', { name: 'Resumen' }).textContent ?? ''
    expect(tiles).toContain('Clima · Q3')
    // The mean of the six printed cells 3,8 · 3,3 · 3,7 · 3,4 · 3,8 · 4,0.
    expect(tiles).toContain('3,67')
    expect(tiles).not.toContain('3,65')
    expect(tiles).toContain('de 5 · meta 3,7')
    // 3,67 against the 3,35 Q2's own printed cells average; Q1 3,03 → Q2 3,36 → Q3 3,65
    // on the trends makes this the second rise.
    const delta = screen.getByTestId('climate-delta')
    expect(delta.textContent).toBe('+0,32 frente a Q2 · segunda alza seguida')
    expect(delta.className).toContain('text-accent-green-ink')
    expect(tiles).toContain('respuestas · 100 % completadas')
    expect(tiles).toContain('cerró el 6 de agosto · sin lista de invitados')
    expect(tiles).toContain('de 5 legibles')
    expect(tiles).toContain('Finanzas bajo el umbral de 5: protegido')
    expect(tiles).toContain('Bajo la meta')
    expect(screen.getByTestId('below-target').textContent).toBe('Carga de trabajo 3,3 · Reconocimiento 3,4')
    expect(tiles).not.toContain('media')
    // Every figure on the tiles is measured: no sample chip among them.
    expect(tiles).not.toContain(SAMPLE)
  })

  it('asks climate-trends which wave came before, and reads that wave’s own analytics', async () => {
    await open()
    expect(requested().some((url) => url.endsWith(`/surveys/climate-trends?companyId=${COMPANY}&lang=es`))).toBe(true)
    expect(requested().some((url) => url.endsWith(`/surveys/${Q2}/analytics?lang=es`))).toBe(true)
  })

  it('lists the artboard’s three cells, each with its reason and whether a plan covers its group', async () => {
    await open()
    expect(screen.getByText('Las tres celdas más lejos de la meta · cada una abre su pregunta')).toBeTruthy()
    const items = within(screen.getByTestId('findings')).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[0].textContent).toContain('Operaciones · Carga de trabajo')
    expect(items[0].textContent).toContain('La celda más baja del mapa · 1,3 bajo la meta')
    expect(items[0].textContent).toContain('Un plan atiende al grupo · sin avances')
    expect(items[1].textContent).toContain('Operaciones · Seguridad psicológica')
    expect(items[1].textContent).toContain('Segunda más baja · mismo grupo')
    // The group's plan is named once: the second Operaciones cell points to it and claims
    // nothing for Seguridad psicológica (`ActionPlan` carries no dimension).
    expect(items[1].textContent).toContain('El mismo plan del grupo')
    expect(items[1].textContent).not.toContain('Un plan atiende')
    expect(within(items[1]).getByTestId('finding-plan').className).not.toContain('text-accent-green-ink')
    expect(items[2].textContent).toContain('Ventas · Carga de trabajo')
    expect(items[2].textContent).toContain('Única celda roja fuera de Operaciones')
    expect(items[2].textContent).toContain('Sin plan todavía')
  })

  it('draws ONE grid: the columns, the whole company first, then every group with its change since Q2', async () => {
    await open()
    const map = screen.getByRole('region', { name: 'Clima por grupo y dimensión · Q3' })
    expect(within(map).getByText('meta 3,7 · selecciona una celda para ver su pregunta')).toBeTruthy()
    expect(within(map).getAllByRole('table')).toHaveLength(1)
    const grid = screen.getByTestId('climate-grid')
    expect(within(grid).getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Seguridad psicológica',
      'Carga de trabajo',
      'Confianza',
      'Reconocimiento',
      'Desarrollo',
      'Pertenencia',
      'Media del grupo',
      'Frente a Q2',
    ])
    const order = [...grid.querySelectorAll('tbody tr[data-testid]')].map((row) => row.getAttribute('data-testid'))
    expect(order).toEqual(['company-row', `group-row-${FIN}`, `group-row-${ENG}`, `group-row-${OPS}`, `group-row-${PER}`, `group-row-${VEN}`])
    const company = screen.getByTestId('company-row').textContent ?? ''
    for (const reading of ['3,8', '3,3', '3,7', '3,4', '4,0', '3,67']) expect(company).toContain(reading)
    // The mean beside the cells is THEIR mean: the six printed readings, averaged.
    const companyCells = [...screen.getByTestId('company-row').querySelectorAll('td')].slice(0, 6)
    const printed = companyCells.map((cell) => Number.parseFloat(cell.textContent!.slice(0, 3).replace(',', '.')))
    expect(meanOf('company-row')).toBe((printed.reduce((sum, value) => sum + value, 0) / 6).toFixed(2).replace('.', ','))
    // Each change is the difference of the printed readings: Confianza is 3,7 now and
    // 3,3 in Q2, so +0,4 (the raw +0,34 would print +0,3 beside two figures 0,4 apart);
    // the other five dimensions and the mean's are +0,3.
    expect(company.match(/\+0,3/g)).toHaveLength(6)
    expect(company.match(/\+0,4/g)).toHaveLength(1)
    expect(vsQ2('company-row')).toBe('+0,3')
    // Ingeniería's printed cells 4,0 · 3,7 · 4,0 · 3,5 · 4,2 · 4,3 average 3,95: 4,0.
    expect(meanOf(`group-row-${ENG}`)).toBe('4,0')
    // "Frente a Q2" per group, off Q2's own breakdown: every group Q2 disclosed.
    expect(vsQ2(`group-row-${ENG}`)).toBe('+0,4')
    expect(vsQ2(`group-row-${OPS}`)).toBe('+0,2')
    expect(vsQ2(`group-row-${PER}`)).toBe('+0,2')
    // Ventas is 3,8 now against Q2's 3,4: +0,4, not the raw +0,33 rounded.
    expect(vsQ2(`group-row-${VEN}`)).toBe('+0,4')
    expect(screen.getByTestId('delta-note').textContent).toBe(
      '«Frente a Q2» por grupo aparece cuando la encuesta anterior tiene ese mismo grupo por encima del umbral.',
    )
    expect(within(screen.getByTestId('grid-legend')).getByText('protegido, menos de 5 respuestas')).toBeTruthy()
  })

  it('never prints a number for the protected group: every cell hatched, mean and delta included, none a button', async () => {
    await open()
    const finanzas = screen.getByTestId(`group-row-${FIN}`)
    expect(finanzas.textContent).not.toMatch(/\d/)
    // Six dimensions, the mean and the delta: eight hatched readings.
    expect(within(finanzas).getAllByRole('img')).toHaveLength(8)
    expect(within(finanzas).queryAllByRole('button')).toHaveLength(0)
    // The mean cell carries the word where the number would be.
    expect(finanzas.textContent).toContain('Protegido')
    // And in the opened cell's "other groups", Finanzas is hatched too.
    const other = screen.getByTestId(`other-${FIN}`)
    expect(other.textContent).not.toMatch(/\d/)
    expect(within(other).getByRole('img')).toBeTruthy()
  })

  it('opens the lowest cell with its three columns: the question twice, the other groups, what is being done', async () => {
    const panel = await open()
    expect(within(panel).getByRole('heading', { level: 2, name: 'Operaciones · Carga de trabajo' })).toBeTruthy()
    expect(panel.textContent).toContain('Media 2,4 · 1,3 bajo la meta · la celda más baja del mapa')
    const question = within(panel).getByTestId('cell-question').textContent ?? ''
    expect(question).toContain('Pregunta de Carga de trabajo · Operaciones')
    expect(question).toContain('La misma pregunta · toda la empresa')
    expect(question).toContain('3,3')
    expect(question).toContain('Q3 · 24 respuestas · 17 % respondió 1 o 2')
    expect(question).toContain('1 · Muy en desacuerdo')
    expect(question).toContain('5 · Muy de acuerdo')
    expect(within(panel).getByText('Carga de trabajo en los otros grupos')).toBeTruthy()
    expect(screen.getByTestId(`other-${ENG}`).textContent).toContain('3,7')
    expect(screen.getByTestId(`other-${VEN}`).textContent).toContain('3,4')
    const doing = within(panel).getByTestId('cell-doing')
    expect(doing.textContent).toContain('Un plan ya atiende este grupo: Reducir la carga de trabajo en Operaciones')
    expect(doing.textContent).toContain('vence el 15 oct')
    expect(within(doing).getByRole('link', { name: 'Abrir el plan' }).getAttribute('href')).toBe(`/action-plans/${OPS_PLAN}`)
    expect(within(doing).getByRole('link', { name: 'Comparar con Q2' }).getAttribute('href')).toBe('/surveys/climate-trends')
    expect(doing.textContent).toContain('El texto libre de Operaciones no se muestra')
  })

  it('keeps the cell open when "Ver la pregunta" names the cell already open, and brings it into view', async () => {
    await open()
    const [first] = screen.getAllByRole('button', { name: /Ver la pregunta/ })
    // The page lands with this very cell open; #468's toggle closed it on this click.
    await userEvent.click(first)
    expect(heading('Operaciones · Carga de trabajo')).toBeTruthy()
    await userEvent.click(first)
    const opened = heading('Operaciones · Carga de trabajo')
    expect(opened).toBeTruthy()
    expect(scrolled).toHaveBeenCalled()
    // Opened from a finding, the reader lands on what it opened.
    expect(document.activeElement).toBe(opened)
  })

  it('opens another cell from the grid, by pointer or by keyboard, and marks it open', async () => {
    await open()
    const confianza = cell(/^Ingeniería, Confianza: 4,0/)
    await userEvent.click(confianza)
    expect(heading('Ingeniería · Confianza')).toBeTruthy()
    expect(confianza.getAttribute('aria-expanded')).toBe('true')
    expect(confianza.getAttribute('aria-controls')).toBe('results-next-cell-panel')
    expect(cell(/^Operaciones, Carga de trabajo: 2,4/).getAttribute('aria-expanded')).toBe('false')
    expect(scrolled).toHaveBeenCalled()

    const ventas = cell(/^Ventas, Reconocimiento: 3,6/)
    ventas.focus()
    await userEvent.keyboard('{Enter}')
    expect(heading('Ventas · Reconocimiento')).toBeTruthy()
    // The × is the one way to close it.
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByTestId('cell-panel')).toBeNull()
  })

  it('offers "Crear un plan" on a group no plan covers, and sends it to a route that exists', async () => {
    await open()
    await userEvent.click(cell(/^Ventas, Carga de trabajo: 3,4/))
    const doing = within(screen.getByTestId('cell-panel')).getByTestId('cell-doing')
    expect(doing.textContent).toContain('Sin plan todavía para este grupo.')
    expect(within(doing).getByRole('link', { name: 'Crear un plan' }).getAttribute('href')).toBe('/action-plans')
  })

  it('draws no spread for a group — no endpoint returns one — and says so, whichever cell is open', async () => {
    const panel = await open()
    // Nothing on the page is a sample: no chip anywhere.
    expect(screen.queryAllByText(SAMPLE)).toHaveLength(0)
    const withheld = 'Por grupo, la encuesta entrega solo la media de cada pregunta, no cómo se repartieron las respuestas.'
    expect(within(panel).getByTestId('group-distribution-withheld').textContent).toBe(withheld)
    // The only "respondió 1 o 2" is the company's own strip: 4 of 24 answered 2.
    const first = within(panel).getByTestId('cell-question').textContent ?? ''
    expect(first.match(/respondió 1 o 2/g)).toHaveLength(1)
    expect(first).not.toContain('Respuestas del grupo')
    // A second cell, far above the target: no spread follows it from the first.
    await userEvent.click(cell(/^Personas, Seguridad psicológica: 4,4/))
    const second = within(screen.getByTestId('cell-panel'))
    expect(second.getByRole('heading', { level: 2, name: 'Personas · Seguridad psicológica' })).toBeTruthy()
    const question = second.getByTestId('cell-question').textContent ?? ''
    expect(question).toContain('Pregunta de Seguridad psicológica · Personas')
    expect(question).toContain('4,4')
    expect(question).toContain(withheld)
    // 2 of 24 answered 2 across the company: 8 %, and no other share on the column.
    expect(question.match(/respondió 1 o 2/g)).toHaveLength(1)
    expect(question).toContain('Q3 · 24 respuestas · 8 % respondió 1 o 2')
    expect(question).not.toContain('60 %')
  })

  it('says the previous wave could not be loaded, and prints no change anywhere, when that request fails', async () => {
    vi.mocked(fetch).mockImplementation(tenantWithTrends(() => new Response('{}', { status: 500 })))
    await open()
    expect(screen.getByTestId('climate-delta').textContent).toBe('no se pudo cargar la ola anterior')
    expect(screen.getByTestId('delta-note').textContent).toBe(
      'No se pudo cargar la ola anterior, así que esta vista no muestra cambios.',
    )
    expect(within(screen.getByTestId('climate-grid')).queryByText('Frente a Q2')).toBeNull()
    expect(screen.getByTestId('company-row').textContent).not.toContain('+')
    expect(screen.getByText('Qué encontró esta encuesta, qué cambió desde la ola anterior y por dónde empezar a mirar.')).toBeTruthy()
    // The map is untouched: the lowest cell still opens, with no way to a wave it lacks.
    const doing = within(screen.getByTestId('cell-panel')).getByTestId('cell-doing')
    expect(within(doing).queryByRole('link', { name: /Comparar con/ })).toBeNull()
    expect(requested().some((url) => url.includes(`/surveys/${Q2}/`))).toBe(false)
  })

  it('says a first wave has nothing to compare with, and asks for no other survey', async () => {
    // The tenant's trends window cut down to Q3 alone: nothing closed before it.
    const onlyQ3 = structuredClone(fixture['GET /surveys/climate-trends']) as ClimateTrendsResponse
    const at = onlyQ3.surveys.findIndex((survey) => survey.surveyId === SURVEY)
    onlyQ3.surveys = [onlyQ3.surveys[at]]
    onlyQ3.groups = onlyQ3.groups.map((group) => ({ ...group, points: [group.points[at]] }))
    vi.mocked(fetch).mockImplementation(tenantWithTrends(() => json(onlyQ3)))
    await open()
    expect(screen.getByTestId('climate-delta').textContent).toBe('primera ola: no hay una anterior con la cual comparar')
    expect(screen.getByTestId('delta-note').textContent).toBe(
      'Primera ola: no hay una encuesta anterior con la cual comparar, así que esta vista no muestra cambios.',
    )
    expect(within(screen.getByTestId('climate-grid')).queryByText(/^Frente a/)).toBeNull()
    expect(requested().filter((url) => url.includes('/analytics')).every((url) => url.includes(SURVEY))).toBe(true)
  })

  it('says "sin Q2" for a group Q2 withheld — never a 0 — and still compares every other group', async () => {
    const withheld = structuredClone(fixture[`GET /surveys/${Q2}/analytics`]) as SurveyAnalyticsResponse
    const ventas = withheld.breakdowns[0].segments.find((segment) => segment.key === VEN)!
    Object.assign(ventas, { isSuppressed: true, respondentCount: 0, questions: [] })
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) =>
      String(input).includes(`/surveys/${Q2}/analytics`) ? Promise.resolve(json(withheld)) : tenant(input),
    )
    await open()
    expect(vsQ2(`group-row-${VEN}`)).toBe('sin Q2')
    expect(vsQ2(`group-row-${ENG}`)).toBe('+0,4')
  })

  it('draws the finding link as the artboard does: 12px regular text, a 4px gap, a 12px arrow', async () => {
    await open()
    const [link] = screen.getAllByRole('button', { name: /Ver la pregunta/ })
    // The Button's own medium weight, 6px gap and 16px icon drew it 109px against 102px.
    expect(link.className.split(/\s+/)).toEqual(expect.arrayContaining(['text-sm', 'font-normal', 'gap-1']))
    expect(link.querySelector('svg')?.getAttribute('class')).toContain('size-3')
  })

  it('keeps the server’s long-format CSV behind "···", through fetch + Blob', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Más exportaciones' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'CSV del servidor (formato largo)' }))
    await waitFor(() => expect(vi.mocked(downloadBlobFile)).toHaveBeenCalledTimes(1))
    expect(vi.mocked(downloadBlobFile).mock.calls[0][0]).toBe(`survey-${SURVEY}-results.csv`)
    expect(requested().some((url) => url.endsWith(`/surveys/${SURVEY}/export/csv?lang=es`))).toBe(true)
  })

  it('draws the same page for a super administrator who chose the company', async () => {
    window.localStorage.setItem(COMPANY_CONTEXT_STORAGE_KEY, COMPANY)
    renderAs({ role: 'super_admin', companyId: '' })
    expect(await screen.findByTestId('cell-panel')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Exportar informe (PDF)' })).toBeTruthy()
    expect(screen.getByTestId('climate-delta').textContent).toBe('+0,32 frente a Q2 · segunda alza seguida')
  })

  it('draws the 1–5 axis directly under the company strip it serves', async () => {
    await open()
    const company = screen.getByTestId('company-distribution')
    const axis = within(company).getByTestId('scale-axis')
    // The heading, the strip, the axis, then the strip's own sub-line: nothing between
    // the strip and its axis, and no axis left under the group's withheld sentence.
    const children = [...company.children]
    expect(axis.parentElement).toBe(company)
    expect(children.indexOf(axis)).toBe(2)
    expect(children[3].textContent).toContain('respondió 1 o 2')
    expect(axis.textContent).toContain('Muy en desacuerdo')
  })

  it('keeps "Media del grupo" and "Frente a Q2" in view when the grid scrolls, and says it scrolls', async () => {
    await open()
    const headers = within(screen.getByTestId('climate-grid')).getAllByRole('columnheader')
    const [mean, change] = headers.slice(-2) as HTMLElement[]
    expect(mean.className).toContain('sticky')
    expect(change.className).toContain('sticky')
    // The change at the right edge, the mean one 96px column and its 4px gap in from it.
    expect(change.style.right).toBe('0px')
    expect(mean.style.right).toBe('100px')
    for (const testId of ['company-row', `group-row-${FIN}`, `group-row-${OPS}`]) {
      const cells = [...screen.getByTestId(testId).children].slice(-2)
      for (const cell of cells) expect(cell.className).toContain('sticky')
    }
    // Every dimension head keeps a gap to its neighbour and breaks a long word at a syllable.
    for (const head of headers.slice(0, 6)) {
      expect(head.className.split(/\s+/)).toEqual(expect.arrayContaining(['px-1', 'hyphens-auto']))
    }
    const hint = screen.getByTestId('grid-scroll-hint')
    expect(hint.className).toContain('xl:hidden')
    expect(hint.textContent).toBe(
      'La tabla se desliza de lado hasta cada dimensión; el grupo, su media y el cambio quedan fijos.',
    )
  })

  it('measures every question against the target, in the grid’s words — never the mean of the question means', async () => {
    await open()
    const list = screen.getByTestId('question-list')
    const chips = within(list).getAllByTestId('question-standing').map((chip) => chip.textContent)
    // One scale question per dimension, read as the company row prints them: 3,8 · 3,3 ·
    // 3,7 · 3,4 · 3,8 · 4,0 against the target of 3,7.
    expect(chips).toEqual(['sobre la meta', 'bajo la meta', 'en la meta', 'bajo la meta', 'sobre la meta', 'sobre la meta'])
    expect(list.textContent).not.toMatch(/Por encima|Por debajo|En la media/)
    expect(screen.getByRole('heading', { level: 2, name: 'Resultados por pregunta' }).className).toContain('text-2xl')
  })
})
