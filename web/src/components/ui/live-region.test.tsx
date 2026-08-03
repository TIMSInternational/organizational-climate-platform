import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { LiveRegion } from './live-region'

afterEach(cleanup)

describe('LiveRegion', () => {
  it('announces politely by default', () => {
    render(<LiveRegion>3 of 40 companies</LiveRegion>)
    const region = screen.getByRole('status')
    expect(region.getAttribute('aria-live')).toBe('polite')
    expect(region.getAttribute('aria-atomic')).toBe('true')
  })

  it('can interrupt when it must', () => {
    render(<LiveRegion politeness="assertive">Session expiring</LiveRegion>)
    expect(screen.getByRole('alert').getAttribute('aria-live')).toBe('assertive')
  })

  it('is visually hidden unless asked otherwise', () => {
    const { rerender } = render(<LiveRegion>x</LiveRegion>)
    expect(screen.getByRole('status').className).toContain('sr-only')

    rerender(<LiveRegion visible>x</LiveRegion>)
    expect(screen.getByRole('status').className).not.toContain('sr-only')
  })
})
