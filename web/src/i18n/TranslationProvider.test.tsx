import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TranslationProvider from './TranslationProvider'
import { useTranslation } from './useTranslation'
import { LOCALE_STORAGE_KEY } from './locale'
import LanguageSwitcher from './LanguageSwitcher'

function Probe() {
  const { locale, t } = useTranslation()
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="save">{t('common.save')}</span>
    </div>
  )
}

function ScopedProbe() {
  const { t } = useTranslation('common')
  return <span data-testid="scoped">{t('save')}</span>
}

describe('TranslationProvider', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    cleanup()
  })

  it('provides translations for the initial locale', () => {
    render(
      <TranslationProvider initialLocale="en">
        <Probe />
      </TranslationProvider>,
    )
    expect(screen.getByTestId('save').textContent).toBe('Save')
  })

  it('serves Spanish when the locale is es', () => {
    render(
      <TranslationProvider initialLocale="es">
        <Probe />
      </TranslationProvider>,
    )
    expect(screen.getByTestId('save').textContent).toBe('Guardar')
  })

  it('scopes keys to a namespace', () => {
    render(
      <TranslationProvider initialLocale="es">
        <ScopedProbe />
      </TranslationProvider>,
    )
    expect(screen.getByTestId('scoped').textContent).toBe('Guardar')
  })

  it('picks up a stored preference when no initial locale is given', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    render(
      <TranslationProvider>
        <Probe />
      </TranslationProvider>,
    )
    expect(screen.getByTestId('locale').textContent).toBe('es')
  })

  it('sets document lang so assistive tech reads the right language', () => {
    render(
      <TranslationProvider initialLocale="es">
        <Probe />
      </TranslationProvider>,
    )
    expect(document.documentElement.lang).toBe('es')
  })

  it('throws when used outside a provider', () => {
    // React logs the thrown error; the assertion is that it throws at all.
    expect(() => render(<Probe />)).toThrow(/must be used inside a TranslationProvider/)
  })

  describe('switching language', () => {
    it('re-renders in the new language without a reload, and persists the choice', async () => {
      const user = userEvent.setup()
      render(
        <TranslationProvider initialLocale="en">
          <LanguageSwitcher />
          <Probe />
        </TranslationProvider>,
      )

      expect(screen.getByTestId('save').textContent).toBe('Save')

      await user.selectOptions(screen.getByRole('combobox'), 'es')

      // Same mounted tree, new strings — no navigation, no reload.
      expect(screen.getByTestId('save').textContent).toBe('Guardar')
      expect(screen.getByTestId('locale').textContent).toBe('es')
      expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('es')
      expect(document.documentElement.lang).toBe('es')
    })

    it('labels its own options in the active language', async () => {
      const user = userEvent.setup()
      render(
        <TranslationProvider initialLocale="en">
          <LanguageSwitcher />
        </TranslationProvider>,
      )

      expect(screen.getByRole('option', { name: 'Spanish' })).toBeTruthy()

      await user.selectOptions(screen.getByRole('combobox'), 'es')

      // The switcher is itself translated, so after switching the options read
      // "Inglés" / "Español".
      expect(screen.getByRole('option', { name: 'Español' })).toBeTruthy()
      expect(screen.getByRole('option', { name: 'Inglés' })).toBeTruthy()
    })
  })
})
