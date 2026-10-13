import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { TranslationProvider } from '../../../i18n'
import { createActionPlan } from '../../action-plans/api/actionPlans'
import ResultsCellPanel from './ResultsCellPanel'
import type { ResultsCellDetail } from './derive'
import type { ResultsPlanRef } from './model'
import type { ResultBands } from '../../../components/charts'
import es from '../../../i18n/es.json'

const T = es.surveyResults.next

vi.mock('../../action-plans/api/actionPlans', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../action-plans/api/actionPlans')>()),
  createActionPlan: vi.fn(),
}))
vi.mock('../api/surveys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/surveys')>()),
  getSurvey: vi.fn().mockResolvedValue({ language: 'es' }),
}))

/** The product default: under 3,00 critical, 3,00-3,99 opportunity, 4,00 up strength. */
const BANDS: ResultBands = {
  opportunityMin: 3,
  strengthMin: 4,
  names: { critical: null, opportunity: null, strength: null },
  scale: 'mean',
}

/** One cell of the map, with no plan on the group — what the payload says before one is raised. */
function cellOf(
  rowId: string,
  rowName: string,
  dimensionKey: string,
  overrides: Partial<ResultsCellDetail> = {},
): ResultsCellDetail {
  return {
    rowId,
    rowName,
    dimensionKey,
    score: 2.6,
    band: 'critical',
    isLowest: false,
    questionCount: 1,
    oneQuestionPerDimension: true,
    questions: [],
    others: [],
    plan: null,
    cellPlan: null,
    previousScore: null,
    ...overrides,
  }
}

/** A plan the payload already carries, as `planFor`/`planForCell` return one. */
function planRef(id: string, name: string): ResultsPlanRef {
  return { id, name, dueAt: '2026-11-09', status: 'not_started' }
}

function renderPanel(detail: ResultsCellDetail) {
  return render(
    <TranslationProvider>
      <MemoryRouter>
        <ResultsCellPanel
          detail={detail}
          bands={BANDS}
          dimensionName={(key) => (key === 'recognition' ? 'Reconocimiento' : 'Carga de trabajo')}
          code="Q3"
          threshold={5}
          previousCode={null}
          capabilities={{ canCreateActionPlan: true } as never}
          baseUrl="http://api.test"
          surveyId="s1"
          id="panel"
          onClose={() => {}}
        />
      </MemoryRouter>
    </TranslationProvider>,
  )
}

/** Opens the inline form and submits it, as a reader raising a plan from this cell does. */
async function raiseAPlan(title: string) {
  vi.mocked(createActionPlan).mockResolvedValue({ id: 'plan-1', title } as never)
  const doing = screen.getByTestId('cell-doing')
  await userEvent.click(within(doing).getByRole('button', { name: T.createPlan }))
  await userEvent.click(within(doing).getByRole('button', { name: es.surveyResults.cross.create }))
  return screen.findByText(new RegExp(title.slice(0, 20)))
}

/**
 * The panel is NOT remounted when the reader opens another cell: the view swaps `detail`
 * underneath the same instance. So every piece of local state in it has to say which cell —
 * or which group — it belongs to, or it outlives the thing it describes.
 *
 * Measured on production on 2026-10-10, on the first three plans the demo tenant ever had:
 * after raising one, the panel still read "Sin plan todavía para este grupo" with a "Crear un
 * plan" button beside a "Plan creado: …" line, and that line then followed the reader to the
 * next cell they opened — a confirmation about one finding sitting under a different one.
 */
describe('ResultsCellPanel, after a plan is raised from the cell', () => {
  beforeEach(() => {
    window.localStorage.setItem('preferredLocale', 'es')
    vi.mocked(createActionPlan).mockReset()
  })
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('stops saying the group has no plan, and stops offering to raise a second one', async () => {
    renderPanel(cellOf('d-ops', 'Operaciones', 'recognition'))
    const doing = screen.getByTestId('cell-doing')
    expect(doing.textContent).toContain(T.doingNone)

    await raiseAPlan('Seguimiento para Operaciones — Reconocimiento')

    const after = screen.getByTestId('cell-doing')
    // The two sentences that contradicted each other are now one.
    expect(after.textContent).not.toContain(T.doingNone)
    expect(within(after).queryByRole('button', { name: T.createPlan })).toBeNull()
    // And the plan it just made is reachable, which is what "what is being done" means.
    expect(within(after).getByRole('link', { name: new RegExp(T.openPlan) }).getAttribute('href')).toBe(
      '/action-plans/plan-1',
    )
  })

  it('does not carry the confirmation to a cell in another group', async () => {
    const { rerender } = renderPanel(cellOf('d-ops', 'Operaciones', 'recognition'))
    await raiseAPlan('Seguimiento para Operaciones — Reconocimiento')
    expect(screen.getByTestId('cell-doing').textContent).toContain('Seguimiento para Operaciones')

    // The view swaps the cell under the same instance — another GROUP entirely.
    rerender(
      <TranslationProvider>
        <MemoryRouter>
          <ResultsCellPanel
            detail={cellOf('d-sales', 'Ventas', 'workload')}
            bands={BANDS}
            dimensionName={(key) => (key === 'recognition' ? 'Reconocimiento' : 'Carga de trabajo')}
            code="Q3"
            threshold={5}
            previousCode={null}
            capabilities={{ canCreateActionPlan: true } as never}
            baseUrl="http://api.test"
            surveyId="s1"
            id="panel"
            onClose={() => {}}
          />
        </MemoryRouter>
      </TranslationProvider>,
    )

    const doing = screen.getByTestId('cell-doing')
    expect(doing.textContent).not.toContain('Seguimiento para Operaciones')
    // Ventas has no plan, and the panel says so rather than inheriting Operaciones'.
    expect(doing.textContent).toContain(T.doingNone)
    expect(within(doing).getByRole('button', { name: T.createPlan })).toBeTruthy()
  })
})

