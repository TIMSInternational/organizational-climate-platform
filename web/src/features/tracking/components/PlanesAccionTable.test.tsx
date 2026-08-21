import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { TranslationProvider } from '../../../i18n'
import PlanesAccionTable from './PlanesAccionTable'
import type { PlanAccion } from '../api/trackingApi'

/**
 * The listing both `/tracking/planes` and `/tracking/mis-tareas` render, and until
 * this file existed it had no test of its own at all — so three of its columns
 * were pinned by nothing.
 *
 * Two mutations survived that gap, and both typecheck:
 *
 * 1. `<Progress value={plan.porcentajeAvance} />` — the RAW 0–1 fraction instead
 *    of the converted percentage. `value` is a `number` either way, so nothing
 *    complains, and the page renders flat, apparently-empty bars beside figures
 *    reading "15% / 40% / 80%". A reader sees a plan at 80% with an empty bar.
 * 2. The "Fecha de compromiso" column rendering `fechaCreacion`. Both fields are
 *    `DateOnly` strings on the same object; swapping them is a one-word edit and
 *    shows every plan's start date under the heading that says deadline — the one
 *    column a leader triages on.
 *
 * So these assert the column CONTENTS against values chosen to be distinguishable:
 * every date in the fixture is different, and the avance is a value whose fraction
 * and percentage cannot be confused.
 */
function plan(overrides: Partial<PlanAccion> = {}): PlanAccion {
  return {
    id: 'p1',
    planCode: 'PA-2026-00007',
    nodoExternalId: 'nodo-a',
    liderExternalId: 'lider-1',
    hallazgoExternalId: null,
    descripcionQue: 'Reunión mensual de seguimiento',
    metodologiaComo: 'Sesiones de 30 minutos',
    responsableEjecucionExternalId: 'persona-1',
    // Three DIFFERENT days, so a column reading the wrong field is visible.
    fechaCreacion: '2026-01-10',
    fechaCompromiso: '2026-09-30',
    fechaUltimaActualizacion: '2026-08-01',
    porcentajeAvance: 0.4,
    estadoSemaforo: 'Amarillo',
    cicloEncuestaExternalId: null,
    cumplido: false,
    involucradosExternalIds: ['persona-1'],
    ...overrides,
  }
}

function renderTable(plans: PlanAccion[]) {
  return render(
    <TranslationProvider initialLocale="es">
      <MemoryRouter>
        <PlanesAccionTable plans={plans} emptyMessage="Sin planes" />
      </MemoryRouter>
    </TranslationProvider>,
  )
}

function bars(): HTMLElement[] {
  return screen.getAllByRole('progressbar')
}

afterEach(cleanup)

