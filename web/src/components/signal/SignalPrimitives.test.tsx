import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PopulationGrid } from './SignalPrimitives'

afterEach(cleanup)

describe('PopulationGrid', () => {
  const bands = [
    { name: 'Operations', responses: 11, isProtected: false },
    { name: 'Investment', responses: 2, isProtected: true },
  ]

  it('draws the padlock before the words on a withheld group, and only there', () => {
    // The ruled pattern for a withheld group is the padlock plus «Menos de N» — the
    // same one the climate map draws on that group's row (fix round 2, 12 Nov).
    const { container } = render(<PopulationGrid bands={bands} protectedLabel="Fewer than 3" />)
    const label = container.querySelector('[data-slot="population-protected"]')
    expect(label?.textContent).toBe('Fewer than 3')
    expect(label?.firstElementChild?.tagName.toLowerCase()).toBe('svg')
    expect(container.querySelectorAll('[data-slot="population-protected"] svg')).toHaveLength(1)
  })

  it('prints no count for the withheld group', () => {
    const { container } = render(<PopulationGrid bands={bands} protectedLabel="Fewer than 3" />)
    // 11 is the disclosed group's; no 2 may appear anywhere, as text or as dots.
    expect(container.textContent ?? '').not.toContain('2')
    expect(container.querySelectorAll('[data-slot="population-withheld"] > span')).toHaveLength(7)
  })
})
