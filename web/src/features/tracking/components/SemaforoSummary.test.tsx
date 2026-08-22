import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { TranslationProvider } from '../../../i18n'
import SemaforoSummary from './SemaforoSummary'
import { SEMAFORO_ORDER, semaforoPresentation } from '../semaforo'
import { CATALOGUES } from '../../../i18n/locale'
import type { MessageNode } from '../../../i18n/translate'

/**
 * The strip is the FIRST thing a reader sees on every tracking screen, and until
 * this file existed it was the one place in the module with no test at all.
 *
 * That gap was not theoretical. The component carried its own hardcoded icon map,
 * so the shape guarantee in `semaforo.test.ts` — three distinct silhouettes —
 * covered the chips in the table below and not the strip above them. The whole
 * strip could be reduced to three bare coloured dots, no word and no shape, and
 * the suite stayed green. WCAG 1.4.1 and the client's §7 both fail on exactly that
 * reduction, and it is the element that ends up in a printed, greyscale report.
 *
 * So these assert the redundancy itself rather than the markup: a WORD per state,
 * a DIFFERENT silhouette per state, and a tone that is only ever the third signal.
 */
const counts = { rojo: 3, amarillo: 2, verde: 5 }

function renderSummary(props: Partial<React.ComponentProps<typeof SemaforoSummary>> = {}) {
  return render(
    <TranslationProvider initialLocale="es">
      <SemaforoSummary counts={counts} {...props} />
    </TranslationProvider>,
  )
}

function copy(path: string): string {
  const value = path
    .split('.')
    .reduce<MessageNode | undefined>(
      (node, segment) => (typeof node === 'object' && node !== null ? node[segment] : undefined),
      CATALOGUES.es as MessageNode,
    )
  return typeof value === 'string' ? value : ''
}

afterEach(cleanup)

describe('the semáforo summary strip', () => {
  it('shows the count for every state', () => {
    renderSummary()
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.getByText('5')).toBeTruthy()
  })

  it('reads each count off its OWN state, not off a shared field', () => {
    // A tile that read `counts.rojo` for all three would still render three
    // numbers and still typecheck — every field on `SemaforoCounts` is a `number`.
    const { container } = renderSummary({ counts: { rojo: 11, amarillo: 22, verde: 33 } })
    const tiles = [...container.querySelectorAll('[data-slot="semaforo-tile"]')]
    expect(tiles).toHaveLength(SEMAFORO_ORDER.length)

    SEMAFORO_ORDER.forEach((estado, index) => {
      const expected = { Rojo: '11', Amarillo: '22', Verde: '33' }[estado]
      expect(tiles[index]?.textContent, `${estado} tile`).toContain(expected)
    })
  })

  /**
   * The mutation this closes: replace every tile's chip with a coloured dot.
   * Without the word, colour is the only carrier and the strip fails 1.4.1.
   */
  it('names every state in WORDS, so colour is never the only carrier', () => {
    renderSummary()
    for (const estado of SEMAFORO_ORDER) {
      const word = copy(semaforoPresentation(estado).labelKey)
      expect(word, `no catalogue entry for ${estado}`).not.toBe('')
      expect(screen.getAllByText(word).length, `"${word}" is not on the strip`).toBeGreaterThan(0)
    }
  })

  /**
   * The other half of the same mutation: three dots share one silhouette, so a
   * greyscale print collapses the three states into one mark.
   */
  it('draws a DIFFERENT silhouette in every tile, which is what survives a photocopy', () => {
    const { container } = renderSummary()
    const glyphs = [...container.querySelectorAll('[data-slot="semaforo-tile"] svg')].map(
      (svg) => svg.innerHTML,
    )

    expect(glyphs).toHaveLength(SEMAFORO_ORDER.length)
    expect(glyphs.every((glyph) => glyph.trim() !== ''), 'a tile has no glyph').toBe(true)
    expect(new Set(glyphs).size, 'two tiles share a silhouette').toBe(SEMAFORO_ORDER.length)
  })

  it('explains what each state MEANS, not only what it is called', () => {
    renderSummary()
    for (const estado of SEMAFORO_ORDER) {
      const sub = copy(semaforoPresentation(estado).subKey)
      expect(sub, `no catalogue entry for ${estado}'s sub-line`).not.toBe('')
      expect(screen.getAllByText(sub).length, `"${sub}" is not on the strip`).toBeGreaterThan(0)
    }
  })

  it('is a named group, so the four numbers are not a bare list', () => {
    renderSummary()
    expect(screen.getByLabelText(copy('tracking.semaforo.summaryLabel'))).toBeTruthy()
  })

  describe('the total', () => {
    it('derives it from the three counts when the payload carries none', () => {
      // The tablero has no `totalPlanes` field at all.
      renderSummary()
      expect(screen.getByText('10')).toBeTruthy()
    })

    it("prefers the server's own total when there is one", () => {
      renderSummary({ total: 10 })
      expect(screen.getByText('10')).toBeTruthy()
      expect(document.querySelector('[data-slot="semaforo-partial"]')).toBeNull()
    })

    /**
     * `TotalPlanes` is `g.Count()`; `CountSemaforo` tallies three states. They
     * agree only while `EstadoSemaforo` has exactly three members. A fourth state
     * makes the KPI strip silently disagree with the table underneath it — 10
     * plans above, nine accounted for below — and neither number is wrong, so
     * nothing would ever flag it.
     */
    it('says so when the three counts do not account for the server total', () => {
      renderSummary({ total: 12 })
      const note = document.querySelector('[data-slot="semaforo-partial"]')
      expect(note, 'no disclosure when counts and total disagree').toBeTruthy()
      expect(note?.textContent).toContain('10')
      expect(note?.textContent).toContain('12')
    })
  })
})
