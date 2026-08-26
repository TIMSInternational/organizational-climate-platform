import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { TranslationProvider } from '../../i18n'
import { expectNoAxeViolations } from '../../test/a11y'
import { SEMAFORO_ORDER, semaforoPresentation, type SemaforoEstado } from './semaforo'
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

/**
 * The word each state must be announced by, in the locale the client reads.
 *
 * Literal on purpose: derived from `semaforoPresentation(estado).labelKey` it would
 * be the same lookup the component makes, and any swap of the two would agree with
 * itself. These three strings are the contract — "Atrasado" is what a leader is
 * told when a plan is red.
 */
const ANNOUNCED: Record<SemaforoEstado, string> = {
  Rojo: 'Atrasado',
  Amarillo: 'En riesgo',
  Verde: 'Al día',
}

describe('the semáforo is announced, not only drawn', () => {
  it('announces each state by its OWN Spanish word', () => {
    // One chip at a time. Rendered together and asserted with three
    // `getByText`s, this passed for any PERMUTATION of the three words — including
    // the one that tells a leader a red plan is on track — because all three
    // strings were somewhere on the screen either way. The claim is state ↔ word,
    // so the render has to be state ↔ word too.
    for (const estado of SEMAFORO_ORDER) {
      const { container, unmount } = withLocale(<SemaforoChip estado={estado} />)
      expect(container.textContent?.trim(), `${estado} is not announced as "${ANNOUNCED[estado]}"`).toBe(
        ANNOUNCED[estado],
      )
      unmount()
    }

    // The table covers every state there is, and no two states share a word or a
    // key — otherwise "its own word" would be satisfied by one word for all three.
    expect(Object.keys(ANNOUNCED).sort()).toEqual([...SEMAFORO_ORDER].sort())
    expect(new Set(Object.values(ANNOUNCED)).size, 'two states share a word').toBe(SEMAFORO_ORDER.length)
    const keys = SEMAFORO_ORDER.map((estado) => semaforoPresentation(estado).labelKey)
    expect(new Set(keys).size, 'two states share a label key').toBe(SEMAFORO_ORDER.length)
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
