import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import DimensionTrendChart from './DimensionTrendChart'

afterEach(cleanup)

const props = {
  target: 3.7,
  labels: ['Q1', 'Q2', 'Q3'],
  label: 'Confianza',
  withheldText: 'withheld',
  targetText: 'target 3.7',
  format: (value: number) => value.toFixed(1),
}

describe('DimensionTrendChart', () => {
  it('draws one segment through consecutive readings, a dashed target rule and a value per point', () => {
    const { container } = render(<DimensionTrendChart {...props} values={[3.0, 3.3, 3.7]} />)
    const segments = container.querySelectorAll('path[data-slot="trend-segment"]')
    expect(segments).toHaveLength(1)
    expect((segments[0].getAttribute('d') ?? '').match(/[ML]/g)).toHaveLength(3)
    expect(container.querySelector('line[data-slot="trend-target"]')?.getAttribute('stroke-dasharray')).toBe('3 3')
    expect(container.textContent).toContain('3.0')
    expect(container.textContent).toContain('3.7')
    expect(container.querySelector('circle[data-slot="trend-end"]')?.getAttribute('data-below-target')).toBe('false')
  })

  it('breaks the line at a withheld wave instead of drawing through it', () => {
    const { container } = render(<DimensionTrendChart {...props} values={[3.0, null, 3.6, 3.8]} />)
    const segments = [...container.querySelectorAll('path[data-slot="trend-segment"]')]
    // Only the run after the gap has two points; nothing joins Q1 to Q3.
    expect(segments).toHaveLength(1)
    expect((segments[0].getAttribute('d') ?? '').match(/L/g)).toHaveLength(1)
    expect(container.querySelectorAll('[data-slot="trend-withheld"]')).toHaveLength(1)
    expect(container.textContent).toContain('withheld')
  })

  it('paints the endpoint red only when the latest reading is below the target', () => {
    const { container } = render(<DimensionTrendChart {...props} values={[2.8, 3.0, 3.3]} />)
    const end = container.querySelector('circle[data-slot="trend-end"]')
    expect(end?.getAttribute('data-below-target')).toBe('true')
    expect(end?.getAttribute('fill')).toBe('#dd0c15')
  })
})
