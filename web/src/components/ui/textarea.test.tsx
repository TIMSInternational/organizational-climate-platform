import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Textarea } from './textarea'

afterEach(cleanup)

describe('Textarea', () => {
  it('reports typed input', async () => {
    const onChange = vi.fn()
    render(<Textarea aria-label="Notes" onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Notes'), 'hi')
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('keeps newlines', async () => {
    render(<Textarea aria-label="Notes" />)
    const field = screen.getByLabelText<HTMLTextAreaElement>('Notes')
    await userEvent.type(field, 'a{Enter}b')
    expect(field.value).toBe('a\nb')
  })

  it('overrides the 32px control height the element rule imposes', () => {
    render(<Textarea aria-label="Notes" />)
    expect(screen.getByLabelText('Notes').className).toContain('h-auto')
  })
})
