import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import TrendSparkline from './TrendSparkline'

afterEach(cleanup)

describe('TrendSparkline', () => {
  it('draws one path through the three points and a dashed target line', () => {
    const { container } = render(
      <TrendSparkline values={[3.0, 3.3, 3.7]} target={3.7} labels={['Q1', 'Q2', 'Q3']} label="Confianza" />,
    )
    const paths = container.querySelectorAll('path[data-slot="trend-line"]')
    expect(paths).toHaveLength(1)
    const d = paths[0].getAttribute('d') ?? ''
    // `M x y L x y L x y` — one move and two line segments is three points.
    expect(d.match(/[ML]/g)).toHaveLength(3)
    expect(d.startsWith('M')).toBe(true)
    const target = container.querySelector('line[data-slot="trend-target"]')
    expect(target).not.toBeNull()
    expect(target?.getAttribute('stroke-dasharray')).toBe('3 3')
    expect(container.querySelectorAll('text')).toHaveLength(3)
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
})
