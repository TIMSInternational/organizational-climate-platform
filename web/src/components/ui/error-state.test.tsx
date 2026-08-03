import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EmptyState, ErrorState, NetworkError } from './error-state'
import { Button } from './button'

afterEach(cleanup)

describe('ErrorState', () => {
  it('announces assertively by default', () => {
    render(<ErrorState title="Could not load" />)
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText('Could not load')).toBeTruthy()
  })

  it('renders an optional description and action', async () => {
    const onClick = vi.fn()
    render(
      <ErrorState
        title="Could not load"
        description="The server did not respond."
        action={<Button onClick={onClick}>Retry</Button>}
      />,
    )
    expect(screen.getByText('The server did not respond.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('keeps its icon out of the accessible name', () => {
    render(<ErrorState title="Could not load" />)
    // The decorative glyph must not be read out before the message.
    expect(screen.getByRole('alert').querySelector('[aria-hidden=true]')).toBeTruthy()
  })
})

describe('EmptyState', () => {
  it('announces politely — an empty list is not an error', () => {
    render(<EmptyState title="No companies yet" />)
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('NetworkError', () => {
  it('offers a retry when given both a handler and a label', async () => {
    const onRetry = vi.fn()
    render(<NetworkError title="Offline" onRetry={onRetry} retryText="Try again" />)
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('omits the retry button when no handler is given', () => {
    render(<NetworkError title="Offline" />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('omits the retry button without a label, rather than inventing English copy', () => {
    render(<NetworkError title="Offline" onRetry={vi.fn()} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
