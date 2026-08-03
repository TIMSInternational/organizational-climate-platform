import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Separator } from './separator'

afterEach(cleanup)

describe('Separator', () => {
  it('is hidden from assistive tech when decorative', () => {
    const { container } = render(<Separator />)
    // A decorative rule is presentational: it must not be announced.
    expect(screen.queryByRole('separator')).toBeNull()
    expect(container.querySelector('[data-slot=separator]')).toBeTruthy()
  })

  it('is announced when it carries meaning', () => {
    render(<Separator decorative={false} />)
    expect(screen.getByRole('separator')).toBeTruthy()
  })

  it('reports its orientation', () => {
    render(<Separator decorative={false} orientation="vertical" />)
    expect(screen.getByRole('separator').getAttribute('aria-orientation')).toBe('vertical')
  })

  it('defaults to horizontal', () => {
    render(<Separator decorative={false} />)
    expect(screen.getByRole('separator').getAttribute('data-orientation')).toBe('horizontal')
  })
})
