import { cleanup, render as rtlRender, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { TranslationProvider } from '../../i18n'
import LineChart from './LineChart'
import { SERIES_COLORS } from './palette'
import type { ChartDatum, ChartSeries } from './types'

/** Explicit width throughout — ResponsiveContainer renders no `<svg>` under happy-dom. */
const WIDTH = 400
const HEIGHT = 240

afterEach(cleanup)

function render(ui: ReactElement) {
  return rtlRender(<TranslationProvider initialLocale="en">{ui}</TranslationProvider>)
}

const series: ChartSeries[] = [
  { key: 'engagement', name: 'Engagement' },
  { key: 'leadership', name: 'Leadership' },
]

const data: ChartDatum[] = [
  { label: 'Jan', values: { engagement: 70, leadership: 60 } },
  { label: 'Feb', values: { engagement: 74, leadership: 63 } },
  { label: 'Mar', values: { engagement: 71, leadership: 65 } },
]

describe('LineChart', () => {
  it('draws one line per series', () => {
    const { container } = render(
      <LineChart data={data} series={series} width={WIDTH} height={HEIGHT} />,
    )
    expect(container.querySelectorAll('.recharts-line')).toHaveLength(2)
  })

  it('draws 2px strokes', () => {
    // Thin marks: a heavy line overstates precision and crowds the plot.
    const { container } = render(
      <LineChart data={data} series={series} width={WIDTH} height={HEIGHT} />,
    )
    const curve = container.querySelector('.recharts-line-curve')
    expect(curve?.getAttribute('stroke-width')).toBe('2')
  })

  it('strokes each line with its palette colour', () => {
    const { container } = render(
      <LineChart data={data} series={series} width={WIDTH} height={HEIGHT} />,
    )
    const strokes = [...container.querySelectorAll('.recharts-line-curve')].map((curve) =>
      curve.getAttribute('stroke'),
    )
    expect(strokes).toEqual([SERIES_COLORS[0], SERIES_COLORS[1]])
  })

  it('reads its colours from tokens rather than literals', () => {
    const { container } = render(
      <LineChart data={data} series={series} width={WIDTH} height={HEIGHT} />,
    )
    const strokes = [...container.querySelectorAll('.recharts-line-curve')].map((curve) =>
      curve.getAttribute('stroke'),
    )
    expect(strokes.length).toBeGreaterThan(0)
    for (const stroke of strokes) {
      expect(stroke).toMatch(/^var\(--admin-chart-/)
    }
  })

  it('labels the time axis', () => {
    const { container } = render(
      <LineChart data={data} series={series} width={WIDTH} height={HEIGHT} />,
    )
    const ticks = [...container.querySelectorAll('.recharts-cartesian-axis-tick-value')].map(
      (tick) => tick.textContent,
    )
    expect(ticks).toContain('Jan')
    expect(ticks).toContain('Mar')
  })

  it('shows a legend for two or more series and none for one', () => {
    const { container: two } = render(
      <LineChart data={data} series={series} width={WIDTH} height={HEIGHT} />,
    )
    expect(two.querySelector('.recharts-legend-wrapper')).toBeTruthy()

    cleanup()

    const { container: one } = render(
      <LineChart data={data} series={[series[0]]} width={WIDTH} height={HEIGHT} />,
    )
    expect(one.querySelector('.recharts-legend-wrapper')).toBeNull()
  })

  /**
   * A gap must stay a gap. Connecting across a null invents a trend the data does
   * not contain — and a survey period with no responses is both common and
   * meaningful here, so the invented line would be read as a real movement.
   */
  it('does not connect across a missing point', () => {
    const withGap: ChartDatum[] = [
      { label: 'Jan', values: { engagement: 70 } },
      { label: 'Feb', values: { engagement: null } },
      { label: 'Mar', values: { engagement: 71 } },
    ]
    const { container } = render(
      <LineChart data={withGap} series={[series[0]]} width={WIDTH} height={HEIGHT} />,
    )
    // With connectNulls={false} recharts emits a broken path: the segment after
    // the gap starts a new subpath with its own move command.
    const d = container.querySelector('.recharts-line-curve')?.getAttribute('d') ?? ''
    expect(d.match(/M/g)?.length ?? 0).toBeGreaterThan(1)
  })

  it('still plots when a series is entirely missing for one row', () => {
    const partial: ChartDatum[] = [
      { label: 'Jan', values: { engagement: 70, leadership: 60 } },
      { label: 'Feb', values: { engagement: 74 } },
    ]
    const { container } = render(
      <LineChart data={partial} series={series} width={WIDTH} height={HEIGHT} />,
    )
    expect(container.querySelectorAll('.recharts-line')).toHaveLength(2)
  })

  describe('empty and loading', () => {
    it('reports no data for an empty dataset', () => {
      render(<LineChart data={[]} series={series} width={WIDTH} height={HEIGHT} />)
      expect(screen.getByText('No data to display')).toBeTruthy()
    })

    it('reports no data when every value is null', () => {
      render(
        <LineChart
          data={[{ label: 'Jan', values: { engagement: null, leadership: null } }]}
          series={series}
          width={WIDTH}
          height={HEIGHT}
        />,
      )
      expect(screen.getByText('No data to display')).toBeTruthy()
    })

    it('shows loading rather than no-data while loading', () => {
      render(<LineChart data={[]} series={series} isLoading width={WIDTH} height={HEIGHT} />)
      expect(screen.getByRole('status', { name: 'Loading chart data' })).toBeTruthy()
      expect(screen.queryByText('No data to display')).toBeNull()
    })
  })

  it('offers the same numbers as a table', () => {
    render(<LineChart data={data} series={series} width={WIDTH} height={HEIGHT} />)
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getByRole('rowheader', { name: 'Jan' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: '70' })).toBeTruthy()
  })

  it('leaves a gap blank in the table rather than printing zero', () => {
    // Rendering a missing value as 0 would be a different claim about the data.
    render(
      <LineChart
        data={[{ label: 'Jan', values: { engagement: null, leadership: 60 } }]}
        series={series}
        width={WIDTH}
        height={HEIGHT}
      />,
    )
    const row = screen.getByRole('row', { name: /Jan/ })
    const cells = [...row.querySelectorAll('td')].map((cell) => cell.textContent)
    expect(cells).toEqual(['', '60'])
  })
})