/**
 * A department carries several plans — one per finding — and the panel's two statements
 * have different scopes. "What is being done" is about the GROUP; the open-or-create
 * control is about THIS CELL. While both read the group's plan, the second plan on a
 * department was unreachable from the map: the control offered `Abrir el plan` pointing
 * at another dimension's plan, as though this finding were handled.
 *
 * Measured on production on 2026-10-10 against the PROCOMER demo tenant: Q2's Ventanilla
 * Única · Desarrollo (2,8, critical) offered no way to raise a plan because the same
 * department already had one on Reconocimiento. All 7 of Q2's critical cells and all 3 of
 * Q3's sit in a department that already had a plan, so none of them could raise one.
 */
describe('ResultsCellPanel, when the group has a plan for another dimension', () => {
  beforeEach(() => {
    window.localStorage.setItem('preferredLocale', 'es')
    vi.mocked(createActionPlan).mockReset()
  })
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('still offers to raise one for this cell, and names the group plan as context', () => {
    renderPanel(
      cellOf('d-ops', 'Operaciones', 'workload', {
        plan: planRef('plan-rec', 'Seguimiento para Operaciones — Reconocimiento'),
        cellPlan: null,
      }),
    )
    const doing = screen.getByTestId('cell-doing')
    // The group statement is unchanged: something IS being done about Operaciones.
    expect(doing.textContent).toContain('Seguimiento para Operaciones — Reconocimiento')
    expect(doing.textContent).not.toContain(T.doingNone)
    // But Carga de trabajo is not that plan's finding, so this cell can still raise one.
    expect(within(doing).getByRole('button', { name: T.createPlan })).toBeTruthy()
    expect(within(doing).queryByRole('link', { name: new RegExp(T.openPlan) })).toBeNull()
  })

  it('opens this cell’s own plan, not the group’s', () => {
    renderPanel(
      cellOf('d-ops', 'Operaciones', 'workload', {
        plan: planRef('plan-rec', 'Seguimiento para Operaciones — Reconocimiento'),
        cellPlan: planRef('plan-workload', 'Seguimiento para Operaciones — Carga de trabajo'),
      }),
    )
    const doing = screen.getByTestId('cell-doing')
    expect(within(doing).getByRole('link', { name: new RegExp(T.openPlan) }).getAttribute('href')).toBe(
      '/action-plans/plan-workload',
    )
    expect(within(doing).queryByRole('button', { name: T.createPlan })).toBeNull()
  })

  it('does not make a sibling dimension look handled by one just raised here', async () => {
    const { rerender } = renderPanel(cellOf('d-ops', 'Operaciones', 'recognition'))
    await raiseAPlan('Seguimiento para Operaciones — Reconocimiento')
    expect(
      within(screen.getByTestId('cell-doing')).queryByRole('button', { name: T.createPlan }),
    ).toBeNull()

    // The same GROUP, a different dimension — the next finding the reader acts on.
    rerender(
      <TranslationProvider>
        <MemoryRouter>
          <ResultsCellPanel
            detail={cellOf('d-ops', 'Operaciones', 'workload')}
            bands={BANDS}
            dimensionName={(key) => (key === 'recognition' ? 'Reconocimiento' : 'Carga de trabajo')}
            code="Q3"
            threshold={5}
            previousCode={null}
            capabilities={{ canCreateActionPlan: true } as never}
            baseUrl="http://api.test"
            surveyId="s1"
            id="panel"
            onClose={() => {}}
          />
        </MemoryRouter>
      </TranslationProvider>,
    )

    const doing = screen.getByTestId('cell-doing')
    expect(within(doing).getByRole('button', { name: T.createPlan })).toBeTruthy()
    expect(within(doing).queryByRole('link', { name: new RegExp(T.openPlan) })).toBeNull()
  })
})
