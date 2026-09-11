import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import LeaderDashboardView from './LeaderDashboardView'
import { composeLeaderDashboard, type TrackingRead } from './compose'
import { ORGANIZATION_SAMPLE } from './sampleModel'
import type { DepartmentAdminDashboard, DashboardTeamClimate } from '../../api/dashboard'
import type { PlanAccion, TableroResponse } from '../../../tracking/api/trackingApi'
import { TranslationProvider } from '../../../../i18n'
import { CompanyContextProvider } from '../../../../company-context'
import { setToken } from '../../../../auth/token'
import { tokenFor } from '../../../../test/jwtFixture'
import en from '../../../../i18n/en.json'

/**
 * The leader's Panel de Control, drawn from a model composed the way the hook composes it,
 * so every case reads the page a real payload produces. The payloads are shaped from the
 * ones Grupo Meridiano's leader got on 11 Sep 2026 (`scripts/shot-fixtures/leaders-meridiano.json`).
 */

const copy = en.dashboard.next.leader
const DEPARTMENT = '5bfdb04e-8847-4baa-89c8-d4411654a129'
const KEYS = ['belonging', 'growth', 'psychological_safety', 'recognition', 'trust', 'workload']

function climate(scores: readonly number[], overrides: Partial<DashboardTeamClimate> = {}): DashboardTeamClimate {
  return {
    surveyId: 'q3',
    surveyTitle: 'Encuesta de Clima Q3',
    surveyEndDate: '2026-08-06T02:05:22.922+00:00',
    respondentCount: 6,
    isSuppressed: false,
    minimumGroupSize: 5,
    dimensions: KEYS.map((dimension, index) => ({ dimension, averageScore: scores[index] ?? null })),
    ...overrides,
  }
}

/** Ingeniería's Q3 — the artboard's numbers. Every one is on or above target. */
const Q3 = [4.33, 4.17, 4, 3.5, 4, 3.67]
/** Ingeniería's Q2 — Reconocimiento prints 3,2, below the target. */
const Q2 = [3.83, 3.83, 3.83, 3.17, 3.67, 3.5]

