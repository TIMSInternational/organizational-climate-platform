import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { Calendar } from './calendar'
import { TranslationProvider } from '../../i18n'
import type { Locale } from '../../i18n'

afterEach(cleanup)

const AUGUST_2026 = new Date(2026, 7, 3)

function renderCalendar(ui: ReactElement, locale: Locale = 'en') {
  return render(<TranslationProvider initialLocale={locale}>{ui}</TranslationProvider>)
}

/**
 * Days are addressed by `data-day`, an ISO date react-day-picker puts on each
 * `<td>`. Querying by accessible name would not work: the button's `aria-label` is
 * a fully localised date ("Monday, August 3rd, 2026" / "lunes, 3 de agosto..."), so
 * a name-based query would be locale-dependent — in a suite whose whole point is
 * changing locale.
 */
function dayCell(container: HTMLElement, iso: string): HTMLElement {
  const cell = container.querySelector<HTMLElement>(`td[data-day="${iso}"]`)
  if (!cell) throw new Error(`no day cell for ${iso}`)
  return cell
}

function dayButton(container: HTMLElement, iso: string): HTMLElement {
  // The <td> is the gridcell; the <button> inside it is what is clickable, so
  // clicking the cell would do nothing.
  const button = dayCell(container, iso).querySelector<HTMLElement>('button')
  if (!button) throw new Error(`no day button for ${iso}`)
  return button
}

describe('Calendar', () => {
  it('renders a grid of days', () => {
    const { container } = renderCalendar(<Calendar mode="single" defaultMonth={AUGUST_2026} />)
    expect(screen.getByRole('grid')).toBeTruthy()
    expect(dayButton(container, '2026-08-03').textContent).toBe('3')
  })

  /**
   * The reason this component exists. #77 skipped `calendar` because a custom picker
   * loses the browser's free localisation; these are what make porting it not a
   * downgrade.
   */
  it('names the month in English under the en locale', () => {
    renderCalendar(<Calendar mode="single" defaultMonth={AUGUST_2026} />, 'en')
    expect(screen.getByText(/August/)).toBeTruthy()
  })

  it('names the month in Spanish under the es locale', () => {
    renderCalendar(<Calendar mode="single" defaultMonth={AUGUST_2026} />, 'es')
    expect(screen.getByText(/agosto/i)).toBeTruthy()
  })

  it('localises the day labels too, not just the caption', () => {
    const { container } = renderCalendar(
      <Calendar mode="single" defaultMonth={AUGUST_2026} />,
      'es',
    )
    expect(dayButton(container, '2026-08-03').getAttribute('aria-label')).toMatch(/agosto/i)
  })

  it('starts the week on Monday in Spanish and Sunday in English', () => {
    // date-fns carries the week-start convention; a hand-rolled grid would not.
    const { container: en } = renderCalendar(
      <Calendar mode="single" defaultMonth={AUGUST_2026} />,
      'en',
    )
    const enFirst = en.querySelectorAll('td[data-day]')[0]?.getAttribute('data-day')

    cleanup()

    const { container: esC } = renderCalendar(
      <Calendar mode="single" defaultMonth={AUGUST_2026} />,
      'es',
    )
    const esFirst = esC.querySelectorAll('td[data-day]')[0]?.getAttribute('data-day')

    expect(enFirst).not.toBe(esFirst)
  })

  it('reports the selected date', async () => {
    const onSelect = vi.fn()
    const { container } = renderCalendar(
      <Calendar mode="single" defaultMonth={AUGUST_2026} onSelect={onSelect} />,
    )
    await userEvent.click(dayButton(container, '2026-08-03'))

    expect(onSelect).toHaveBeenCalled()
    const [selected] = onSelect.mock.calls[0] as [Date]
    expect(selected.getDate()).toBe(3)
  })

  it('marks the selected day for assistive tech', () => {
    const { container } = renderCalendar(
      <Calendar mode="single" defaultMonth={AUGUST_2026} selected={AUGUST_2026} />,
    )
    expect(dayCell(container, '2026-08-03').getAttribute('aria-selected')).toBe('true')
  })

  it('supports range mode — the discriminated union survives the props type', () => {
    // A plain Omit<> on DayPickerProps collapses the union and makes this a type
    // error; the distributive omit is what keeps it compiling.
    renderCalendar(<Calendar mode="range" defaultMonth={AUGUST_2026} />)
    expect(screen.getByRole('grid')).toBeTruthy()
  })

  it('does not select a disabled day', async () => {
    const onSelect = vi.fn()
    const { container } = renderCalendar(
      <Calendar
        mode="single"
        defaultMonth={AUGUST_2026}
        disabled={{ before: new Date(2026, 7, 10) }}
        onSelect={onSelect}
      />,
    )
    expect(dayCell(container, '2026-08-03').getAttribute('data-disabled')).toBe('true')

    await userEvent.click(dayButton(container, '2026-08-03'))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('lets an override win over the provider locale', () => {
    renderCalendar(
      <Calendar mode="single" defaultMonth={AUGUST_2026} localeOverride="es" />,
      'en',
    )
    expect(screen.getByText(/agosto/i)).toBeTruthy()
  })
})
