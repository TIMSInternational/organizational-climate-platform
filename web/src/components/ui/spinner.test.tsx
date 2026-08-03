import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { LoadingRegion, Spinner } from './spinner'

afterEach(cleanup)

describe('Spinner', () => {
  it('is decorative — it carries no accessible name of its own', () => {
    const { container } = render(<Spinner />)
    expect(container.querySelector('[data-slot=spinner]')?.getAttribute('aria-hidden')).toBe(
      'true',
    )
  })

  it('animates via a utility, not framer-motion', () => {
    const { container } = render(<Spinner />)
    expect(container.querySelector('[data-slot=spinner]')?.className).toContain('animate-spin')
  })

  it('sizes from the token scale', () => {
    const { container } = render(<Spinner size="md" />)
    expect(container.querySelector('[data-slot=spinner]')?.className).toContain('size-icon')
  })
})

describe('LoadingRegion', () => {
  it('marks itself busy and announces while loading', () => {
    render(
      <LoadingRegion loading label="Loading companies">
        <p>old data</p>
      </LoadingRegion>,
    )
    expect(screen.getByRole('status').textContent).toBe('Loading companies')
    expect(screen.getByText('old data').closest('[aria-busy=true]')).not.toBeNull()
  })

  it('drops busy and the announcement when done', () => {
    render(
      <LoadingRegion loading={false} label="Loading companies">
        <p>fresh data</p>
      </LoadingRegion>,
    )
    expect(screen.getByRole('status').textContent).toBe('')
    expect(screen.getByText('fresh data').closest('[aria-busy=true]')).toBeNull()
  })

  it('keeps its children mounted, so content is not replaced by a spinner', () => {
    render(
      <LoadingRegion loading label="Loading">
        <p>still here</p>
      </LoadingRegion>,
    )
    expect(screen.getByText('still here')).toBeTruthy()
  })
})
