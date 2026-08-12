import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { AnonymityFloorNotice, AnonymityFloorReading } from './AnonymityFloor'
import { TranslationProvider } from '../../../i18n'
import { LOCALE_STORAGE_KEY } from '../../../i18n'
import { ANONYMITY_FLOOR, isSuppressed } from '../../../components/charts'

afterEach(() => {
  cleanup()
  localStorage.removeItem(LOCALE_STORAGE_KEY)
})

function renderIn(locale: 'en' | 'es', node: React.ReactNode) {
  localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  return render(<TranslationProvider>{node}</TranslationProvider>)
}

describe('AnonymityFloorReading', () => {
  it('shows the floor as a number and says it is locked, in words', () => {
    renderIn('en', <AnonymityFloorReading />)

    expect(screen.getByText(String(ANONYMITY_FLOOR))).toBeTruthy()
    // The padlock is decorative; the word is what carries the state, so a reader
    // who cannot see the glyph still learns the control is not editable.
    expect(screen.getByText('Locked')).toBeTruthy()
    expect(screen.getByText('responses')).toBeTruthy()
  })

  it('sets the figure in mono with tabular figures, like every other reading', () => {
    renderIn('en', <AnonymityFloorReading />)

    const value = screen.getByText(String(ANONYMITY_FLOOR))
    expect(value.className).toContain('font-mono')
    expect(value.className).toContain('tabular-nums')
  })

  it('holds the reading in a box that grows rather than a fixed control height', () => {
    // The row carries three pieces of copy, two of them translated. Measured in
    // Chromium it does not wrap — Spanish at 420/390/360/320/300/280px, English
    // at 390 and 1440 — so this is not a defect being fixed, it is the fixed
    // height being removed before it becomes one, exactly as `SettingReadout`
    // had to. The minimum is a no-op: 32px stayed 32px at every width measured.
    renderIn('en', <AnonymityFloorReading />)

    const row = screen.getByText('Locked').parentElement!
    const classes = row.className.split(/\s+/)
    expect(classes).toContain('min-h-control-lg')
    // Split, not substring: `min-h-control-lg` contains `h-control-lg`.
    expect(classes).not.toContain('h-control-lg')
    expect(classes).toContain('py-1')
  })

  it('states both directions: a higher floor is accepted, a lower one refused', () => {
    renderIn('en', <AnonymityFloorReading />)

    const hint = screen.getByText(/higher floor is accepted/i)
    expect(hint.textContent).toMatch(/lower one is refused/i)
    expect(hint.textContent).toContain(String(ANONYMITY_FLOOR))
  })

  it('says the same in Spanish, with the same number', () => {
    renderIn('es', <AnonymityFloorReading />)

    expect(screen.getByText('Bloqueado')).toBeTruthy()
    expect(screen.getByText('respuestas')).toBeTruthy()
    const hint = screen.getByText(/umbral más alto/i)
    expect(hint.textContent).toMatch(/uno más bajo se rechaza/i)
    expect(hint.textContent).toContain(String(ANONYMITY_FLOOR))
  })
})

describe('AnonymityFloorNotice', () => {
  it('names the rule and states both directions', () => {
    renderIn('en', <AnonymityFloorNotice />)

    expect(screen.getByText('The anonymity floor cannot be lowered')).toBeTruthy()
    const body = screen.getByText(/No role, including the account owner/i)
    expect(body.textContent).toMatch(/Raising it is allowed/i)
    expect(body.textContent).toMatch(/lowering it is not/i)
    expect(body.textContent).toContain(String(ANONYMITY_FLOOR))
  })

  it('says the same in Spanish', () => {
    renderIn('es', <AnonymityFloorNotice />)

    expect(screen.getByText('El umbral de anonimato no se puede reducir')).toBeTruthy()
    const body = screen.getByText(/Ningún rol, ni siquiera el titular de la cuenta/i)
    expect(body.textContent).toMatch(/Subirlo está permitido/i)
    expect(body.textContent).toMatch(/bajarlo no/i)
    expect(body.textContent).toContain(String(ANONYMITY_FLOOR))
  })
})

describe('the promised floor is the enforced floor', () => {
  /**
   * The point of the whole panel. A settings page that advertises a floor the
   * suppression code does not apply is worse than one that says nothing, so the
   * number rendered is checked against the predicate's own behaviour rather than
   * against a literal repeated in this file: `ANONYMITY_FLOOR - 1` responses must
   * be withheld and `ANONYMITY_FLOOR` must not.
   */
  it('withholds one response below the number the page shows, and not at it', () => {
    renderIn('en', <AnonymityFloorReading />)
    const shown = Number(screen.getByText(String(ANONYMITY_FLOOR)).textContent)

    expect(Number.isNaN(shown)).toBe(false)
    expect(isSuppressed(shown - 1)).toBe(true)
    expect(isSuppressed(shown)).toBe(false)
  })
})
