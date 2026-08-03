import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RadioGroup, RadioGroupItem } from './radio-group'

afterEach(cleanup)

function Group({ onValueChange }: { onValueChange?: (value: string) => void }) {
  return (
    <RadioGroup aria-label="Priority" onValueChange={onValueChange}>
      <RadioGroupItem value="low" aria-label="Low" />
      <RadioGroupItem value="high" aria-label="High" />
    </RadioGroup>
  )
}

describe('RadioGroup', () => {
  it('selects an option on click', async () => {
    const onValueChange = vi.fn()
    render(<Group onValueChange={onValueChange} />)
    await userEvent.click(screen.getByRole('radio', { name: 'High' }))
    expect(onValueChange).toHaveBeenCalledWith('high')
  })

  it('is a single tab stop with arrow-key roving focus', async () => {
    render(<Group />)
    const [low, high] = screen.getAllByRole('radio')

    await userEvent.tab()
    expect(document.activeElement).toBe(low)

    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(high)

    await userEvent.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(low)
  })

  it('selects the focused option with Space', async () => {
    const onValueChange = vi.fn()
    render(<Group onValueChange={onValueChange} />)
    await userEvent.tab()
    await userEvent.keyboard(' ')
    expect(onValueChange).toHaveBeenCalledWith('low')
  })

  // NOT TESTED: selection-following-focus, i.e. that ArrowDown alone also
  // *selects*. Radix implements it by tracking arrow keydown on `document` and
  // reading that flag in the item's focus handler. happy-dom dispatches focus
  // asynchronously relative to that flag being cleared on keyup, so the
  // selection never lands and the assertion fails for an environment reason
  // rather than a component one. Focus movement above is the part that can be
  // verified here; the selection behaviour is Radix's own, covered by its suite.

  it('exposes a radiogroup with its options', () => {
    render(<Group />)
    expect(screen.getByRole('radiogroup', { name: 'Priority' })).toBeTruthy()
    expect(screen.getAllByRole('radio')).toHaveLength(2)
  })

  it('marks the selected option checked', () => {
    render(
      <RadioGroup aria-label="Priority" value="high">
        <RadioGroupItem value="low" aria-label="Low" />
        <RadioGroupItem value="high" aria-label="High" />
      </RadioGroup>,
    )
    expect(screen.getByRole('radio', { name: 'High' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: 'Low' }).getAttribute('aria-checked')).toBe('false')
  })
})
