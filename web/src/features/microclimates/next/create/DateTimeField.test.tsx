import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TranslationProvider } from '../../../../i18n'
import { DateTimeField } from './DateTimeField'
import es from '../../../../i18n/es.json'

const copy = es.microclimates.next.create

/*
 * The field edits the COMPANY's wall clock (G16) as text. 02:30 on 8 Mar 2026 does not exist in
 * America/Chicago (the clocks jump 02:00 -> 03:00), so a field that went through a `Date` in the
 * browser's zone printed and saved 03:30 there. Run this file under TZ=America/Chicago to see it
 * bite, and under TZ=UTC to see it hold anyway.
 */
describe('DateTimeField — a wall clock, never the browser zone', () => {
  beforeEach(() => {
    window.localStorage.setItem('preferredLocale', 'es')
  })
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  function renderField(value: string, onChange = vi.fn()) {
    render(
      <TranslationProvider>
        <DateTimeField id="opens" label={copy.opens} value={value} disabled={false} onChange={onChange} />
      </TranslationProvider>,
    )
    return onChange
  }

  it('prints the wall clock it was given, even a minute the browser zone skips', () => {
    renderField('2026-03-08T02:30')
    expect(screen.getByRole('button', { name: new RegExp(`^${copy.opens} `) }).textContent).toBe('08/03/2026 · 02:30')
  })

  it('types a time onto the day as text, even a minute the browser zone skips', async () => {
    const onChange = renderField('2026-03-08T01:00')
    await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${copy.opens} `) }))
    const time = screen.getByRole('textbox', { name: copy.time })
    expect((time as HTMLInputElement).value).toBe('01:00')
    await userEvent.clear(time)
    await userEvent.type(time, '02:30')
    expect(onChange).toHaveBeenLastCalledWith('2026-03-08T02:30')
  })

  it('reads a single-digit hour as its two-digit self', async () => {
    const onChange = renderField('2026-10-22T23:30')
    await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${copy.opens} `) }))
    const time = screen.getByRole('textbox', { name: copy.time })
    await userEvent.clear(time)
    await userEvent.type(time, '8:05')
    expect(onChange).toHaveBeenLastCalledWith('2026-10-22T08:05')
  })
})
