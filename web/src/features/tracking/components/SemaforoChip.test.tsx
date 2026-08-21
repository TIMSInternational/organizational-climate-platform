import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import SemaforoChip from './SemaforoChip'
import { TranslationProvider } from '../../../i18n'
import { SEMAFORO_ESTADOS } from '../semaforo'

afterEach(cleanup)

function renderChip(estado: string) {
  return render(
    <TranslationProvider initialLocale="es">
      <SemaforoChip estado={estado} />
    </TranslationProvider>,
  )
}

describe('SemaforoChip', () => {
  it.each([...SEMAFORO_ESTADOS])('renders %s as a word and a glyph, never a colour alone', (estado) => {
    const { container } = renderChip(estado)
    const chip = container.querySelector('[data-slot="chip"]')

    expect(chip?.textContent?.trim()).toBe(estado)
    expect(chip?.querySelector('svg'), 'no glyph').toBeTruthy()
  })

  it('draws a different glyph for each state, so greyscale still separates them', () => {
    const drawings = SEMAFORO_ESTADOS.map((estado) => {
      const { container } = renderChip(estado)
      const svg = container.querySelector('[data-slot="chip"] svg')?.innerHTML
      cleanup()
      return svg
    })
    expect(new Set(drawings).size).toBe(SEMAFORO_ESTADOS.length)
  })

  /**
   * `EstadoSemaforo` is a C# enum and could gain a member. A chip that painted an
   * unknown state green would be a confidently wrong reading for an audience with no
   * way to challenge it, so the neutral tone — the one that claims nothing — carries
   * the server's own word instead.
   */
  it('shows an unknown state neutrally, with the server word and no borrowed meaning', () => {
    const { container } = renderChip('Azul')
    const chip = container.querySelector('[data-slot="chip"]')

    expect(chip?.textContent?.trim()).toBe('Azul')
    expect(chip?.querySelector('svg')).toBeNull()
    expect(chip?.className).toContain('chip-neutral')
  })

  it('falls back to translated copy when the state is not even a word', () => {
    renderChip('')
    expect(screen.getByText('Estado desconocido')).toBeTruthy()
  })
})
