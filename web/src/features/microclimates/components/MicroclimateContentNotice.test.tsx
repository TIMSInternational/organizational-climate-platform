import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import MicroclimateContentNotice from './MicroclimateContentNotice'
import { TranslationProvider } from '../../../i18n'
import es from '../../../i18n/es.json'

/**
 * The language notice above a microclimate's questions: the neutral card the survey
 * respond page uses, saying one thing once — not a blue box that says it twice.
 */
function renderNotice(resolvedLocale: string, fallbackFields: readonly string[] = []) {
  return render(
    <TranslationProvider initialLocale="es">
      <MicroclimateContentNotice language={resolvedLocale} resolvedLocale={resolvedLocale} fallbackFields={fallbackFields} />
    </TranslationProvider>,
  )
}

afterEach(cleanup)

describe('MicroclimateContentNotice', () => {
  it('draws the neutral card, never the blue information box', () => {
    renderNotice('en')
    const alert = document.querySelector<HTMLElement>('[data-slot="alert"]')
    expect(alert?.getAttribute('data-variant')).toBe('warning')
    expect(screen.getByText(es.microclimates.contentFallbackTitle)).toBeTruthy()
  })

  it('says a substituted session once, in one sentence, with the language in lower case', () => {
    renderNotice('en', ['title', 'questions[0].text'])
    const body = document.querySelector('[data-slot="alert-description"]')
    expect(body?.textContent).toBe('Este microclima se muestra en inglés, porque es el idioma en que fue redactado.')
    // The old box repeated it: "Mostrando el contenido en …" and "Este microclima está redactado en …".
    expect(screen.queryByText(/Mostrando el contenido/)).toBeNull()
    expect(screen.queryByText(/está redactado en/)).toBeNull()
  })

  it('names only the fields that fell back when the session itself is in the reader’s language', () => {
    renderNotice('es', ['questions[2].text'])
    const body = document.querySelector('[data-slot="alert-description"]')
    expect(body?.textContent).toBe(es.microclimates.contentFallbackFields)
  })

  it('draws nothing when nothing was substituted', () => {
    renderNotice('es')
    expect(document.querySelector('[data-slot="alert"]')).toBeNull()
  })
})
