import type { ReactElement } from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render as rtlRender, cleanup } from '@testing-library/react'
import { DEFAULT_RESULT_BANDS } from '../../../../components/charts'
import { TranslationProvider } from '../../../../i18n'
import en from '../../../../i18n/en.json'
import DimensionTrendChart from './DimensionTrendChart'

/** The zone names are translated, so every chart renders inside the app's provider. */
function render(ui: ReactElement) {
  return rtlRender(<TranslationProvider>{ui}</TranslationProvider>)
}

afterEach(cleanup)

const props = {
  bands: DEFAULT_RESULT_BANDS,
  labels: ['Q1', 'Q2', 'Q3'],
  label: 'Confianza',
  withheldText: 'withheld',
  format: (value: number) => value.toFixed(1),
}

function ticksOf(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-slot="trend-tick"]')].map((tick) => tick.textContent ?? '')
}

describe('DimensionTrendChart', () => {
  it('draws one segment through consecutive readings, a dashed rule at each band boundary and a value per point', () => {
    const { container } = render(<DimensionTrendChart {...props} values={[3.0, 3.3, 3.7]} />)
    const segments = container.querySelectorAll('path[data-slot="trend-segment"]')
    expect(segments).toHaveLength(1)
    expect((segments[0].getAttribute('d') ?? '').match(/[ML]/g)).toHaveLength(3)
    // The canvas's rule: 2px line, a "4 3" dash on each boundary.
    expect(segments[0].getAttribute('stroke-width')).toBe('2')
    const boundaries = [...container.querySelectorAll('line[data-slot="trend-boundary"]')]
    expect(boundaries).toHaveLength(2)
    expect(boundaries.every((line) => line.getAttribute('stroke-dasharray') === '4 3')).toBe(true)
    expect(container.textContent).toContain('3.0')
    expect(container.textContent).toContain('3.7')
    expect(container.querySelector('circle[data-slot="trend-end"]')?.getAttribute('data-band')).toBe('opportunity')
  })

  it('breaks the line at a withheld wave instead of drawing through it, and says it is withheld', () => {
    const { container } = render(
      <DimensionTrendChart {...props} values={[3.0, null, 3.6, 3.8]} withheld={[false, true, false, false]} />,
    )
    const segments = [...container.querySelectorAll('path[data-slot="trend-segment"]')]
    // Only the run after the gap has two points; nothing joins Q1 to Q3.
    expect(segments).toHaveLength(1)
    expect((segments[0].getAttribute('d') ?? '').match(/L/g)).toHaveLength(1)
    expect(container.querySelectorAll('[data-slot="trend-withheld"]')).toHaveLength(1)
    expect(container.textContent).toContain('withheld')
  })

  it('breaks the line at a wave that did not ask the dimension, without claiming a protection', () => {
    const { container } = render(
      <DimensionTrendChart {...props} values={[3.0, null, 3.6]} withheld={[false, false, false]} />,
    )
    expect(container.querySelectorAll('path[data-slot="trend-segment"]')).toHaveLength(0)
    expect(container.querySelectorAll('[data-slot="trend-withheld"]')).toHaveLength(0)
    expect(container.textContent).not.toContain('withheld')
  })

  it('lays the three areas behind the line, names each in its own ink, and paints the endpoint in its band', () => {
    const { container } = render(<DimensionTrendChart {...props} values={[2.8, 3.0, 3.3]} />)
    const zones = [...container.querySelectorAll('rect[data-slot="trend-zone"]')]
    expect(zones.map((zone) => zone.getAttribute('data-band'))).toEqual(['strength', 'opportunity', 'critical'])
    expect(zones.map((zone) => zone.getAttribute('fill'))).toEqual([
      'var(--admin-accent-bg-green)',
      'var(--admin-accent-bg-amber)',
      'var(--admin-accent-bg-red)',
    ])
    // Colour is never alone: each area is named on the chart (in a corner no point covers).
    const names = [...container.querySelectorAll('[data-slot="trend-zone-label"]')].map((label) => label.textContent)
    expect(names).toEqual(['STRENGTH', 'OPPORTUNITY', 'CRITICAL'].filter((name) => names.includes(name)))
    expect(names.length).toBeGreaterThanOrEqual(2)
    const end = container.querySelector('circle[data-slot="trend-end"]')
    expect(end?.getAttribute('data-band')).toBe('opportunity')
    expect(end?.getAttribute('fill')).toBe('var(--admin-accent-amber)')
    expect(en.resultBands.short.strength.toUpperCase()).toBe('STRENGTH')
  })

  it('paints a critical endpoint red', () => {
    const { container } = render(<DimensionTrendChart {...props} values={[2.6, 2.7, 2.8]} />)
    const end = container.querySelector('circle[data-slot="trend-end"]')
    expect(end?.getAttribute('data-band')).toBe('critical')
    expect(end?.getAttribute('fill')).toBe('var(--admin-accent-red)')
  })

  it('draws on the axis it is handed, so a page of charts shares one scale', () => {
    // Fitted alone to readings above 3,5, it would still reach down to the 3,00 boundary.
    const own = render(<DimensionTrendChart {...props} values={[3.3, 3.7, 4.0]} axis={{ low: 3.0, high: 4.5, ticks: [3.5, 4.0, 4.5] }} />)
    expect(ticksOf(own.container)).toEqual(['3.5', '4.0', '4.5'])
    cleanup()
    const shared = render(
      <DimensionTrendChart {...props} values={[3.3, 3.7, 4.0]} axis={{ low: 2.5, high: 4.5, ticks: [3.0, 3.5, 4.0, 4.5] }} />,
    )
    expect(ticksOf(shared.container)).toEqual(['3.0', '3.5', '4.0', '4.5'])
  })

  it('draws the canvas geometry: no 2,5 label, the 3,0 label at y 100,5 and a 2,8 point under it at y 107,8', () => {
    const { container } = render(
      <DimensionTrendChart {...props} values={[2.8, 3.0, 3.3]} axis={{ low: 2.5, high: 4.5, ticks: [3.0, 3.5, 4.0, 4.5] }} />,
    )
    expect(ticksOf(container)).not.toContain('2.5')
    const three = [...container.querySelectorAll('[data-slot="trend-tick"]')].find((tick) => tick.textContent === '3.0')
    // The artboard's own numbers: `<text y="100.5">3,0</text>`, `<circle cy="107.8">` for 2,8.
    expect(Number(three?.getAttribute('y'))).toBeCloseTo(100.5)
    expect(Number(container.querySelector('circle[data-slot="trend-point"]')?.getAttribute('cy'))).toBeCloseTo(107.8)
  })
})
