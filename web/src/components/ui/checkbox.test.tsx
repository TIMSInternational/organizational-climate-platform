import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Checkbox } from './checkbox'

afterEach(cleanup)

describe('Checkbox', () => {
  it('toggles on click', async () => {
    const onCheckedChange = vi.fn()
    render(<Checkbox aria-label="Active" onCheckedChange={onCheckedChange} />)
    await userEvent.click(screen.getByRole('checkbox'))
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it('toggles on Space, so it is keyboard operable', async () => {
    const onCheckedChange = vi.fn()
    render(<Checkbox aria-label="Active" onCheckedChange={onCheckedChange} />)
    await userEvent.tab()
    await userEvent.keyboard(' ')
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it('exposes its state to assistive tech', () => {
    render(<Checkbox aria-label="Active" checked />)
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('true')
  })

  it('supports the indeterminate state', () => {
    render(<Checkbox aria-label="Active" checked="indeterminate" />)
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('mixed')
  })

  it('does not toggle while disabled', async () => {
    const onCheckedChange = vi.fn()
    render(<Checkbox aria-label="Active" disabled onCheckedChange={onCheckedChange} />)
    await userEvent.click(screen.getByRole('checkbox'))
    expect(onCheckedChange).not.toHaveBeenCalled()
  })
})
