import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The one thing on this page that no rendering test can see.
 *
 * ## The defect
 *
 * `DataAccessPanel` renders a six-column table inside a card, inside a grid. A grid
 * item's automatic minimum size is its content's **min-content** width, and this table's
 * min-content is large: `TableHead` is `whitespace-nowrap` and the first column holds
 * unbreakable identifiers like `question_responses`. So the grid track sizes itself to the
 * table, the card grows with it, and the whole page — every card, including the page
 * title's own description, which is nowhere near a table — is pushed wider than the
 * viewport and clipped on the right.
 *
 * Measured in a real browser at 390px before the fix: the page top bar's right edge moved
 * from 361px to **392px** the moment the export arrived. After it: 361px in both states,
 * with the table scrolling inside its own `overflow-x-auto` container as intended.
 *
 * `Table`'s own scroll container does not prevent this. It lets the table scroll; it does
 * not give the *ancestor* permission to be narrower than its contents. That permission is
 * `min-w-0`, and it has to sit on the grid item.
 *
 * ## Why this test is a source read and not a render
 *
 * Vitest runs on happy-dom (`vite.config.ts`), which has no layout engine: `getBoundingClientRect`
 * returns zeroes, so an assertion about widths is unwritable here — the same limitation
 * `src/styles/tableOverflow.test.ts` records for the identical class of bug, and for which
 * it too falls back to inspecting the cascade and the call sites rather than measuring.
 *
 * So this asserts the fix is *present*, which is the part that a later edit would silently
 * remove. It is deliberately narrow: it does not claim the page lays out correctly, only
 * that the class the browser measurement showed to be load-bearing has not been deleted.
 * The real verification is a screenshot, and that is a human step.
 */

const PANEL = join(process.cwd(), 'src/features/profile/components/DataAccessPanel.tsx')

/**
 * The `className` of every `<section>` in the file, in source order.
 *
 * A section is where the fix belongs: it is the grid item of `CardContent`'s grid, and the
 * nearest ancestor of the table that is allowed to carry a class of its own.
 */
function sectionClassNames(source: string): string[] {
  return [...source.matchAll(/<section\s+className="([^"]*)"/g)].map((m) => m[1])
}

describe('the privacy export panel may be narrower than its table', () => {
  const source = readFileSync(PANEL, 'utf8')

  it('reads a file that still renders sections and a table', () => {
    // Guard the guard. A renamed component or a reshaped element would make every
    // assertion below vacuous rather than red, which is the one way this file could be
    // useless while green.
    expect(source).toContain('<SectionTable')
    expect(sectionClassNames(source).length).toBeGreaterThan(2)
  })

  it('lets every section that renders a table shrink below its content', () => {
    // The sections that can contain a table are exactly the ones whose JSX mentions one.
    // Split on the section open tags and keep the chunks that render a SectionTable.
    const chunks = source.split(/<section\s+className="/).slice(1)
    const tableSections = chunks
      .map((chunk) => ({
        className: chunk.slice(0, chunk.indexOf('"')),
        rendersTable: chunk.slice(0, chunk.indexOf('</section>')).includes('<SectionTable'),
      }))
      .filter((s) => s.rendersTable)

    expect(tableSections.length).toBeGreaterThan(0)

    const unshrinkable = tableSections
      .filter((s) => !s.className.split(/\s+/).includes('min-w-0'))
      .map((s) => s.className)

    expect(unshrinkable).toEqual([])
  })
})
