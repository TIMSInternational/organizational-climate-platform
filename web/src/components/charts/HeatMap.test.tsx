import { cleanup, render as rtlRender, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { TranslationProvider } from '../../i18n'
import HeatMap, { type HeatMapCell } from './HeatMap'
import { SEQUENTIAL_COLORS } from './palette'

afterEach(cleanup)

function render(ui: ReactElement) {
  return rtlRender(<TranslationProvider initialLocale="en">{ui}</TranslationProvider>)
}

const data: HeatMapCell[] = [
  { x: 'Q1', y: 'Sales', value: 60 },
  { x: 'Q2', y: 'Sales', value: 80 },
  { x: 'Q1', y: 'Support', value: 40 },
  { x: 'Q2', y: 'Support', value: 100 },
]

/** Reads a data cell by its row and column headers. */
function cell(y: string, x: string): HTMLElement {
  return screen.getByLabelText(`${y}, ${x}: ${valueOf(y, x)}`)
}
function valueOf(y: string, x: string): number {
  return data.find((d) => d.x === x && d.y === y)!.value
}

describe('HeatMap', () => {
  /**
   * Table semantics rather than a grid of divs, which is what both legacy versions
   * used. A heatmap is a table of numbers, so this gives headers, navigation and
   * announced cell context for free — and makes colour redundant encoding rather
   * than the only encoding.
   */
  describe('table semantics', () => {
    it('renders a real table', () => {
      render(<HeatMap data={data} />)
      expect(screen.getByRole('table')).toBeTruthy()
    })

    /**
     * index.css sets `table { width: 100% }` for the app's data tables. Applied to
     * the heatmap it stretched the row-label column across the whole content width
     * and stranded the coloured cells against the right edge, so a reader could not
     * follow a row across to its values. happy-dom does no layout, so this asserts
     * the opt-out class rather than a measured width -- the rendered check lives on
     * the chart gallery.
     */
    it('opts out of the global full-width table rule', () => {
      render(<HeatMap data={data} />)
      expect(screen.getByRole('table').className).toContain('w-auto')
    })

    it('heads each column with its x label', () => {
      render(<HeatMap data={data} />)
      expect(screen.getByRole('columnheader', { name: 'Q1' })).toBeTruthy()
      expect(screen.getByRole('columnheader', { name: 'Q2' })).toBeTruthy()
    })

    it('heads each row with its y label', () => {
      render(<HeatMap data={data} />)
      expect(screen.getByRole('rowheader', { name: 'Sales' })).toBeTruthy()
      expect(screen.getByRole('rowheader', { name: 'Support' })).toBeTruthy()
    })

    it('names every cell with its position and value', () => {
      // The number reaches assistive tech and find-in-page even when it is not
      // painted into the cell.
      render(<HeatMap data={data} />)
      expect(cell('Sales', 'Q1')).toBeTruthy()
      expect(cell('Support', 'Q2')).toBeTruthy()
    })
  })

  describe('axis order', () => {
    it('preserves the caller’s order rather than sorting', () => {
      // Sorting would silently reorder a deliberately-ordered axis such as months.
      render(
        <HeatMap
          data={[
            { x: 'Mar', y: 'A', value: 1 },
            { x: 'Jan', y: 'A', value: 2 },
            { x: 'Feb', y: 'A', value: 3 },
          ]}
        />,
      )
      const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)
      expect(headers).toEqual(['Mar', 'Jan', 'Feb'])
    })
  })

  describe('colour', () => {
    it('puts the maximum at the top of the ramp and the minimum at the bottom', () => {
      render(<HeatMap data={data} />)
      expect(cell('Support', 'Q2').style.backgroundColor).toBe(
        SEQUENTIAL_COLORS[SEQUENTIAL_COLORS.length - 1],
      )
      expect(cell('Support', 'Q1').style.backgroundColor).toBe(SEQUENTIAL_COLORS[0])
    })

    it('reads colours from tokens rather than literals', () => {
      render(<HeatMap data={data} />)
      expect(cell('Sales', 'Q1').style.backgroundColor).toMatch(/^var\(--admin-chart-seq-/)
    })

    it('does not divide by zero when every value is identical', () => {
      // A flat dataset has no range; normalising against it would put every cell
      // at NaN and blank the whole grid.
      render(
        <HeatMap
          data={[
            { x: 'Q1', y: 'A', value: 50 },
            { x: 'Q2', y: 'A', value: 50 },
          ]}
        />,
      )
      const cells = screen.getAllByLabelText(/^A, Q\d: 50$/)
      expect(cells).toHaveLength(2)
      for (const c of cells) {
        expect(c.style.backgroundColor).toMatch(/^var\(--admin-chart-seq-/)
      }
    })
  })

  describe('gaps', () => {
    it('leaves an absent pair uncoloured rather than treating it as zero', () => {
      // An absent department/quarter pair is not a score of zero, and colouring it
      // as one would invent data.
      const { container } = render(
        <HeatMap
          data={[
            { x: 'Q1', y: 'Sales', value: 60 },
            { x: 'Q2', y: 'Support', value: 80 },
          ]}
        />,
      )
      const coloured = [...container.querySelectorAll('td')].filter(
        (td) => td.style.backgroundColor !== '',
      )
      // 2x2 grid from two cells, so two of the four are gaps.
      expect(coloured).toHaveLength(2)
    })

    it('ignores non-finite values', () => {
      render(<HeatMap data={[...data, { x: 'Q3', y: 'Sales', value: Number.NaN }]} />)
      expect(screen.queryByRole('columnheader', { name: 'Q3' })).toBeNull()
    })
  })

  describe('the scale legend', () => {
    it('labels the endpoints so the spread is readable', () => {
      // Without endpoints the ramp says "more" and "less" but not "more than what"
      // -- a 2-point spread and a 40-point one look identical.
      render(<HeatMap data={data} />)
      expect(screen.getByText('40')).toBeTruthy()
      expect(screen.getByText('100')).toBeTruthy()
    })
  })

  describe('values in cells', () => {
    it('hides them by default', () => {
      // The ramp inverts between light and dark mode, so one ink colour cannot be
      // legible against both ends. Off until the token layer has a paired ink.
      render(<HeatMap data={data} />)
      expect(cell('Sales', 'Q1').textContent).toBe('')
    })

    it('shows them when asked', () => {
      render(<HeatMap data={data} showValues />)
      expect(cell('Sales', 'Q1').textContent).toBe('60')
    })
  })

  describe('empty and loading', () => {
    it('reports no data for an empty dataset', () => {
      render(<HeatMap data={[]} />)
      expect(screen.getByText('No data to display')).toBeTruthy()
    })

    it('shows loading rather than no-data while loading', () => {
      render(<HeatMap data={[]} isLoading />)
      expect(screen.getByRole('status', { name: 'Loading chart data' })).toBeTruthy()
      expect(screen.queryByText('No data to display')).toBeNull()
    })

    it('draws no table while loading', () => {
      render(<HeatMap data={data} isLoading />)
      expect(screen.queryByRole('table')).toBeNull()
    })
  })

  it('shows its title', () => {
    render(<HeatMap data={data} title="Score by department" />)
    expect(screen.getByText('Score by department')).toBeTruthy()
  })
})
