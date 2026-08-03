import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SkipLink } from './skip-link'

afterEach(cleanup)

describe('SkipLink', () => {
  it('is in the accessibility tree but visually hidden until focused', () => {
    render(<SkipLink>Skip to content</SkipLink>)
    const link = screen.getByRole('link', { name: 'Skip to content' })
    // sr-only, not display:none — it has to be reachable by Tab.
    expect(link.className).toContain('sr-only')
    expect(link.className).toContain('focus:not-sr-only')
  })

  it('is the first thing Tab reaches', async () => {
    render(
      <>
        <SkipLink>Skip to content</SkipLink>
        <button>Nav item</button>
      </>,
    )
    await userEvent.tab()
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Skip to content' }))
  })

  it('targets the main landmark by default', () => {
    render(<SkipLink>Skip</SkipLink>)
    expect(screen.getByRole('link').getAttribute('href')).toBe('#main')
  })
})
