import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import LeaderDashboardView from './LeaderDashboardView'
import { composeLeaderDashboard, type TrackingRead } from './compose'
import type { DepartmentAdminDashboard, DashboardTeamClimate } from '../../api/dashboard'
import type { PlanAccion, TableroResponse } from '../../../tracking/api/trackingApi'
import { TranslationProvider } from '../../../../i18n'
import { CompanyContextProvider } from '../../../../company-context'
import { setToken } from '../../../../auth/token'
import { tokenFor } from '../../../../test/jwtFixture'
import en from '../../../../i18n/en.json'
import { downloadBlobFile } from '../../../../lib/downloadBlobFile'

// The file is saved through a Blob; the test reads which URL was fetched, not the disk.
vi.mock('../../../../lib/downloadBlobFile', () => ({ downloadBlobFile: vi.fn() }))

/**
 * The leader's Panel de Control, drawn from a model composed the way the hook composes it,
 * so every case reads the page a real payload produces. The payloads are Grupo Meridiano's
 * leader's of 11 Sep 2026 as this branch's server shapes them
 * (`scripts/shot-fixtures/leaders-meridiano.json`): Ingeniería's Q3 beside the whole
 * company's, the open survey's 3 withheld.
 */

const copy = en.dashboard.next.leader
const DEPARTMENT = '5bfdb04e-8847-4baa-89c8-d4411654a129'
const KEYS = ['belonging', 'growth', 'psychological_safety', 'recognition', 'trust', 'workload']

/** Ingeniería's Q3 (6 respondents). Reconocimiento prints 3,5, under the 3,7 target. */
const Q3 = [4.33, 4.17, 4, 3.5, 4, 3.67]
/** The whole company's Q3 (24 respondents) — the organisation's side of the same survey. */
const ORG_Q3 = [4, 3.79, 3.75, 3.38, 3.67, 3.33]
/** Ingeniería's Q2 — Reconocimiento 3,2 and Carga de trabajo 3,5, both under the target. */
const Q2 = [3.83, 3.83, 3.83, 3.17, 3.67, 3.5]

function organization(scores: readonly number[], respondentCount = 24) {
  return { respondentCount, dimensions: KEYS.map((dimension, index) => ({ dimension, averageScore: scores[index] ?? null })) }
}

function climate(scores: readonly number[], overrides: Partial<DashboardTeamClimate> = {}): DashboardTeamClimate {
  return {
    surveyId: 'q3',
    surveyTitle: 'Encuesta de Clima Q3',
    surveyEndDate: '2026-08-06T02:05:22.922+00:00',
    respondentCount: 6,
    isSuppressed: false,
    minimumGroupSize: 5,
    dimensions: KEYS.map((dimension, index) => ({ dimension, averageScore: scores[index] ?? null })),
    organization: organization(ORG_Q3),
    ...overrides,
  }
}

function department(overrides: Partial<DepartmentAdminDashboard> = {}): DepartmentAdminDashboard {
  return {
    departmentId: DEPARTMENT,
    departmentName: 'Ingeniería',
    companyId: 'c1',
    memberCount: 14,
    activeMemberCount: 14,
    activeSurveyCount: 1,
    completedResponseCount: 18,
    openActionPlanCount: 1,
    overdueActionPlanCount: 0,
    activeSurveys: [
      {
        id: 'q4',
        title: 'Encuesta de Clima Q4 (abierta)',
        status: 'active',
        startDate: '2026-09-03T02:03:39.148+00:00',
        endDate: '2026-10-10T02:03:39.148+00:00',
        responseCount: null,
        companyResponseCount: null,
        companyTargetAudienceCount: 24,
      },
    ],
    climate: climate(Q3),
    ...overrides,
  }
}

function plan(overrides: Partial<PlanAccion> = {}): PlanAccion {
  return {
    id: 'plan-2',
    planCode: 'PA-2026-00002',
    nodoExternalId: DEPARTMENT,
    liderExternalId: '',
    hallazgoExternalId: null,
    descripcionQue: 'Publicar el rol de fines de semana con dos semanas de antelación',
    metodologiaComo: 'Calendario compartido.',
    responsableEjecucionExternalId: 'someone-else',
    fechaCreacion: '2026-09-10',
    fechaCompromiso: '2026-09-15',
    porcentajeAvance: 0,
    estadoSemaforo: 'Amarillo',
    cicloEncuestaExternalId: null,
    fechaUltimaActualizacion: '2026-09-10',
    cumplido: false,
    involucradosExternalIds: [],
    ...overrides,
  }
}

