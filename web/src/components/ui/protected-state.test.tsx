import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { TranslationProvider } from '../../i18n'
import en from '../../i18n/en.json'
import es from '../../i18n/es.json'
import { ProtectedState } from './protected-state'

afterEach(cleanup)

function renderIn(locale: 'es' | 'en', floor: number | null | undefined) {
  return render(
    <TranslationProvider initialLocale={locale}>
      <ProtectedState floor={floor} />
    </TranslationProvider>,
  )
}

describe('ProtectedState', () => {
  it('shows a padlock and "Menos de {floor}" with the floor it is given', () => {
    const { container } = renderIn('es', 3)
    const root = container.querySelector('[data-slot="protected-state"]') as HTMLElement
    expect(root.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByText(es.ui.protected.short.replace('{floor}', '3'))).toBeTruthy()
  })

  it('prints the floor from the payload, never a constant', () => {
    // A company that raised its floor, and an administrator's single-department floor.
    renderIn('es', 5)
    expect(screen.getByText('Menos de 5')).toBeTruthy()
    cleanup()
    renderIn('es', 1)
    expect(screen.getByText('Menos de 1')).toBeTruthy()
  })

  it('reads a full sentence to assistive technology and hides the fragment', () => {
    const { container } = renderIn('es', 3)
    const visible = screen.getByText('Menos de 3')
    expect(visible.getAttribute('aria-hidden')).toBe('true')
    const spoken = container.querySelector('.sr-only') as HTMLElement
    expect(spoken.textContent).toBe(es.ui.protected.long.replace('{floor}', '3'))
  })

  it('uses the singular sentence for a floor of one', () => {
    const { container } = renderIn('es', 1)
    expect(container.querySelector('.sr-only')?.textContent).toBe(es.ui.protected.longOne.replace('{floor}', '1'))
  })

  it('fails closed on a floor the payload did not carry: no figure at all', () => {
    for (const floor of [undefined, null, Number.NaN, 0, -3, 2.5]) {
      const { container } = renderIn('es', floor)
      const text = container.textContent ?? ''
      expect(text, String(floor)).not.toMatch(/\d|NaN|undefined|null/)
      expect(screen.getByText(es.ui.protected.noFloor)).toBeTruthy()
      cleanup()
    }
  })

  it('never renders a figure other than the floor — there is no count to render', () => {
    // The component takes no count: the only digits in it are the floor's.
    const { container } = renderIn('es', 3)
    const digits = (container.textContent ?? '').match(/\d+/g) ?? []
    expect(digits.length).toBeGreaterThan(0)
    expect(new Set(digits)).toEqual(new Set(['3']))
  })

  it('speaks English from the English catalogue', () => {
    renderIn('en', 3)
    expect(screen.getByText(en.ui.protected.short.replace('{floor}', '3'))).toBeTruthy()
  })
})
