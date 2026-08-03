import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Input } from './input'

afterEach(cleanup)

describe('Input', () => {
  it('reports each typed character', async () => {
    const onChange = vi.fn()
    render(<Input aria-label="Name" onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Name'), 'abc')
    expect(onChange).toHaveBeenCalledTimes(3)
  })

  it('accepts a controlled value', async () => {
    render(<Input aria-label="Name" value="Ana" readOnly />)
    expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('Ana')
  })

  it('cannot be typed into while disabled', async () => {
    const onChange = vi.fn()
    render(<Input aria-label="Name" disabled onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Name'), 'abc')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('forwards the type attribute', () => {
    render(<Input aria-label="Email" type="email" />)
    expect(screen.getByLabelText('Email').getAttribute('type')).toBe('email')
  })
})