function board(planes: PlanAccion[] = [plan()]): TrackingRead<TableroResponse> {
  return { status: 'ok', value: { nodoExternalId: DEPARTMENT, conteos: { rojo: 0, amarillo: planes.length, verde: 0 }, planes } }
}

interface Options {
  dashboard?: DepartmentAdminDashboard
  tablero?: TrackingRead<TableroResponse> | null
  trackingOn?: boolean
  /** The `nodoId` claim: the department's id for a node leader, `unassigned-c1` for none. */
  nodoId?: string
  role?: string
}

function renderLeader({
  dashboard = department(),
  tablero = board(),
  trackingOn = true,
  nodoId = DEPARTMENT,
  role = 'leader',
}: Options = {}) {
  setToken(tokenFor({ sub: 'luis', name: 'Luis Mora', role, companyId: 'c1', nodoId }))
  const model = composeLeaderDashboard({
    department: dashboard,
    tablero,
    trackingOn,
    viewer: { personaExternalId: 'luis', name: 'Luis Mora' },
    asOf: '2026-09-11T15:00:00.000Z',
    target: 3.7,
  })
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/dashboard']}>
        <CompanyContextProvider>
          <LeaderDashboardView model={model} />
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

function card(headingName: string): HTMLElement {
  const heading = screen.getByRole('heading', { level: 2, name: headingName })
  const section = heading.closest('section')
  if (!section) throw new Error(`no section around "${headingName}"`)
  return section
}

function dimensionCard(key: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-slot="team-dimension"][data-dimension="${key}"]`)
  if (!found) throw new Error(`no card for ${key}`)
  return found
}

function legend(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[data-slot="team-legend"]')
  if (!found) throw new Error('no legend')
  return found
}

describe('LeaderDashboardView', () => {
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it("draws the artboard's regions: the team's place, the comparison, the plan and the open wave", () => {
    renderLeader()

    expect(screen.getByRole('heading', { level: 1, name: en.dashboard.next.title })).toBeTruthy()
    expect(screen.getByText(`Ingeniería · ${en.users.leader}`)).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: copy.whereHeading })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: copy.compareHeading })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: copy.planHeadingOne })).toBeTruthy()
    expect(
      screen.getByRole('heading', { level: 2, name: copy.participationHeading.replace('{wave}', 'Q4') }),
    ).toBeTruthy()
    // Six dimension cards, in the server's order.
    const cards = [...document.querySelectorAll<HTMLElement>('[data-slot="team-dimension"]')]
    expect(cards.map((node) => node.dataset.dimension)).toEqual(KEYS)
  })

  /**
   * Seguridad psicológica: the team's 4,00 against the whole company's 3,75. The raw
   * difference, 0,25, rounds to +0,3 beside two printed readings — 4,0 and 3,8 — that a reader
   * subtracts to 0,2. The page prints the difference of what it prints.
   */
  it('prints each move against the organisation as the difference of the printed readings', () => {
    renderLeader()

    const safety = dimensionCard('psychological_safety')
    expect(within(safety).getByText('4.0', { selector: '[data-slot="team-reading"]' })).toBeTruthy()
    expect(within(safety).getByText('+0.2', { selector: '[data-slot="team-move"]' })).toBeTruthy()
    // Pertenencia 4,33 against 4,00: +0,3. Reconocimiento 3,50 against 3,38: 3,5 − 3,4 = +0,1.
    expect(within(dimensionCard('belonging')).getByText('+0.3', { selector: '[data-slot="team-move"]' })).toBeTruthy()
    expect(within(dimensionCard('recognition')).getByText('+0.1', { selector: '[data-slot="team-move"]' })).toBeTruthy()
  })

  it('gives no move a colour or a sign: level is level', () => {
    // Pertenencia 4,33 against a company 4,34: both print 4,3. Desarrollo 4,17 against 4,40:
    // 4,2 − 4,4 = −0,2, in red.
    renderLeader({ dashboard: department({ climate: climate(Q3, { organization: organization([4.34, 4.4, 3.75, 3.38, 3.67, 3.33]) }) }) })

    const level = within(dimensionCard('belonging')).getByText('0.0', { selector: '[data-slot="team-move"]' })
    expect(level.dataset.direction).toBe('level')
    expect(level.className).not.toMatch(/accent-(green|red)/)
    const down = within(dimensionCard('growth')).getByText('-0.2', { selector: '[data-slot="team-move"]' })
    expect(down.className).toMatch(/accent-red/)
  })

  /**
   * The ONE target rule, shared with the administrator's map (`derive.targetStanding`).
   *
   * Q3 is judged first and **no cell is under the target** — Reconocimiento 3,5 sits inside
   * the grey band, three tenths being the band's width. So the page offers no plan at all.
   * The artboard draws that card red with a Crear plan; that difference is OPEN and recorded
   * on `compose.dimensionStanding`. Do not close it by making this expect 'below'.
   *
   * Q2 is where a cell really is under: Reconocimiento 3,2. Carga de trabajo 3,5 is on target
   * by the same band, so there is exactly ONE offer, not two.
   */
  it('judges every cell by the one shared target rule, and offers a plan only where a reading is under it', () => {
    renderLeader()

    const recognition = dimensionCard('recognition')
    // 3,5 against 3,7: inside the band, so on target — as on the administrator's map.
    expect(recognition.dataset.standing).toBe('on')
    expect(recognition.className).not.toMatch(/accent-red-soft/)
    // 3,67 prints 3,7: on the target, not under it.
    expect(dimensionCard('workload').dataset.standing).toBe('on')
    expect(dimensionCard('belonging').dataset.standing).toBe('above')
    expect(screen.queryAllByRole('link', { name: /^Create a plan for/ })).toHaveLength(0)
    cleanup()

    // Q2: Reconocimiento 3,2 is genuinely under the target — one cell, one offer.
    renderLeader({ dashboard: department({ climate: climate(Q2) }) })
    const q2Recognition = dimensionCard('recognition')
    expect(q2Recognition.dataset.standing).toBe('below')
    expect(within(q2Recognition).getByText(copy.standingBelow.replace('{target}', '3.7'))).toBeTruthy()
    const create = within(q2Recognition).getByRole('link', { name: copy.createPlanFor.replace('{dimension}', 'Recognition') })
    expect(create.getAttribute('href')).toBe('/tracking/planes')
    // Carga de trabajo 3,5 is inside the band here too.
    expect(dimensionCard('workload').dataset.standing).toBe('on')
    expect(screen.getAllByRole('link', { name: /^Create a plan for/ })).toHaveLength(1)
  })

  /**
   * `POST /api/planes-accion` is `Roles.PlanCreator`, and `CreateAsync` then refuses a
   * non-administrator on any nodo but their own claim's. A leader whose claim names no nodo
   * would be refused on every node, so the page never offers the button to them.
   */
  it('offers no Crear plan to a leader who leads no nodo, and still says the cell is below target', () => {
    // Q2, because under the shared target rule Q3 has no cell below it at all — and a test
    // for "the word still shows, the button does not" needs a cell that carries the word.
    renderLeader({ dashboard: department({ climate: climate(Q2) }), nodoId: 'unassigned-c1', tablero: { status: 'off' } })

    const recognition = dimensionCard('recognition')
    expect(within(recognition).getByText(copy.standingBelow.replace('{target}', '3.7'))).toBeTruthy()
    expect(screen.queryByRole('link', { name: /^Create a plan for/ })).toBeNull()
    expect(screen.queryByText(copy.planRule)).toBeNull()
  })

  it('offers no Crear plan where this deployment has no tracking service', () => {
    renderLeader({ trackingOn: false, tablero: { status: 'off' } })

    expect(screen.queryByRole('link', { name: /^Create a plan for/ })).toBeNull()
  })

  /**
   * The 27 Aug ruling: the floor applies to the scores. A withheld team reading keeps its
   * dimension names and loses every number — its scores, its respondent count (the server
   * zeroes it; a 0 would read "nobody answered"), the organisation's side and the move. The
   * payload here still carries an organisation side, and the page drops it anyway.
   */
  it('hatches a withheld reading and prints no number for it anywhere', () => {
    renderLeader({
      dashboard: department({
        climate: climate([], {
          isSuppressed: true,
          respondentCount: 0,
          dimensions: KEYS.map((dimension) => ({ dimension, averageScore: null })),
        }),
      }),
    })

    const compare = card(copy.compareHeading)
    // No reading in the grid. The card's meta keeps "target 3.7" — the target, which is
    // everyone's and no group's — so the grid is what is searched.
    const grid = compare.querySelector<HTMLElement>('[data-slot="team-dimensions"]')!
    expect(grid.textContent).not.toMatch(/\d[.,]\d/)
    expect(document.querySelectorAll('[data-slot="team-reading"]')).toHaveLength(0)
    expect(document.querySelectorAll('[data-slot="team-move"]')).toHaveLength(0)
    expect(within(compare).getAllByRole('img')).toHaveLength(KEYS.length)
    // No organisation count beside it: the legend keys the team alone.
    expect(legend().textContent).not.toContain('24')
    expect(legend().textContent).not.toContain(copy.legendOrg.replace('{count}', '24'))
    // The respondents tile is hatched, not "0".
    expect(screen.getByRole('img', { name: copy.responsesWithheldLabel.replace('{floor}', '5') })).toBeTruthy()
    const tiles = [...document.querySelectorAll<HTMLElement>('[data-slot="nodo-tile"]')]
    expect(tiles[1]?.textContent).not.toMatch(/\b0\b/)
  })

  it('says a survey under its own floor published nothing, with no names to hatch', () => {
    renderLeader({
      dashboard: department({
        climate: climate([], {
          surveyTitle: 'Encuesta de Clima Q4 (abierta) (Copia)',
          isSuppressed: true,
          respondentCount: 0,
          dimensions: [],
          organization: null,
        }),
      }),
    })

    expect(
      screen.getByText(
        copy.surveyWithheld.replace('{survey}', 'Encuesta de Clima Q4 (abierta) (Copia)').replace('{floor}', '5'),
      ),
    ).toBeTruthy()
    expect(document.querySelectorAll('[data-slot="team-dimension"]')).toHaveLength(0)
  })

  it("draws the organisation's side from the payload, with its count in the legend, and marks nothing as sample", () => {
    renderLeader()

    for (const [index, key] of KEYS.entries()) {
      // The org. row of each card, read from `climate.organization` — the company's Q3.
      const orgRow = within(dimensionCard(key)).getByText(copy.orgWord).parentElement!
      expect(orgRow.textContent, key).toContain(String(Math.round((ORG_Q3[index] ?? 0) * 10) / 10))
    }
    expect(legend().textContent).toContain(copy.legendOrg.replace('{count}', '24'))
    expect(legend().textContent).toContain(copy.planRule)
    // Every region is live: no "Datos de muestra" anywhere on the page.
    expect(screen.queryAllByText(en.dashboard.next.sampleChip)).toHaveLength(0)
  })

  /**
   * The server sends no organisation side when fewer than the floor answered outside the
   * team: the company's reading and the team's, side by side with both counts, would give
   * theirs away. The cards draw the team alone and the legend says so, with no number.
   */
  it("draws the team alone where the server withheld the organisation's side, and says so without a number", () => {
    renderLeader({ dashboard: department({ climate: climate(Q3, { organization: null }) }) })

    expect(document.querySelectorAll('[data-slot="team-reading"]')).toHaveLength(KEYS.length)
    expect(document.querySelectorAll('[data-slot="team-move"]')).toHaveLength(0)
    for (const key of KEYS) {
      expect(within(dimensionCard(key)).queryByText(copy.orgWord), key).toBeNull()
    }
    expect(legend().textContent).toContain(copy.legendOrgWithheld.replace('{floor}', '5'))
    expect(legend().textContent).not.toMatch(/\b24\b/)
    // The plan rule still stands: the team's own cells are still judged, by the shared rule
    // — Q3's Reconocimiento 3,5 is inside the band, so 'on'. What matters here is that a
    // withheld organisation side does not stop the team's own cell being judged at all.
    expect(dimensionCard('recognition').dataset.standing).toBe('on')
  })

  /**
   * The open wave's team count arrives `null` under the floor, and both artboards hatch it.
   * Three people had answered: "3" must not appear in the card at all — not in the row, not
   * in a tooltip, and not in the whole company's line under it, whose 3 is withheld as well.
   */
  it("hatches the open survey's team count under the floor, and the whole company's count with it", () => {
    renderLeader()

    const participation = card(copy.participationHeading.replace('{wave}', 'Q4'))
    const hatch = within(participation).getByRole('img', {
      name: copy.participationUnderFloorLabel.replace('{floor}', '5'),
    })
    expect(hatch.textContent).toBe(copy.participationUnderFloor.replace('{floor}', '5'))
    expect(
      within(participation).getByText(copy.companyUnderFloor.replace('{floor}', '5').replace('{target}', '24')),
    ).toBeTruthy()
    expect(participation.textContent).not.toMatch(/(^|\D)3(\D|$)/)
    expect(hatch.getAttribute('title')).not.toMatch(/(^|\D)3(\D|$)/)
  })

  it('holds a raw count under the floor as well, from a payload built before the server floored it', () => {
    const dashboard = department()
    dashboard.activeSurveys[0] = { ...dashboard.activeSurveys[0]!, responseCount: 3, companyResponseCount: 3 }
    renderLeader({ dashboard })

    const participation = card(copy.participationHeading.replace('{wave}', 'Q4'))
    expect(within(participation).getAllByRole('img')).toHaveLength(1)
    expect(participation.textContent).not.toMatch(/(^|\D)3(\D|$)/)
  })

  it("prints the team's count and the whole company's once each reaches the floor", () => {
    const dashboard = department()
    dashboard.activeSurveys[0] = { ...dashboard.activeSurveys[0]!, responseCount: 7, companyResponseCount: 9 }
    renderLeader({ dashboard })

    const participation = card(copy.participationHeading.replace('{wave}', 'Q4'))
    expect(within(participation).getByText('7 of 14 answered')).toBeTruthy()
    expect(within(participation).getByText(copy.companyCount.replace('{count}', '9').replace('{target}', '24'))).toBeTruthy()
    expect(within(participation).queryByRole('img')).toBeNull()
  })

  it('draws no company line from a payload that carries no company figures', () => {
    const dashboard = department()
    dashboard.activeSurveys[0] = {
      id: 'q4',
      title: 'Encuesta de Clima Q4 (abierta)',
      status: 'active',
      startDate: '2026-09-03T02:03:39.148+00:00',
      endDate: '2026-10-10T02:03:39.148+00:00',
      responseCount: null,
    }
    renderLeader({ dashboard })

    expect(document.querySelector('[data-slot="team-company-line"]')).toBeNull()
  })

  it("lists the team's open plans from its own board, each opening the plan's page", () => {
    renderLeader()

    const plans = card(copy.planHeadingOne)
    expect(within(plans).getByText('1 open · 0 overdue')).toBeTruthy()
    expect(within(plans).getByRole('heading', { level: 3, name: /Publicar el rol de fines de semana/ })).toBeTruthy()
    expect(within(plans).getByText('Ingeniería · open since Sep 10')).toBeTruthy()
    expect(within(plans).getByRole('link', { name: en.dashboard.next.openPlan }).getAttribute('href')).toBe('/tracking/planes/plan-2')
    // No action-plan page: `/action-plans/{id}` is `Roles.Admin`.
    expect(within(plans).queryByRole('link', { name: /action-plans/ })).toBeNull()
  })

  it("counts the department's action plans, with nothing to open, when there is no board to read", () => {
    renderLeader({ trackingOn: false, tablero: { status: 'off' } })

    const plans = card(copy.planHeadingOne)
    expect(within(plans).getByText('1 open · 0 overdue')).toBeTruthy()
    expect(within(plans).getByText(copy.plansCountsOnly)).toBeTruthy()
    expect(within(plans).queryAllByRole('link')).toHaveLength(0)
  })

  it('says the board could not be read rather than drawing an empty one', () => {
    renderLeader({ tablero: { status: 'failed', error: 'Request failed: 503' } })

    expect(screen.getByText(copy.plansFailed.replace('{error}', 'Request failed: 503'))).toBeTruthy()
  })

  it("offers the department's export to a leader, and it fetches the department's own file", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request) => new Response(new Blob(['csv']), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      renderLeader()

      await userEvent.click(screen.getByRole('button', { name: en.dashboard.next.export }))
      await userEvent.click(await screen.findByRole('menuitem', { name: en.dashboard.exportCsv }))
      await waitFor(() => expect(vi.mocked(downloadBlobFile)).toHaveBeenCalledTimes(1))

      const urls = fetchMock.mock.calls.map(([url]) => String(url))
      expect(urls).toHaveLength(1)
      // The department's file, with no department id: the server reads the caller's own row.
      expect(urls[0]).toContain('/dashboard/department-admin/export?format=csv')
      expect(urls[0]).not.toContain('departmentId')
      // `/dashboard/company-admin/export` answers a leader 403 (`DashboardEndpoints.cs:366`).
      expect(urls[0]).not.toContain('company-admin')
    } finally {
      vi.unstubAllGlobals()
      vi.mocked(downloadBlobFile).mockClear()
    }
  })

  it('links nowhere a leader would be refused, and offers no reminder', () => {
    renderLeader({ dashboard: department({ climate: climate(Q2) }) })

    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'))
    for (const href of hrefs) {
      expect(href, String(href)).toMatch(/^\/tracking\/(planes|tablero)(\/|\?|$)/)
    }
    // `POST /surveys/{id}/invitations/reminders` is `CanAdminister`: no "Recordar al equipo".
    expect(screen.queryByRole('button', { name: /remind/i })).toBeNull()
  })
})
