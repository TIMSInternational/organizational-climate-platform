import { describe, it, expect, afterEach } from 'vitest'
import { DEFAULT_RESULT_BANDS } from '../../../components/charts'
import { render, cleanup } from '@testing-library/react'
import TrendSparkline from './TrendSparkline'

afterEach(cleanup)

describe('TrendSparkline', () => {
  it('draws one 2px path through the three points, a dashed rule at each band boundary, and the codes under it', () => {
    const { container } = render(
      <TrendSparkline values={[3.0, 3.3, 3.7]} bands={DEFAULT_RESULT_BANDS} labels={['Q1', 'Q2', 'Q3']} label="Confianza" />,
    )
    const paths = container.querySelectorAll('path[data-slot="trend-line"]')
    expect(paths).toHaveLength(1)
    const d = paths[0].getAttribute('d') ?? ''
    // `M x y L x y L x y` — one move and two line segments is three points.
    expect(d.match(/[ML]/g)).toHaveLength(3)
    expect(d.startsWith('M')).toBe(true)
    expect(paths[0].getAttribute('stroke-width')).toBe('2')
    const boundaries = [...container.querySelectorAll('line[data-slot="trend-boundary"]')]
    // 3,00 and 4,00 both fall inside the fitted range (3,0 − 0,25 … 4,0 + 0,25).
    expect(boundaries).toHaveLength(2)
    expect(boundaries.every((line) => line.getAttribute('stroke-dasharray') === '3 3')).toBe(true)
    // The codes sit in a row under the figure, spread to the card's edges, as the canvas draws them.
    expect(container.querySelectorAll('svg text')).toHaveLength(0)
    expect([...container.querySelectorAll('[data-slot="trend-labels"] span')].map((span) => span.textContent)).toEqual([
      'Q1',
      'Q2',
      'Q3',
    ])
  })

  it('paints the endpoint in its band’s colour and names the band on it', () => {
    const cases: [number[], string, string][] = [
      [[2.6, 2.7, 2.8], 'critical', 'var(--admin-accent-red)'],
      [[2.8, 3.0, 3.3], 'opportunity', 'var(--admin-accent-amber)'],
      [[3.3, 3.7, 4.0], 'strength', 'var(--admin-accent-green)'],
    ]
    for (const [values, band, fill] of cases) {
      const { container } = render(
        <TrendSparkline values={values} bands={DEFAULT_RESULT_BANDS} labels={['Q1', 'Q2', 'Q3']} label="x" />,
      )
      const end = container.querySelector('circle[data-slot="trend-end"]')
      expect(end?.getAttribute('data-band')).toBe(band)
      expect(end?.getAttribute('fill')).toBe(fill)
      cleanup()
    }
  })

  it('judges the endpoint at the decimal the card prints: 2.96 reads "3.0", the opportunity area', () => {
    const { container } = render(
      <TrendSparkline values={[2.6, 2.8, 2.96]} bands={DEFAULT_RESULT_BANDS} labels={['Q1', 'Q2', 'Q3']} label="x" />,
    )
    expect(container.querySelector('circle[data-slot="trend-end"]')?.getAttribute('data-band')).toBe('opportunity')
  })

  it('draws on the range it is handed, so six sparklines share one scale', () => {
    const fitted = render(<TrendSparkline values={[3.0, 3.3, 3.7]} bands={DEFAULT_RESULT_BANDS} labels={[]} label="x" />)
    const own = fitted.container.querySelector('line[data-slot="trend-boundary"]')?.getAttribute('y1')
    cleanup()
    const shared = render(<TrendSparkline values={[3.0, 3.3, 3.7]} bands={DEFAULT_RESULT_BANDS} labels={[]} label="x" domain={[2.0, 4.5]} />)
    expect(shared.container.querySelector('line[data-slot="trend-boundary"]')?.getAttribute('y1')).not.toBe(own)
  })
})

describe('TrendSparkline in the canvas card', () => {
  it('keeps 6px above its codes and sets them in the 15px line box the artboard draws', () => {
    const { container } = render(<TrendSparkline values={[3.3, 3.7, 4.0]} bands={DEFAULT_RESULT_BANDS} labels={['Q1', 'Q2', 'Q3']} label="x" />)
    const codes = container.querySelector('[data-slot="trend-labels"]') as HTMLElement
    expect(codes.className.split(/\s+/)).toContain('leading-normal')
    expect((codes.parentElement as HTMLElement).className.split(/\s+/)).toContain('gap-1.5')
  })
})