describe('the planes-acción table', () => {
  it('renders a row per plan, with its code linking to the plan', () => {
    renderTable([plan(), plan({ id: 'p2', planCode: 'PA-2026-00008', estadoSemaforo: 'Verde' })])

    const link = screen.getByRole('link', { name: 'PA-2026-00007' })
    expect(link.getAttribute('href')).toBe('/tracking/planes/p1')
    expect(screen.getByRole('link', { name: 'PA-2026-00008' }).getAttribute('href')).toBe(
      '/tracking/planes/p2',
    )
  })

  it('says so, in the calling page\'s own words, when there is nothing to list', () => {
    renderTable([])
    expect(screen.getByText('Sin planes')).toBeTruthy()
  })

  describe('the avance column', () => {
    /**
     * The figure and the bar must be the SAME reading. `porcentajeAvance` is a
     * fraction on the wire (`RegistrarAvance` refuses anything outside [0,1]) and
     * `Progress` takes 0–100, so the bar needs the conversion the figure already
     * has.
     */
    it('draws the bar in percent, not in the raw wire fraction', () => {
      renderTable([plan({ porcentajeAvance: 0.4 })])

      expect(screen.getByText('40%')).toBeTruthy()
      // 40, never 0.4. The raw fraction is a legal `Progress` value — it renders a
      // bar 0.4% along, which reads as empty — so only the number catches it.
      expect(bars()[0].getAttribute('aria-valuenow')).toBe('40')
    })

    it('keeps the bar and the figure in step across the whole range', () => {
      renderTable([
        plan({ id: 'a', planCode: 'PA-A', porcentajeAvance: 0.15 }),
        plan({ id: 'b', planCode: 'PA-B', porcentajeAvance: 0.8 }),
        plan({ id: 'c', planCode: 'PA-C', porcentajeAvance: 1 }),
      ])

      // Rows are sorted by semáforo then compromiso; all three share both here, so
      // the order is the input order.
      const values = bars().map((bar) => bar.getAttribute('aria-valuenow'))
      expect(values).toEqual(['15', '80', '100'])
      for (const percent of ['15%', '80%', '100%']) {
        expect(screen.getByText(percent), `no figure reading ${percent}`).toBeTruthy()
      }
    })

    it('draws a full bar for a completed plan rather than a 1% one', () => {
      // `MarcarCumplido` writes the literal `1m`. Handed straight to `Progress`
      // that is a bar 1% along on a plan that is finished.
      renderTable([plan({ porcentajeAvance: 1, cumplido: true })])
      expect(bars()[0].getAttribute('aria-valuenow')).toBe('100')
    })
  })

  describe('the compromiso column', () => {
    /**
     * The heading says "Fecha de compromiso" and the cell must be exactly that
     * field. `fechaCreacion` and `fechaUltimaActualizacion` are the two other
     * `DateOnly` strings on the same object, and either would render a plausible
     * date under the deadline heading.
     */
    it('shows the commitment date, not the creation date', () => {
      renderTable([plan({ fechaCompromiso: '2026-09-30', fechaCreacion: '2026-01-10' })])

      // Matched loosely on the day and month. `calendarDay` appends the year only
      // outside the reader's CURRENT year, so an exact string here would start
      // failing on 1 January for a reason that has nothing to do with this table.
      // Rendered in UTC, so the day cannot move west either.
      expect(screen.getByText(/30 sept/)).toBeTruthy()
      expect(screen.queryByText(/10 ene/), 'the creation date is on screen').toBeNull()
    })

    it('shows the commitment date, not the last-updated date', () => {
      renderTable([plan({ fechaCompromiso: '2026-09-30', fechaUltimaActualizacion: '2026-08-01' })])

      expect(screen.getByText(/30 sept/)).toBeTruthy()
      expect(screen.queryByText(/1 ago/), 'the last-updated date is on screen').toBeNull()
    })
  })

  describe('the estado column', () => {
    it('carries a word and a glyph per row, never a colour alone', () => {
      const { container } = renderTable([plan({ estadoSemaforo: 'Amarillo' })])
      const chip = container.querySelector('[data-slot="chip"]')

      expect(chip?.textContent?.trim()).toBe('En riesgo')
      expect(chip?.querySelector('svg'), 'no glyph').toBeTruthy()
    })
  })

  describe('the order', () => {
    /**
     * Worst semáforo first, then the nearest compromiso — the service returns rows
     * in no order at all (`ListAsync` ends in a bare `ToListAsync`). Asserted here
     * as well as in `planOrder.test.ts` because the table is what a reader sees,
     * and a table that stopped calling `sortPlans` would leave that unit test
     * green.
     */
    it('puts the worst semáforo at the top', () => {
      renderTable([
        plan({ id: 'v', planCode: 'PA-VERDE', estadoSemaforo: 'Verde' }),
        plan({ id: 'r', planCode: 'PA-ROJO', estadoSemaforo: 'Rojo' }),
        plan({ id: 'a', planCode: 'PA-AMARILLO', estadoSemaforo: 'Amarillo' }),
      ])

      const codes = screen.getAllByRole('link').map((link) => link.textContent)
      expect(codes).toEqual(['PA-ROJO', 'PA-AMARILLO', 'PA-VERDE'])
    })

    it('breaks a tie on the nearest commitment date', () => {
      renderTable([
        plan({ id: 'l', planCode: 'PA-LATE', fechaCompromiso: '2026-12-01' }),
        plan({ id: 'e', planCode: 'PA-EARLY', fechaCompromiso: '2026-02-01' }),
      ])

      const codes = screen.getAllByRole('link').map((link) => link.textContent)
      expect(codes).toEqual(['PA-EARLY', 'PA-LATE'])
    })
  })
})
