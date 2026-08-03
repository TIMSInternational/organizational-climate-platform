import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Switch } from './switch'

afterEach(cleanup)

describe('Switch', () => {
  it('toggles on click', async () => {
    const onCheckedChange = vi.fn()
    render(<Switch aria-label="Login enabled" onCheckedChange={onCheckedChange} />)
    await userEvent.click(screen.getByRole('switch'))
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it('toggles on Space', async () => {
    const onCheckedChange = vi.fn()
    render(<Switch aria-label="Login enabled" onCheckedChange={onCheckedChange} />)
    await userEvent.tab()
    await userEvent.keyboard(' ')
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it('reports checked state, and reflects a controlled value', () => {
    render(<Switch aria-label="Login enabled" checked />)
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
  })

  it('does not toggle while disabled', async () => {
    const onCheckedChange = vi.fn()
    render(<Switch aria-label="Login enabled" disabled onCheckedChange={onCheckedChange} />)
    await userEvent.click(screen.getByRole('switch'))
    expect(onCheckedChange).not.toHaveBeenCalled()
  })
})
