import { cleanup, render as rtlRender, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { TranslationProvider } from '../../i18n'
import BarChart from './BarChart'
import { SERIES_COLORS } from './palette'
import type { ChartDatum, ChartSeries } from './types'

/**
 * Every test passes an explicit `width`. `ResponsiveContainer` measures its parent
 * with `getBoundingClientRect`, which returns 0 under happy-dom, so a responsive
 * chart renders an empty div with no `<svg>` — probed, not assumed. See
 * `ChartCanvas`.
 */
const WIDTH = 400
const HEIGHT = 240

afterEach(cleanup)

/** ChartFrame reads the empty/loading copy from the catalogues, so every render needs the provider. */
function render(ui: ReactElement) {
  return rtlRender(<TranslationProvider initialLocale="en">{ui}</TranslationProvider>)
}

const series: ChartSeries[] = [
  { key: 'engagement', name: 'Engagement' },
  { key: 'leadership', name: 'Leadership' },
]

const data: ChartDatum[] = [
  { label: 'Q1', values: { engagement: 72, leadership: 64 } },
  { label: 'Q2', values: { engagement: 78, leadership: 61 } },
]

describe('BarChart', () => {
  it('draws one rectangle per series per category', () => {
    const { container } = render(
      <BarChart data={data} series={series} width={WIDTH} height={HEIGHT} />,
    )
    expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(4)
  })

  it('labels the category axis with the data labels', () => {
    const { container } = render(
      <BarChart data={data} series={series} width={WIDTH} height={HEIGHT} />,
    )
    // Scoped to the axis on purpose: each label also appears as a row header in
    // the table view, so an unscoped getByText matches twice and throws.
    const ticks = [...container.querySelectorAll('.recharts-cartesian-axis-tick-value')].map(
      (tick) => tick.textContent,
    )
    expect(ticks).toContain('Q1')
    expect(ticks).toContain('Q2')
  })

  /**
   * Colour is asserted on the legend icons, not on the bars.
   *
   * Under happy-dom recharts renders each bar as an empty group --
   * `<g class="recharts-bar-rectangle"><g class="recharts-inactive-bar"></g></g>`
   * with no `<path>` inside -- so a bar has no observable fill. Probed rather
   * than assumed; the legend icon is the only place the series colour reaches
   * the DOM here.
   *
   * That is an acceptable proxy because the legend swatch is precisely what a
   * reader matches a bar against: if the swatch is wrong, the chart is wrong.
   * What it cannot cover is a bar rendered in a *different* colour from its own
   * swatch, which needs a real layout engine to see.
   */
  it('colours series from the palette, in order', () => {
    const { container } = render(
      <BarChart data={data} series={series} width={WIDTH} height={HEIGHT} />,
    )
    const fills = [...container.querySelectorAll('.recharts-legend-icon')].map((icon) =>
      icon.getAttribute('fill'),
    )
    expect(fills).toEqual([SERIES_COLORS[0], SERIES_COLORS[1]])
  })

  it('reads its colours from tokens rather than literals', () => {
    // A resolved hex here would mean the chart bypassed palette.ts and with it
    // the colourblind validation and dark mode.
    const { container } = render(
      <BarChart data={data} series={series} width={WIDTH} height={HEIGHT} />,
    )
    const fills = [...container.querySelectorAll('.recharts-legend-icon')].map((icon) =>
      icon.getAttribute('fill'),
    )
    expect(fills.length).toBeGreaterThan(0)
    for (const fill of fills) {
      expect(fill).toMatch(/^var\(--admin-chart-/)
    }
  })

  it('draws axis ticks in the recessive axis token, not a series colour', () => {
    const { container } = render(
      <BarChart data={data} series={series} width={WIDTH} height={HEIGHT} />,
    )
    const tick = container.querySelector('.recharts-cartesian-axis-tick-value')
    expect(tick?.getAttribute('fill')).toBe('var(--admin-chart-axis)')
  })

  it('shows a legend for two or more series', () => {
    const { container } = render(
      <BarChart data={data} series={series} width={WIDTH} height={HEIGHT} />,
    )
    expect(container.querySelector('.recharts-legend-wrapper')).toBeTruthy()
  })

  // A single series needs no legend box: the title already names it, and a
  // one-entry legend is noise.
  it('shows no legend for a single series', () => {
    const { container } = render(
      <BarChart data={data} series={[series[0]]} width={WIDTH} height={HEIGHT} />,
    )
    expect(container.querySelector('.recharts-legend-wrapper')).toBeNull()
  })

  describe('empty and loading are distinct states', () => {
    // A spinner where the answer is legitimately "nothing" reads as a hung page.
    it('reports no data for an empty dataset', () => {
      render(<BarChart data={[]} series={series} width={WIDTH} height={HEIGHT} />)
      expect(screen.getByText('No data to display')).toBeTruthy()
    })

    it('reports no data when every value is null', () => {
      render(
        <BarChart
          data={[{ label: 'Q1', values: { engagement: null, leadership: null } }]}
          series={series}
          width={WIDTH}
          height={HEIGHT}
        />,
      )
      expect(screen.getByText('No data to display')).toBeTruthy()
    })

    it('reports no data when there are no series', () => {
      render(<BarChart data={data} series={[]} width={WIDTH} height={HEIGHT} />)
      expect(screen.getByText('No data to display')).toBeTruthy()
    })

    // ...and "No data" while a request is in flight reads as a wrong answer.
    it('shows loading rather than no-data while loading', () => {
      render(<BarChart data={[]} series={series} isLoading width={WIDTH} height={HEIGHT} />)
      expect(screen.getByRole('status', { name: 'Loading chart data' })).toBeTruthy()
      expect(screen.queryByText('No data to display')).toBeNull()
    })

    it('draws nothing while loading even when data is present', () => {
      const { container } = render(
        <BarChart data={data} series={series} isLoading width={WIDTH} height={HEIGHT} />,
      )
      expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(0)
    })
  })

  // The accessibility fallback: identity never rests on colour alone.
  describe('table view', () => {
    it('offers the same numbers as a table', () => {
      render(<BarChart data={data} series={series} width={WIDTH} height={HEIGHT} />)
      const table = screen.getByRole('table')
      expect(table).toBeTruthy()
      expect(screen.getByRole('columnheader', { name: 'Engagement' })).toBeTruthy()
      expect(screen.getByRole('rowheader', { name: 'Q1' })).toBeTruthy()
      expect(screen.getByRole('cell', { name: '72' })).toBeTruthy()
    })

    it('renders no table when there is nothing to tabulate', () => {
      render(<BarChart data={[]} series={series} width={WIDTH} height={HEIGHT} />)
      expect(screen.queryByRole('table')).toBeNull()
    })
  })

  it('names the chart with its title', () => {
    render(
      <BarChart
        data={data}
        series={series}
        title="Climate by quarter"
        width={WIDTH}
        height={HEIGHT}
      />,
    )
    expect(screen.getByText('Climate by quarter')).toBeTruthy()
  })

  describe('stacked', () => {
    /**
     * The 2px surface-coloured gap between stacked segments is NOT asserted here,
     * and that is deliberate rather than an omission.
     *
     * It is passed as `stroke`/`strokeWidth` on `<Bar>`, which recharts renders
     * onto the bar's `<path>` -- and under happy-dom that path does not exist
     * (the rectangle is an empty group). Asserting it would mean asserting
     * `undefined === undefined`, which passes whether or not the component sets
     * it, i.e. a test that cannot fail.
     *
     * Rather than weaken it into something meaningless: the gap needs a real
     * layout engine to verify, and belongs to the visual check the #79
     * acceptance criteria already require ("rendered in at least one real page").
     * What is asserted below is the part that is observable and would actually
     * break -- that stacking still plots every series.
     */
    it('still plots every series when stacked', () => {
      const { container } = render(
        <BarChart data={data} series={series} stacked width={WIDTH} height={HEIGHT} />,
      )
      expect(container.querySelectorAll('.recharts-bar')).toHaveLength(2)
      expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(4)
    })
  })
})
