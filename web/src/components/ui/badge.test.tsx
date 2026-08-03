import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Badge } from './badge'

afterEach(cleanup)

describe('Badge', () => {
  it('renders its content', () => {
    render(<Badge>Active</Badge>)
    expect(screen.getByText('Active')).toBeTruthy()
  })

  it('carries a distinct fill per variant', () => {
    const { container } = render(
      <>
        <Badge variant="success">ok</Badge>
        <Badge variant="destructive">bad</Badge>
      </>,
    )
    const [success, destructive] = Array.from(container.querySelectorAll('[data-slot=badge]'))
    expect(success.className).not.toBe(destructive.className)
  })

  it('renders the child element with asChild', () => {
    render(
      <Badge asChild>
        <a href="/filter">Open</a>
      </Badge>,
    )
    expect(screen.getByRole('link', { name: 'Open' })).toBeTruthy()
  })

  it('hardcodes no colour — every fill comes from a token utility', () => {
    render(<Badge variant="warning">warn</Badge>)
    const classes = screen.getByText('warn').className
    expect(classes).not.toMatch(/#[0-9a-fA-F]{3,8}|rgb\(|bg-\[/)
    expect(classes).toContain('bg-accent-amber-soft')
  })
})
