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
})
