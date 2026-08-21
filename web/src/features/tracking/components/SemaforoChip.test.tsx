import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { TranslationProvider } from '../../../i18n'
import SemaforoChip from './SemaforoChip'

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
    <TranslationProvider>
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

  it('renders an unknown state as neutral and shows the raw value', () => {
    // `EstadoSemaforo` serialises as an open string. A fourth state must not be
    // quietly coloured as one of the three this build knows.
    renderChip('Naranja')
    expect(screen.getByText('Naranja')).toBeTruthy()
    expect(document.querySelector('[data-slot="chip"]')?.className).toContain('chip-neutral')
  })
})
