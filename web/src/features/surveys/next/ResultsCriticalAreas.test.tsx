import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TranslationProvider } from '../../../i18n'
import ResultsCriticalAreas from './ResultsCriticalAreas'
import { criticalByDimension, criticalByGroup, type CriticalCell } from './derive'

/**
 * The shape ESPH Clima's critical area had on 3 Nov 2026, with invented names: twelve cells,
 * one dimension critical in three groups, four in two, one in one, every score between
 * 3,5 and 3,7. The tile printed them as one line joined by `·`; gathered, the dimension
 * critical in three groups is the first thing a reader sees.
 */
const cell = (rowId: string, dimensionKey: string, score: number): CriticalCell => ({
  rowId,
  rowName: { a: 'Agua', b: 'Banca', c: 'Carga', d: 'Datos' }[rowId] ?? rowId,
  dimensionKey,
  score,
})
// Lowest first, ties by group name, as `criticalCells` hands them over.
const CELLS: CriticalCell[] = [
  cell('a', 'pay', 3.5),
  cell('b', 'balance', 3.5),
  cell('d', 'training', 3.5),
  cell('a', 'training', 3.6),
  cell('a', 'conditions', 3.6),
  cell('c', 'pay', 3.6),
  cell('b', 'efficiency', 3.6),
  cell('a', 'efficiency', 3.7),
  cell('c', 'conditions', 3.7),
  cell('b', 'growth', 3.7),
  cell('d', 'balance', 3.7),
  cell('d', 'conditions', 3.7),
]
const NAMES: Record<string, string> = {
  pay: 'Remuneración',
  balance: 'Cargas de trabajo',
  training: 'Entrenamiento',
  conditions: 'Condiciones físicas',
  efficiency: 'Eficiencia',
  growth: 'Crecimiento',
}

describe('criticalByDimension / criticalByGroup', () => {
  it('puts the dimension critical in the most groups first, then the lowest, keeping each cell', () => {
    const clusters = criticalByDimension(CELLS)
    expect(clusters.map((cluster) => [cluster.key, cluster.cells.map((c) => `${c.rowId}${c.score}`)])).toEqual([
      ['conditions', ['a3.6', 'c3.7', 'd3.7']],
      ['pay', ['a3.5', 'c3.6']],
      ['balance', ['b3.5', 'd3.7']],
      ['training', ['d3.5', 'a3.6']],
      ['efficiency', ['b3.6', 'a3.7']],
      ['growth', ['b3.7']],
    ])
    expect(clusters.flatMap((cluster) => cluster.cells)).toHaveLength(CELLS.length)
  })

  it('by group: the group with the most critical dimensions first', () => {
    expect(criticalByGroup(CELLS).map((cluster) => [cluster.key, cluster.cells.length])).toEqual([
      ['a', 4],
      ['b', 3],
      ['d', 3],
      ['c', 2],
    ])
  })

  it('is empty for no cells', () => {
    expect(criticalByDimension([])).toEqual([])
  })
})

describe('ResultsCriticalAreas', () => {
  const onOpen = vi.fn()

  beforeEach(() => {
    window.localStorage.setItem('preferredLocale', 'es')
  })
  afterEach(() => {
    cleanup()
    onOpen.mockClear()
    window.localStorage.clear()
  })

  function renderAreas(companyOnly = false, cells: CriticalCell[] = CELLS) {
    return render(
      <TranslationProvider>
        <ResultsCriticalAreas
          cells={cells}
          companyOnly={companyOnly}
          heading="Área crítica"
          rangeText="menos de 3,80"
          dimensionName={(key) => NAMES[key] ?? key}
          score={(value) => value.toLocaleString('es', { minimumFractionDigits: 1 })}
          onOpen={onOpen}
        />
      </TranslationProvider>,
    )
  }
  const rows = () =>
    [...screen.getByTestId('critical-areas').querySelectorAll('li[data-cluster]')].map((item) => item.textContent)

  it('reads by dimension first, naming in how many groups each is critical', () => {
    renderAreas()
    expect(rows()[0]).toBe('Condiciones físicasen 3 grupos3,6Agua3,7Carga3,7Datos')
    expect(rows().at(-1)).toBe('Crecimientoen 1 grupo3,7Banca')
    expect(screen.getByText('12')).toBeTruthy()
    // Every chip carries the band's glyph, never the red alone (accessibility.md).
    const chips = screen.getByTestId('critical-areas').querySelectorAll('[data-band="critical"]')
    expect(chips.length).toBe(12)
    for (const chip of chips) expect(chip.querySelector('[data-testid="critical-glyph"] svg')).not.toBeNull()
  })

  it('regroups by group on request, each group naming its dimensions', async () => {
    renderAreas()
    const toggle = screen.getByRole('group', { name: 'Agrupar las celdas críticas' })
    expect(within(toggle).getByRole('button', { name: 'Por dimensión' }).getAttribute('aria-pressed')).toBe('true')
    await userEvent.click(within(toggle).getByRole('button', { name: 'Por grupo' }))
    expect(within(toggle).getByRole('button', { name: 'Por grupo' }).getAttribute('aria-pressed')).toBe('true')
    expect(rows()[0]).toBe('Agua4 dimensiones3,5Remuneración3,6Entrenamiento3,6Condiciones físicas3,7Eficiencia')
    expect(rows()).toHaveLength(4)
  })

  it('opens the cell a chip names', async () => {
    renderAreas()
    await userEvent.click(screen.getByRole('button', { name: 'Datos · Condiciones físicas: 3,7. Abrir su pregunta' }))
    expect(onOpen).toHaveBeenCalledWith('d', 'conditions')
  })

  it('prints the company’s own cells without offering to open them, and offers no regrouping', () => {
    renderAreas(true, [
      { rowId: '', rowName: '', dimensionKey: 'pay', score: 3.5 },
      { rowId: '', rowName: '', dimensionKey: 'growth', score: 3.7 },
    ])
    expect(screen.queryByRole('group')).toBeNull()
    expect(within(screen.getByTestId('critical-areas')).queryAllByRole('button')).toHaveLength(0)
    expect(rows()).toEqual(['Remuneración3,5', 'Crecimiento3,7'])
    expect(screen.getByTestId('critical-areas').textContent).toContain('Dimensiones de toda la empresa con menos de 3,80')
  })
})
