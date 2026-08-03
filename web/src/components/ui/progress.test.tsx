import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Progress } from './progress'

afterEach(cleanup)

describe('Progress', () => {
  it('exposes a progressbar with its value', () => {
    // The legacy version was divs with no ARIA at all — a screen reader saw a
    // coloured box. This is the reason it was rebuilt on Radix.
    render(<Progress value={40} aria-label="Upload" />)
    const bar = screen.getByRole('progressbar', { name: 'Upload' })
    expect(bar.getAttribute('aria-valuenow')).toBe('40')
    expect(bar.getAttribute('aria-valuemin')).toBe('0')
    expect(bar.getAttribute('aria-valuemax')).toBe('100')
  })

  it('supports the indeterminate state', () => {
    render(<Progress value={null} aria-label="Upload" />)
    const bar = screen.getByRole('progressbar', { name: 'Upload' })
    expect(bar.getAttribute('data-state')).toBe('indeterminate')
    expect(bar.getAttribute('aria-valuenow')).toBeNull()
  })

  it('translates the indicator by the remaining percentage', () => {
    const { container } = render(<Progress value={25} aria-label="Upload" />)
    const indicator = container.querySelector<HTMLElement>('[data-slot=progress-indicator]')
    expect(indicator?.style.transform).toBe('translateX(-75%)')
  })

  it('treats a null value as empty for the transform', () => {
    const { container } = render(<Progress value={null} aria-label="Upload" />)
    const indicator = container.querySelector<HTMLElement>('[data-slot=progress-indicator]')
    expect(indicator?.style.transform).toBe('translateX(-100%)')
  })
})
