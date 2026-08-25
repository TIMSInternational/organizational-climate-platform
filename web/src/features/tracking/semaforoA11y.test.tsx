import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { TranslationProvider } from '../../i18n'
import { expectNoAxeViolations } from '../../test/a11y'
import { SEMAFORO_ORDER, semaforoPresentation } from './semaforo'
import SemaforoChip from './components/SemaforoChip'
import SemaforoSummary from './components/SemaforoSummary'

/**
 * The semáforo under the #83 baseline.
 *
 * It gets its own file rather than a row in `components/ui/a11y.axe.test.tsx`
 * because it is not a `ui/` primitive — it is the client's §7 contract item, the
 * single mark a reader with 30+ years' tenure and low digital literacy is expected
 * to learn once and meet everywhere, on screens that get printed in greyscale.
 *
 * `semaforo.test.ts`, `semaforoTable.test.ts` and `components/SemaforoChip.test.tsx`
 * already pin the three signals (a distinct silhouette, a Spanish word, and the
 * tone third) and that there is exactly one icon map. What was missing was the
 * machine check: that the mark is *announced*, and that the strip a leader reads
 * first is a named list rather than four numbers with nothing to tell them apart.
 * Both are assertions about the accessibility tree, which is what axe reads and
 * what none of those files touch.
 */

afterEach(cleanup)

const COUNTS = { rojo: 3, amarillo: 2, verde: 5 }

function withLocale(node: React.ReactNode) {
  return render(<TranslationProvider initialLocale="es">{node}</TranslationProvider>)
}

describe('the semáforo is announced, not only drawn', () => {
  it('gives every state an accessible name in Spanish', () => {
    withLocale(
      <>
        {SEMAFORO_ORDER.map((estado) => (
          <SemaforoChip key={estado} estado={estado} />
        ))}
      </>,
    )

    // Read out of the DOM by text, not by the label key — a chip that rendered its
    // catalogue path, or nothing at all, would satisfy an assertion made against
    // `presentation.labelKey` and fail a reader.
    const names = SEMAFORO_ORDER.map((estado) => semaforoPresentation(estado).labelKey)
    expect(new Set(names).size, 'two states share a label key').toBe(SEMAFORO_ORDER.length)

    for (const word of ['Atrasado', 'En riesgo', 'Al día']) {
      expect(screen.getByText(word), `no chip is announced as "${word}"`).toBeTruthy()
    }
  })

  it('passes axe — the chips', async () => {
    const { container } = withLocale(
      <>
        {SEMAFORO_ORDER.map((estado) => (
          <SemaforoChip key={estado} estado={estado} />
        ))}
        {/* And the state this build has never heard of, which renders neutral with
            the raw wire value rather than being coloured green. */}
        <SemaforoChip estado="Morado" />
      </>,
    )
    await expectNoAxeViolations(container, 'SemaforoChip, every state')
  })

  it('passes axe — the summary strip, and it is a NAMED list', async () => {
    const { container } = withLocale(<SemaforoSummary counts={COUNTS} total={10} />)
    await expectNoAxeViolations(container, 'SemaforoSummary')

    // The strip is four tiles of numbers. Without a name on the list, a screen
    // reader announces "list, 4 items" and then four integers — the counts, with
    // nothing saying which state each belongs to.
    const list = screen.getByRole('list')
    expect(list.getAttribute('aria-label')).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(SEMAFORO_ORDER.length + 1)
  })

  it('every glyph is hidden from the reader, so no state is announced twice', () => {
    const { container } = withLocale(<SemaforoChip estado="Rojo" />)
    const svgs = container.querySelectorAll('svg')
    expect(svgs.length, 'the chip drew no glyph at all').toBeGreaterThan(0)
    for (const svg of svgs) {
      // `ui/chip.tsx` wraps the icon in an `aria-hidden` span; the word beside it
      // already says the state, and a reader that heard both would hear "Atrasado
      // Atrasado".
      expect(svg.closest('[aria-hidden="true"]'), 'a semáforo glyph is exposed to the reader').not.toBeNull()
    }
  })
})
