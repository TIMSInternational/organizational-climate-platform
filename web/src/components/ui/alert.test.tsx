import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Alert, AlertDescription, AlertTitle } from './alert'

afterEach(cleanup)

describe('Alert', () => {
  it('renders title and description', () => {
    render(
      <Alert>
        <AlertTitle>Heads up</AlertTitle>
        <AlertDescription>Settings were saved.</AlertDescription>
      </Alert>,
    )
    expect(screen.getByText('Heads up')).toBeTruthy()
    expect(screen.getByText('Settings were saved.')).toBeTruthy()
  })

  it('announces politely by default', () => {
    render(<Alert>content</Alert>)
    // A standing banner must not interrupt a screen reader mid-sentence.
    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('can announce assertively when the user just caused the failure', () => {
    render(<Alert variant="destructive" role="alert">failed</Alert>)
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('gives each variant a distinct fill', () => {
    const { container } = render(
      <>
        <Alert variant="success">a</Alert>
        <Alert variant="destructive">b</Alert>
      </>,
    )
    const [success, destructive] = Array.from(container.querySelectorAll('[data-slot=alert]'))
    expect(success.className).not.toBe(destructive.className)
  })

  it('paints no result-area tint on a success, a warning or an error — the glyph carries the kind', () => {
    const { container } = render(
      <>
        <Alert variant="success">a</Alert>
        <Alert variant="warning">b</Alert>
        <Alert variant="destructive">c</Alert>
      </>,
    )
    const [success, warning, destructive] = Array.from(container.querySelectorAll('[data-slot=alert]'))
    for (const alert of [success, warning, destructive]) {
      // Green, amber and red belong to Fortaleza, Oportunidad and Crítica only (11 Nov).
      expect(alert.className).not.toMatch(/accent-(green|amber|red)-(soft|ring)/)
      expect(alert.className).toContain('border-line-panel')
    }
    expect(warning.className).toContain('bg-surface-fill-subtle')
    expect(destructive.className).toContain('bg-surface-fill-subtle')
    // The error is still told from a warning: its icon wears the red ink.
    expect(destructive.className).toContain('[&>svg]:text-accent-red-ink')
    expect(warning.className).not.toContain('accent-red')
  })
})
