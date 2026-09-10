import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import QualityScoreReading from './QualityScoreReading'
import { TranslationProvider, type Locale } from '../../../i18n'

function renderReading(value: number | null, locale: Locale) {
  return render(
    <TranslationProvider initialLocale={locale}>
      <span data-testid="reading">
        <QualityScoreReading value={value} />
      </span>
    </TranslationProvider>,
  )
}

afterEach(() => {
  // No `globals: true` in vite.config.ts, so RTL's auto-cleanup never registers.
  cleanup()
})

/**
 * `qualityScore` is `null` until the rule has run and exactly 0 when the rule scored a
 * benchmark that measures nothing. The two used to be indistinguishable — the API's old
 * column default was 0 — and the list printed "0,00" over every reference nobody had
 * validated. These pin both halves: a zero is a number, a null is a labelled dash.
 */
describe('QualityScoreReading', () => {
  it('prints a computed zero as a number, at two decimals, in the reader\'s locale', () => {
    renderReading(0, 'es')
    expect(screen.getByTestId('reading').textContent).toBe('0,00')
  })

  it('prints a score at two decimals, localised', () => {
    renderReading(76.7, 'es')
    expect(screen.getByTestId('reading').textContent).toBe('76,70')
  })

  it('renders a score nobody has computed as a dash the eye sees and a sentence a screen reader hears', () => {
    renderReading(null, 'es')
    const reading = screen.getByTestId('reading')

    expect(reading.textContent).not.toContain('0,00')
    // The glyph is hidden from assistive technology; the sentence is hidden from the eye.
    const dash = reading.querySelector('[aria-hidden="true"]')
    expect(dash?.textContent).toBe('—')
    const label = screen.getByText('Aún sin puntaje')
    expect(label.className).toContain('sr-only')
    expect(label.getAttribute('aria-hidden')).toBeNull()
  })

  it('labels the dash in English too', () => {
    renderReading(null, 'en')
    expect(screen.getByText('Not scored yet').className).toContain('sr-only')
  })
})