function department(overrides: Partial<DepartmentAdminDashboard> = {}): DepartmentAdminDashboard {
  return {
    departmentId: DEPARTMENT,
    departmentName: 'Ingeniería',
    companyId: 'c1',
    memberCount: 14,
    activeMemberCount: 14,
    activeSurveyCount: 1,
    completedResponseCount: 22,
    openActionPlanCount: 1,
    overdueActionPlanCount: 0,
    activeSurveys: [
      {
        id: 'q4',
        title: 'Encuesta de Clima Q4 (abierta)',
        status: 'active',
        startDate: '2026-09-03T02:03:39.148+00:00',
        endDate: '2026-10-10T02:03:39.148+00:00',
        responseCount: 3,
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
    estadoSemaforo: 'Verde',
    cicloEncuestaExternalId: null,
    fechaUltimaActualizacion: '2026-09-10',
    cumplido: false,
    involucradosExternalIds: [],
    ...overrides,
  }
}

function board(planes: PlanAccion[] = [plan()]): TrackingRead<TableroResponse> {
  return { status: 'ok', value: { nodoExternalId: DEPARTMENT, conteos: { rojo: 0, amarillo: 0, verde: planes.length }, planes } }
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
    organization: ORGANIZATION_SAMPLE,
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
   * The artboard's Seguridad psicológica: the team's 4,00 against the organisation's 3,75.
   * The raw difference, 0,25, rounds to +0,3 beside two printed readings — 4,0 and 3,8 —
   * that a reader subtracts to 0,2. The page prints the difference of what it prints.
   */
  it("prints each move against the organisation as the difference of the printed readings", () => {
    renderLeader()

    const safety = dimensionCard('psychological_safety')
    expect(within(safety).getByText('4.0', { selector: '[data-slot="team-reading"]' })).toBeTruthy()
    expect(within(safety).getByText('+0.2', { selector: '[data-slot="team-move"]' })).toBeTruthy()
    // Pertenencia 4,33 against 4,00: +0,3, as the artboard prints it.
    expect(within(dimensionCard('belonging')).getByText('+0.3', { selector: '[data-slot="team-move"]' })).toBeTruthy()
  })

  it('judges every cell by the one target rule, and offers a plan only where the reading is below it', () => {
    renderLeader({ dashboard: department({ climate: climate(Q2) }) })

    const recognition = dimensionCard('recognition')
    expect(recognition.dataset.standing).toBe('below')
    expect(within(recognition).getByText(copy.standingBelow.replace('{target}', '3.7'))).toBeTruthy()
    const create = within(recognition).getByRole('link', { name: copy.createPlanFor.replace('{dimension}', 'Recognition') })
    expect(create.getAttribute('href')).toBe('/tracking/planes')
    // 3,5 is inside the canvas's grey band — on target, as on the administrator's map.
    expect(dimensionCard('workload').dataset.standing).toBe('on')
    expect(within(dimensionCard('workload')).getByText(copy.standingOn.replace('{target}', '3.7'))).toBeTruthy()
    // Exactly one offer on the page: the one cell under the target.
    expect(screen.getAllByRole('link', { name: /^Create a plan for/ })).toHaveLength(1)
  })

  /**
   * `POST /api/planes-accion` is `Roles.PlanCreator`, and `CreateAsync` then refuses a
   * non-administrator on any nodo but their own claim's. A leader whose claim names no nodo
   * would be refused on every node, so the page never offers the button to them.
   */
  it('offers no Crear plan to a leader who leads no nodo, and still says the cell is below target', () => {
    renderLeader({ dashboard: department({ climate: climate(Q2) }), nodoId: 'unassigned-c1', tablero: { status: 'off' } })

    const recognition = dimensionCard('recognition')
    expect(within(recognition).getByText(copy.standingBelow.replace('{target}', '3.7'))).toBeTruthy()
    expect(screen.queryByRole('link', { name: /^Create a plan for/ })).toBeNull()
    expect(screen.queryByText(copy.planRule)).toBeNull()
  })

  it('offers no Crear plan where this deployment has no tracking service', () => {
    renderLeader({ dashboard: department({ climate: climate(Q2) }), trackingOn: false, tablero: { status: 'off' } })

    expect(screen.queryByRole('link', { name: /^Create a plan for/ })).toBeNull()
  })

  /**
   * The 27 Aug ruling: the floor applies to the scores. A withheld team reading keeps its
   * dimension names and loses every number — its scores, its respondent count (the server
   * zeroes it; a 0 would read "nobody answered"), the organisation's side and the move.
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
    // The respondents tile is hatched, not "0".
    expect(screen.getByRole('img', { name: copy.responsesWithheldLabel.replace('{floor}', '5') })).toBeTruthy()
    const tiles = [...document.querySelectorAll<HTMLElement>('[data-slot="nodo-tile"]')]
    expect(tiles[1]?.textContent).not.toMatch(/\b0\b/)
    // No organisation side to mark as sample, and no plan rule without a reading.
    expect(screen.queryByText(en.dashboard.next.sampleChip)).toBeNull()
  })

  it('says a survey under its own floor published nothing, with no names to hatch', () => {
    renderLeader({
      dashboard: department({
        climate: climate([], {
          surveyTitle: 'Encuesta de Clima Q4 (abierta) (Copia)',
          isSuppressed: true,
          respondentCount: 0,
          dimensions: [],
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

  /**
   * The open wave's team count is unfloored on the wire (`DashboardDepartmentSurveySummary`)
   * and both artboards hatch it under 5. Three people have answered: "3" must not appear
   * in the card at all — not in the row, not in a tooltip.
   */
  it("hatches the open survey's team count under the floor and never prints it", () => {
    renderLeader()

    const participation = card(copy.participationHeading.replace('{wave}', 'Q4'))
    const hatch = within(participation).getByRole('img', {
      name: copy.participationUnderFloorLabel.replace('{floor}', '5'),
    })
    expect(hatch.textContent).toBe(copy.participationUnderFloor.replace('{floor}', '5'))
    expect(participation.textContent).not.toMatch(/(^|\D)3(\D|$)/)
    expect(hatch.getAttribute('title')).not.toMatch(/(^|\D)3(\D|$)/)
  })

  it('prints the count once the team has reached the floor', () => {
    const dashboard = department()
    dashboard.activeSurveys[0] = { ...dashboard.activeSurveys[0]!, responseCount: 7 }
    renderLeader({ dashboard })

    const participation = card(copy.participationHeading.replace('{wave}', 'Q4'))
    expect(within(participation).getByText('7 of 14 answered')).toBeTruthy()
    expect(within(participation).queryByRole('img')).toBeNull()
  })

  it("marks the organisation's side — the one region no endpoint gives a leader — and nothing else", () => {
    renderLeader()

    const chips = screen.getAllByText(en.dashboard.next.sampleChip)
    expect(chips).toHaveLength(1)
    const legend = document.querySelector('[data-slot="team-legend"]')
    expect(legend?.contains(chips[0]!)).toBe(true)
    expect(legend?.textContent).toContain(copy.legendOrg.replace('{count}', '24'))
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

  it("offers the department's export to a leader", () => {
    renderLeader()

    expect(screen.getByRole('button', { name: en.dashboard.next.export })).toBeTruthy()
  })

  it('links nowhere a leader would be refused', () => {
    renderLeader({ dashboard: department({ climate: climate(Q2) }) })

    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'))
    for (const href of hrefs) {
      expect(href, String(href)).toMatch(/^\/tracking\/(planes|tablero)(\/|$)/)
    }
  })
})
