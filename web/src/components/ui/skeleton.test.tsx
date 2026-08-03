import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { Skeleton, SkeletonText } from './skeleton'

afterEach(cleanup)

describe('Skeleton', () => {
  it('is hidden from assistive tech', () => {
    // A stack of empty boxes announced one by one is worse than silence; the
    // loading state belongs on the region (see LoadingRegion).
    const { container } = render(<Skeleton className="h-4 w-20" />)
    expect(container.querySelector('[data-slot=skeleton]')?.getAttribute('aria-hidden')).toBe(
      'true',
    )
  })

  it('animates via a utility, not framer-motion', () => {
    const { container } = render(<Skeleton />)
    expect(container.querySelector('[data-slot=skeleton]')?.className).toContain('animate-pulse')
  })

  it('renders the requested number of text lines', () => {
    const { container } = render(<SkeletonText lines={4} />)
    expect(container.querySelectorAll('[data-slot=skeleton]')).toHaveLength(4)
  })

  it('shortens the last line so it reads as a paragraph', () => {
    const { container } = render(<SkeletonText lines={3} />)
    const lines = Array.from(container.querySelectorAll('[data-slot=skeleton]'))
    expect(lines.at(-1)?.className).toContain('w-3/5')
    expect(lines[0]?.className).not.toContain('w-3/5')
  })

  it('does not shorten a single line', () => {
    const { container } = render(<SkeletonText lines={1} />)
    expect(container.querySelector('[data-slot=skeleton]')?.className).not.toContain('w-3/5')
  })
})
