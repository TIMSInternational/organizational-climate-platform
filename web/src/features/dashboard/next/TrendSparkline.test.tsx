import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import TrendSparkline from './TrendSparkline'

afterEach(cleanup)

describe('TrendSparkline', () => {
  it('draws one 2px path through the three points, a dashed target line, and the codes under it', () => {
    const { container } = render(
      <TrendSparkline values={[3.0, 3.3, 3.7]} target={3.7} labels={['Q1', 'Q2', 'Q3']} label="Confianza" />,
    )
    const paths = container.querySelectorAll('path[data-slot="trend-line"]')
    expect(paths).toHaveLength(1)
    const d = paths[0].getAttribute('d') ?? ''
    // `M x y L x y L x y` — one move and two line segments is three points.
    expect(d.match(/[ML]/g)).toHaveLength(3)
    expect(d.startsWith('M')).toBe(true)
    expect(paths[0].getAttribute('stroke-width')).toBe('2')
    const target = container.querySelector('line[data-slot="trend-target"]')
    expect(target).not.toBeNull()
    expect(target?.getAttribute('stroke-dasharray')).toBe('3 3')
    // The codes sit in a row under the figure, spread to the card's edges, as the canvas draws them.
    expect(container.querySelectorAll('svg text')).toHaveLength(0)
    expect([...container.querySelectorAll('[data-slot="trend-labels"] span')].map((span) => span.textContent)).toEqual([
      'Q1',
      'Q2',
      'Q3',
    ])
  })

  it('emphasises the endpoint in red only when the latest reading is below the target', () => {
    const below = render(
      <TrendSparkline values={[2.8, 3.0, 3.3]} target={3.7} labels={['Q1', 'Q2', 'Q3']} label="Carga" />,
    )
    const belowEnd = below.container.querySelector('circle[data-slot="trend-end"]')
    expect(belowEnd?.getAttribute('data-below-target')).toBe('true')
    expect(belowEnd?.getAttribute('fill')).toBe('#dd0c15')
    cleanup()

    const onTarget = render(
      <TrendSparkline values={[3.0, 3.3, 3.7]} target={3.7} labels={['Q1', 'Q2', 'Q3']} label="Confianza" />,
    )
    const end = onTarget.container.querySelector('circle[data-slot="trend-end"]')
    expect(end?.getAttribute('data-below-target')).toBe('false')
    expect(end?.getAttribute('fill')).toBe('#6a6ece')
  })

  it('judges the endpoint at the decimal the card prints: 3.67 reads "3.7", on a 3.7 target', () => {
    const { container } = render(
      <TrendSparkline values={[2.96, 3.33, 3.67]} target={3.7} labels={['Q1', 'Q2', 'Q3']} label="Confianza" />,
    )
    expect(container.querySelector('circle[data-slot="trend-end"]')?.getAttribute('data-below-target')).toBe('false')
  })

  it('draws on the range it is handed, so six sparklines share one scale', () => {
    const fitted = render(<TrendSparkline values={[3.0, 3.3, 3.7]} target={3.7} labels={[]} label="x" />)
    const own = fitted.container.querySelector('line[data-slot="trend-target"]')?.getAttribute('y1')
    cleanup()
    const shared = render(<TrendSparkline values={[3.0, 3.3, 3.7]} target={3.7} labels={[]} label="x" domain={[2.0, 4.5]} />)
    expect(shared.container.querySelector('line[data-slot="trend-target"]')?.getAttribute('y1')).not.toBe(own)
  })
})
