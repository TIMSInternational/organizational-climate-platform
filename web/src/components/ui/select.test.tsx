import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select'

afterEach(cleanup)

function Priority({ onValueChange }: { onValueChange?: (value: string) => void }) {
  return (
    <Select onValueChange={onValueChange}>
      <SelectTrigger aria-label="Priority">
        <SelectValue placeholder="Choose one" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="low">Low</SelectItem>
        <SelectItem value="high">High</SelectItem>
      </SelectContent>
    </Select>
  )
}

describe('Select', () => {
  it('shows the placeholder while nothing is chosen', () => {
    render(<Priority />)
    expect(screen.getByText('Choose one')).toBeTruthy()
  })

  it('exposes a combobox that is collapsed to start with', () => {
    render(<Priority />)
    const trigger = screen.getByRole('combobox', { name: 'Priority' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('opens on click and reports the chosen option', async () => {
    const onValueChange = vi.fn()
    render(<Priority onValueChange={onValueChange} />)

    await userEvent.click(screen.getByRole('combobox', { name: 'Priority' }))
    expect(await screen.findByRole('option', { name: 'High' })).toBeTruthy()

    await userEvent.click(screen.getByRole('option', { name: 'High' }))
    expect(onValueChange).toHaveBeenCalledWith('high')
  })

  it('opens from the keyboard', async () => {
    render(<Priority />)
    await userEvent.tab()
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Priority' }))

    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('listbox')).toBeTruthy()
  })

  it('does not open while disabled', async () => {
    render(
      <Select disabled>
        <SelectTrigger aria-label="Priority">
          <SelectValue placeholder="Choose one" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="low">Low</SelectItem>
        </SelectContent>
      </Select>,
    )
    await userEvent.click(screen.getByRole('combobox', { name: 'Priority' }))
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
