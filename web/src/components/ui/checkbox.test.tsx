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

  /**
   * The one thing about this component that a layout engine would have caught and
   * happy-dom cannot. Radix renders a `<button>`, `index.css` gives every bare
   * `<button>` `padding: 0 var(--admin-space-12)`, and under `box-sizing: border-box`
   * that padding beats `size-3.5` — the box was a 26x14 rectangle everywhere until a
   * screenshot for #115 showed it. This pins the class that resets it; the PNG is
   * what proves the pixels.
   */
  it('resets the bare-button padding that would stretch it into a rectangle', () => {
    render(<Checkbox aria-label="Active" />)
    expect(screen.getByRole('checkbox').className.split(/\s+/)).toContain('p-0')
  })

  it('does not toggle while disabled', async () => {
    const onCheckedChange = vi.fn()
    render(<Checkbox aria-label="Active" disabled onCheckedChange={onCheckedChange} />)
    await userEvent.click(screen.getByRole('checkbox'))
    expect(onCheckedChange).not.toHaveBeenCalled()
  })
})
