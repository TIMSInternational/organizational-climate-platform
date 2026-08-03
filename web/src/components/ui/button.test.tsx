import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from './button'

afterEach(cleanup)

describe('Button', () => {
  it('calls onClick when activated', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Save</Button>)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('is activated by keyboard', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Save</Button>)
    await userEvent.tab()
    await userEvent.keyboard('{Enter}')
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('does not fire while disabled', async () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    )
    await userEvent.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('renders the child element with asChild, not a nested button', () => {
    render(
      <Button asChild>
        <a href="/somewhere">Go</a>
      </Button>,
    )
    expect(screen.getByRole('link', { name: 'Go' })).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('never sets outline-none, so the global focus ring survives', () => {
    // index.css provides the app's only focus indicator via :focus-visible.
    render(<Button>Save</Button>)
    expect(screen.getByRole('button').className).not.toMatch(/outline-none/)
  })

  it('lets className win over the variant height', () => {
    render(<Button className="h-10">Save</Button>)
    const classes = screen.getByRole('button').className
    expect(classes).toContain('h-10')
    expect(classes).not.toContain('h-control-lg')
  })
})
