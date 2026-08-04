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

  /**
   * The y-axis fits the data rather than being anchored at zero, and `BarChart` does
   * the opposite. The difference follows from what the mark encodes: a bar encodes
   * length from the axis, so zero is mandatory; a line encodes position and is read
   * as slope, so forcing zero in just discards the vertical space the slope needs.
   *
   * These are the assertions that make that real rather than a comment. They were
   * written against the *old* behaviour first and both fail on it.
   */
  describe('y-axis domain', () => {
    /** A realistic climate series: a genuine 20% improvement over six months. */
    const trendSeries: ChartSeries[] = [{ key: 'score', name: 'Climate score' }]
    const trend: ChartDatum[] = [
      { label: 'Jan', values: { score: 65 } },
      { label: 'Feb', values: { score: 68 } },
      { label: 'Mar', values: { score: 72 } },
      { label: 'Apr', values: { score: 70 } },
      { label: 'May', values: { score: 75 } },
      { label: 'Jun', values: { score: 78 } },
    ]

    /**
     * Tick labels are NOT inside `.recharts-cartesian-axis` -- recharts renders them
     * into a sibling `*-tick-labels` layer, so scoping by the axis group matches
     * nothing. Probed, not assumed. `.recharts-yAxis-tick-labels` is the hook that
     * distinguishes the y ticks from the x ticks.
     */
    function yTicks(container: HTMLElement): string[] {
      return [
        ...container.querySelectorAll(
          '.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value',
        ),
      ].map((tick) => tick.textContent ?? '')
    }

    /** Vertical extent of the drawn line, in px, off the real path coordinates. */
    function curveSpanPx(container: HTMLElement): number {
      const d = container.querySelector('.recharts-line-curve')?.getAttribute('d') ?? ''
      const ys = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => Number(m[2]))
      if (ys.length === 0) throw new Error('no line path drawn')
      return Math.max(...ys) - Math.min(...ys)
    }

    it('does not anchor at zero when the data sits far above it', () => {
      // Zero-anchored, recharts emits ['0','20','40','60','80'] for this series.
      const { container } = render(
        <LineChart data={trend} series={trendSeries} width={600} height={280} />,
      )
      expect(yTicks(container)).not.toContain('0')
      expect(yTicks(container)).toEqual(['64', '68', '72', '76', '80'])
    })

    /**
     * The measurement that matters, and the reason this changed at all: on the chart
     * gallery the zero-anchored version drew this climb as a 39px rise inside a 280px
     * chart -- a visually horizontal line hiding a 20% improvement. Fitted, it is
     * 195px. The threshold sits well above the old value and well below the new, so
     * it fails loudly if the domain is ever re-anchored.
     */
    it('uses the vertical space, so a real trend is legible', () => {
      const { container } = render(
        <LineChart data={trend} series={trendSeries} width={600} height={280} />,
      )
      expect(curveSpanPx(container)).toBeGreaterThan(150)
    })

    /**
     * Fitting the domain is not the same as hiding zero. Where zero is genuinely
     * inside the range it stays, because there the baseline is real information --
     * the sign change is the story.
     */
    it('keeps a zero tick when the data crosses zero', () => {
      const { container } = render(
        <LineChart
          data={[
            { label: 'Jan', values: { score: -12 } },
            { label: 'Feb', values: { score: 4 } },
          ]}
          series={trendSeries}
          width={600}
          height={280}
        />,
      )
      expect(yTicks(container)).toContain('0')
    })

    it('does not break on a flat series', () => {
      const { container } = render(
        <LineChart
          data={[
            { label: 'Jan', values: { score: 50 } },
            { label: 'Feb', values: { score: 50 } },
          ]}
          series={trendSeries}
          width={600}
          height={280}
        />,
      )
      // Nothing to slope: a flat line is the honest rendering, and it still draws.
      expect(curveSpanPx(container)).toBe(0)
      expect(container.querySelector('.recharts-line-curve')).toBeTruthy()
    })
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
