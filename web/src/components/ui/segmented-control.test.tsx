import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { SegmentedControl, type SegmentedOption } from './segmented-control'

afterEach(cleanup)

type Status = 'all' | 'active' | 'draft' | 'closed'

const OPTIONS: SegmentedOption<Status>[] = [
  { value: 'all', label: 'Todas' },
  { value: 'active', label: 'Activas' },
  { value: 'draft', label: 'Borradores' },
  { value: 'closed', label: 'Cerradas' },
]

function Controlled({ onChange, options = OPTIONS }: { onChange?: (value: Status) => void; options?: SegmentedOption<Status>[] }) {
  const [value, setValue] = useState<Status>('all')
  return (
    <SegmentedControl
      label="Filtrar por estado"
      value={value}
      options={options}
      onChange={(next) => {
        setValue(next)
        onChange?.(next)
      }}
    />
  )
}

function pressed(): string[] {
  return screen
    .getAllByRole('button')
    .filter((button) => button.getAttribute('aria-pressed') === 'true')
    .map((button) => button.textContent ?? '')
}

describe('SegmentedControl', () => {
  it('is a named group of toggle buttons, with exactly the chosen one pressed', () => {
    render(<Controlled />)
    expect(screen.getByRole('group', { name: 'Filtrar por estado' })).toBeTruthy()
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(4)
    for (const button of buttons) {
      expect(button.getAttribute('type')).toBe('button')
      expect(['true', 'false']).toContain(button.getAttribute('aria-pressed'))
    }
    expect(pressed()).toEqual(['Todas'])
  })

  it('chooses a segment on click and reports its value, not its label', async () => {
    const onChange = vi.fn()
    render(<Controlled onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Borradores' }))
    expect(onChange).toHaveBeenCalledWith('draft')
    expect(pressed()).toEqual(['Borradores'])
  })

  it('does not report the segment that is already chosen', async () => {
    // A filter that re-queries on every click must not refetch for a click that changes nothing.
    const onChange = vi.fn()
    render(<Controlled onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Todas' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('chooses with Enter and Space once focused', async () => {
    const onChange = vi.fn()
    render(<Controlled onChange={onChange} />)
    await userEvent.tab()
    expect(document.activeElement?.textContent).toBe('Todas')
    await userEvent.tab()
    await userEvent.keyboard('{Enter}')
    expect(onChange).toHaveBeenLastCalledWith('active')
    await userEvent.tab()
    await userEvent.keyboard(' ')
    expect(onChange).toHaveBeenLastCalledWith('draft')
  })

  it('moves focus with the arrows, wrapping, and with Home/End — without choosing', async () => {
    const onChange = vi.fn()
    render(<Controlled onChange={onChange} />)
    await userEvent.tab()
    await userEvent.keyboard('{ArrowRight}')
    expect(document.activeElement?.textContent).toBe('Activas')
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(document.activeElement?.textContent).toBe('Cerradas')
    await userEvent.keyboard('{Home}')
    expect(document.activeElement?.textContent).toBe('Todas')
    await userEvent.keyboard('{End}')
    expect(document.activeElement?.textContent).toBe('Cerradas')
    // Moving is not choosing: the filter has not changed.
    expect(onChange).not.toHaveBeenCalled()
    expect(pressed()).toEqual(['Todas'])
  })

  it('skips a disabled segment when moving, and will not choose it', async () => {
    const onChange = vi.fn()
    const options = OPTIONS.map((option) => (option.value === 'active' ? { ...option, disabled: true } : option))
    render(<Controlled onChange={onChange} options={options} />)
    await userEvent.tab()
    await userEvent.keyboard('{ArrowRight}')
    expect(document.activeElement?.textContent).toBe('Borradores')
    await userEvent.click(screen.getByRole('button', { name: 'Activas' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('raises the chosen segment on the card ground and leaves the rest on the track', () => {
    // The chosen segment must read as raised in both themes (HIG `dark-mode.md`, base and
    // elevated): the card ground over the recessed track.
    render(<Controlled />)
    const group = screen.getByRole('group')
    expect(group.className.split(/\s+/)).toEqual(expect.arrayContaining(['bg-surface-icon-box', 'p-0.5']))
    const chosen = screen.getByRole('button', { name: 'Todas' }).className.split(/\s+/)
    const other = screen.getByRole('button', { name: 'Activas' }).className.split(/\s+/)
    expect(chosen).toEqual(expect.arrayContaining(['bg-surface-card', 'font-semibold', 'shadow-sm']))
    expect(other).toEqual(expect.arrayContaining(['bg-transparent', 'font-medium']))
    expect(other).not.toContain('bg-surface-card')
    // 28px on a desktop, 44px under a finger.
    for (const classes of [chosen, other]) {
      expect(classes).toContain('h-control-md')
      expect(classes).toContain('pointer-coarse:min-h-11')
      expect(classes.join(' ')).not.toMatch(/outline-none|outline-hidden/)
    }
  })
})
