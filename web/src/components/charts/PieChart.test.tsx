import { cleanup, render as rtlRender, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { TranslationProvider } from '../../i18n'
import PieChart from './PieChart'
import { foldExtraSlices, type PieSlice } from './foldSlices'
import { MAX_SERIES } from './palette'

const WIDTH = 400
const HEIGHT = 260

afterEach(cleanup)

function render(ui: ReactElement) {
  return rtlRender(<TranslationProvider initialLocale="en">{ui}</TranslationProvider>)
}

const data: PieSlice[] = [
  { key: 'agree', name: 'Agree', value: 60 },
  { key: 'neutral', name: 'Neutral', value: 25 },
  { key: 'disagree', name: 'Disagree', value: 15 },
]

describe('PieChart', () => {
  /**
   * What is NOT asserted here, and why.
   *
   * Under happy-dom recharts renders the pie as a bare `.recharts-pie` layer with
   * **no sectors and no fill attributes anywhere** — not even on legend icons,
   * because the legend payload is derived from computed sector geometry that never
   * happens. Probed, not assumed:
   *
   * ```
   * classes inside <svg>:  [..., "recharts-layer recharts-pie", ...]   // no sector
   * elements with [fill]:  []                                          // none at all
   * ```
   *
   * So wedge count and wedge colour cannot be checked here. Rather than write
   * assertions that pass whatever the component does, the behaviour that matters is
   * covered where it is observable: the slice-folding rule as a unit (below), the
   * numbers through the table view, and the mounting/empty/loading states here. The
   * visual layer belongs to the real-page check the #79 acceptance criteria require.
   */
  it('mounts a pie layer for usable data', () => {
    const { container } = render(<PieChart data={data} width={WIDTH} height={HEIGHT} />)
    expect(container.querySelector('.recharts-pie')).toBeTruthy()
  })

  describe('values that cannot be a share of a whole', () => {
    it('drops negative and zero values from the table', () => {
      // A negative share of a total is meaningless, and zero has no wedge.
      render(
        <PieChart
          data={[
            ...data,
            { key: 'bogus', name: 'Bogus', value: -10 },
            { key: 'empty', name: 'Empty', value: 0 },
          ]}
          width={WIDTH}
          height={HEIGHT}
        />,
      )
      expect(screen.getByRole('rowheader', { name: 'Agree' })).toBeTruthy()
      expect(screen.queryByRole('rowheader', { name: 'Bogus' })).toBeNull()
      expect(screen.queryByRole('rowheader', { name: 'Empty' })).toBeNull()
    })

    it('reports no data when every value is unusable', () => {
      render(
        <PieChart
          data={[
            { key: 'a', name: 'A', value: 0 },
            { key: 'b', name: 'B', value: -1 },
          ]}
          width={WIDTH}
          height={HEIGHT}
        />,
      )
      expect(screen.getByText('No data to display')).toBeTruthy()
    })
  })

  describe('empty and loading', () => {
    it('reports no data for an empty dataset', () => {
      render(<PieChart data={[]} width={WIDTH} height={HEIGHT} />)
      expect(screen.getByText('No data to display')).toBeTruthy()
    })

    it('shows loading rather than no-data while loading', () => {
      render(<PieChart data={[]} isLoading width={WIDTH} height={HEIGHT} />)
      expect(screen.getByRole('status', { name: 'Loading chart data' })).toBeTruthy()
      expect(screen.queryByText('No data to display')).toBeNull()
    })

    it('mounts no pie while loading', () => {
      const { container } = render(<PieChart data={data} isLoading width={WIDTH} height={HEIGHT} />)
      expect(container.querySelector('.recharts-pie')).toBeNull()
    })
  })

  describe('table view', () => {
    it('carries every slice and its value', () => {
      // With wedges unobservable, this is where the chart's content is actually
      // verified -- and it is also what a screen reader gets.
      render(<PieChart data={data} width={WIDTH} height={HEIGHT} />)
      expect(screen.getByRole('table')).toBeTruthy()
      expect(screen.getByRole('rowheader', { name: 'Neutral' })).toBeTruthy()
      expect(screen.getByRole('cell', { name: '25' })).toBeTruthy()
    })

    it('shows the folded Other slice', () => {
      const many = Array.from({ length: 9 }, (_, i) => ({
        key: `k${i}`,
        name: `S${i}`,
        value: 100 - i,
      }))
      render(<PieChart data={many} width={WIDTH} height={HEIGHT} />)
      // 9 slices, 5 kept, 4 folded.
      expect(screen.getByRole('rowheader', { name: 'Other (4)' })).toBeTruthy()
    })
  })

  it('shows its title', () => {
    render(<PieChart data={data} title="Response split" width={WIDTH} height={HEIGHT} />)
    expect(screen.getByText('Response split')).toBeTruthy()
  })
})

/**
 * The folding rule is tested directly rather than through a rendered chart: what
 * matters is which slices survive and what "Other" sums to, and asserting that via
 * wedge geometry would mean asserting on a layout happy-dom does not produce.
 */
describe('foldExtraSlices', () => {
  const label = (count: number) => `Other (${count})`

  function slices(count: number): PieSlice[] {
    // Descending values, so the fold boundary is unambiguous.
    return Array.from({ length: count }, (_, i) => ({
      key: `k${i}`,
      name: `S${i}`,
      value: 100 - i,
    }))
  }

  it('leaves a small set untouched', () => {
    const input = slices(4)
    expect(foldExtraSlices(input, label)).toEqual(input)
  })

  it('leaves exactly the maximum untouched', () => {
    const input = slices(MAX_SERIES)
    expect(foldExtraSlices(input, label)).toHaveLength(MAX_SERIES)
    expect(foldExtraSlices(input, label).some((s) => s.key === '__other__')).toBe(false)
  })

  /**
   * The behaviour this replaces: legacy did `colors[index % colors.length]`, so a
   * ninth slice silently reused the first colour and the reader had two
   * identically-coloured wedges with no way to distinguish them.
   */
  it('folds the tail into one Other slice instead of reusing a colour', () => {
    const result = foldExtraSlices(slices(10), label)
    expect(result).toHaveLength(MAX_SERIES)
    const other = result.at(-1)!
    expect(other.key).toBe('__other__')
    // 10 slices, 5 kept, 5 folded.
    expect(other.name).toBe('Other (5)')
  })

  it('keeps the largest slices and sums the smallest', () => {
    const result = foldExtraSlices(slices(8), label)
    const kept = result.slice(0, MAX_SERIES - 1).map((s) => s.value)
    expect(kept).toEqual([100, 99, 98, 97, 96])
    // The three smallest: 95 + 94 + 93.
    expect(result.at(-1)!.value).toBe(282)
  })

  it('never returns more slices than the palette has colours', () => {
    for (const count of [7, 12, 40]) {
      expect(foldExtraSlices(slices(count), label).length).toBeLessThanOrEqual(MAX_SERIES)
    }
  })

  it('orders slices largest first', () => {
    // Unordered input; a pie whose wedges are in arbitrary order is harder to read.
    const input: PieSlice[] = [
      { key: 'a', name: 'A', value: 5 },
      { key: 'b', name: 'B', value: 50 },
      { key: 'c', name: 'C', value: 20 },
      { key: 'd', name: 'D', value: 1 },
      { key: 'e', name: 'E', value: 30 },
      { key: 'f', name: 'F', value: 2 },
      { key: 'g', name: 'G', value: 3 },
    ]
    const result = foldExtraSlices(input, label)
    expect(result.slice(0, 5).map((s) => s.name)).toEqual(['B', 'E', 'C', 'A', 'G'])
  })
})
