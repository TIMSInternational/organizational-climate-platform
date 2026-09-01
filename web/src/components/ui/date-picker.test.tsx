import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { DatePicker } from './date-picker'
import { TranslationProvider } from '../../i18n'
import type { Locale } from '../../i18n'

afterEach(cleanup)

// Deliberately a date in the past, and deliberately not "today" in any month.
// The pick test below used to pass only while the machine's clock happened to sit in
// August 2026: `DatePicker` did not pass `defaultMonth`, so the calendar opened on the
// CURRENT month and August's grid was on screen by coincidence. It went red on its own
// on 1 September 2026, on a tree nobody had touched. A test whose result depends on the
// day it runs is not pinning the behaviour it names.
const AUGUST_2026 = new Date(2026, 7, 3)

function renderPicker(
  props: Partial<ComponentProps<typeof DatePicker>> = {},
  locale: Locale = 'en',
) {
  return render(
    <TranslationProvider initialLocale={locale}>
      <DatePicker label="Fecha de inicio" placeholder="Elegir fecha" {...props} />
    </TranslationProvider>,
  )
}

function trigger() {
  return screen.getByRole('button', { name: 'Fecha de inicio' })
}

describe('DatePicker', () => {
  it('shows the placeholder when nothing is selected', () => {
    renderPicker()
    expect(screen.getByText('Elegir fecha')).toBeTruthy()
  })

  it('takes its accessible name from the caller, not hardcoded English', () => {
    renderPicker()
    expect(trigger()).toBeTruthy()
  })

  it('formats the selected date in English under en', () => {
    renderPicker({ value: AUGUST_2026 }, 'en')
    expect(trigger().textContent).toMatch(/August/)
  })

  it('formats the selected date in Spanish under es', () => {
    // "3 de agosto de 2026" — the whole point of wiring date-fns to the UI locale.
    renderPicker({ value: AUGUST_2026 }, 'es')
    expect(trigger().textContent).toMatch(/agosto/i)
  })

  it('opens the calendar and reports a pick, then closes', async () => {
    const onChange = vi.fn()
    const { baseElement } = renderPicker({ onChange, value: AUGUST_2026 })

    await userEvent.click(trigger())
    await screen.findByRole('grid')

    // The calendar must open on the SELECTED date's month, whatever today is. Asserting
    // the caption first makes the failure say "it opened on the wrong month" instead of
    // "a cell was missing", which is what sent the original failure looking at the grid.
    expect(baseElement.querySelector('[role="grid"]')?.getAttribute('aria-label')).toMatch(/August 2026/i)

    const day = baseElement.querySelector<HTMLElement>('td[data-day="2026-08-14"] button')
    expect(day).not.toBeNull()
    await userEvent.click(day!)

    expect(onChange).toHaveBeenCalled()
    const [picked] = onChange.mock.calls[0] as [Date]
    expect(picked.getDate()).toBe(14)
    // Staying open after a single-date pick would need a second dismissing click.
    await waitFor(() => expect(screen.queryByRole('grid')).toBeNull())
  })

  it('does not open while disabled', async () => {
    renderPicker({ disabled: true })
    await userEvent.click(trigger())
    expect(screen.queryByRole('grid')).toBeNull()
  })

  it('exposes invalid state, matching FormControl', () => {
    renderPicker({ invalid: true })
    expect(trigger().getAttribute('aria-invalid')).toBe('true')
  })

  it('honours a custom format', () => {
    renderPicker({ value: AUGUST_2026, dateFormat: 'yyyy-MM-dd' })
    expect(trigger().textContent).toContain('2026-08-03')
  })
})
