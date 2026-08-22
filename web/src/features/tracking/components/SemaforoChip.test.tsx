import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { TranslationProvider } from '../../../i18n'
import SemaforoChip from './SemaforoChip'
import { SEMAFORO_ORDER } from '../semaforo'

/**
 * §7 of the client's spec: colour alone is not a signal. Every state must carry a
 * shape AND an accessible name, and must survive a greyscale print.
 *
 * A screenshot is what actually proves the greyscale part — these pin the two
 * things a DOM test can see: that the word is there, and that the three states do
 * not share a glyph.
 */
function renderChip(estado: string) {
  return render(
    <TranslationProvider initialLocale="es">
      <SemaforoChip estado={estado} />
    </TranslationProvider>,
  )
}

function glyphPath(): string {
  const svg = document.querySelector('[data-slot="chip"] svg')
  return svg ? (svg.innerHTML ?? '') : ''
}

afterEach(cleanup)

describe('the semáforo chip', () => {
  it('names every state in words, not only in colour', () => {
    renderChip('Rojo')
    expect(screen.getByText('Atrasado')).toBeTruthy()
    cleanup()

    renderChip('Amarillo')
    expect(screen.getByText('En riesgo')).toBeTruthy()
    cleanup()

    renderChip('Verde')
    expect(screen.getByText('Al día')).toBeTruthy()
  })

  it.each([...SEMAFORO_ORDER])('renders %s as a word AND a glyph, never a colour alone', (estado) => {
    const { container } = renderChip(estado)
    const chip = container.querySelector('[data-slot="chip"]')

    expect(chip?.textContent?.trim(), 'no word').toBeTruthy()
    expect(chip?.querySelector('svg'), 'no glyph').toBeTruthy()
  })

  it('draws a DIFFERENT glyph for each state', () => {
    // Three coloured dots would pass a "has an icon" check and fail a photocopy.
    renderChip('Rojo')
    const rojo = glyphPath()
    cleanup()

    renderChip('Amarillo')
    const amarillo = glyphPath()
    cleanup()

    renderChip('Verde')
    const verde = glyphPath()

    expect(rojo).not.toBe('')
    expect(new Set([rojo, amarillo, verde]).size).toBe(3)
  })

  it('gives each state a different tone as the THIRD signal', () => {
    const classes = SEMAFORO_ORDER.map((estado) => {
      renderChip(estado)
      const className = document.querySelector('[data-slot="chip"]')?.className ?? ''
      cleanup()
      return className
    })
    expect(new Set(classes).size).toBe(SEMAFORO_ORDER.length)
  })

  /**
   * `EstadoSemaforo` is a C# enum and could gain a member. A chip that painted an
   * unknown state green would be a confidently wrong reading for an audience with no
   * way to challenge it, so the neutral tone — the one that claims nothing — carries
   * the server's own word instead.
   */
  it('renders an unknown state as neutral and shows the raw value', () => {
    renderChip('Naranja')
    expect(screen.getByText('Naranja')).toBeTruthy()
    expect(document.querySelector('[data-slot="chip"]')?.className).toContain('chip-neutral')
  })

  it('falls back to translated copy when the state is not even a word', () => {
    renderChip('')
    expect(screen.getByText('Estado desconocido')).toBeTruthy()
  })
})
