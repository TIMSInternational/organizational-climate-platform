import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Caption, H1, H2, SectionLabel, Typography } from './typography'

afterEach(cleanup)

describe('Typography', () => {
  it('renders a real heading element for a heading variant', () => {
    render(<H1>Companies</H1>)
    // The document outline has to be real, not simulated with a styled span.
    expect(screen.getByRole('heading', { level: 1, name: 'Companies' })).toBeTruthy()
  })

  it('picks the element from the variant', () => {
    render(<H2>Settings</H2>)
    expect(screen.getByRole('heading', { level: 2 })).toBeTruthy()
  })

  it('lets `as` decouple heading level from visual size', () => {
    // A section that looks like an h3 but is the page's h2.
    render(
      <Typography variant="h3" as="h2">
        Departments
      </Typography>,
    )
    const heading = screen.getByRole('heading', { level: 2, name: 'Departments' })
    expect(heading.dataset.variant).toBe('h3')
  })

  it('renders inline variants as spans, outside the outline', () => {
    render(<Caption>3 of 9</Caption>)
    expect(screen.getByText('3 of 9').tagName).toBe('SPAN')
  })

  it('hardcodes no size — every variant uses a token utility', () => {
    render(<SectionLabel>Overview</SectionLabel>)
    const classes = screen.getByText('Overview').className
    expect(classes).not.toMatch(/text-\[|#[0-9a-fA-F]{3,8}/)
    expect(classes).toContain('text-2xs')
  })
})
