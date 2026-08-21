import { describe, it, expect } from 'vitest'
import { CATALOGUES, LOCALES } from '../../i18n/locale'
import type { MessageNode } from '../../i18n/translate'

/**
 * **The tracking module renders in Spanish, in every locale.**
 *
 * #126's acceptance criteria end with "Rendered in Spanish", and that cannot be
 * satisfied by putting Spanish in `es.json` alone: the app locale is the reader's
 * own setting (`i18n/locale.ts`), so an English-speaking administrator of the same
 * tenant would get an English tracking module and the criterion would hold for
 * some users and not others.
 *
 * It is also not satisfiable by hardcoding the strings into the `.tsx` files —
 * `i18n/noHardcodedStrings.test.ts` sweeps `src/` and fails any user-facing
 * literal, and `catalogues.test.ts` requires exact key parity between locales.
 *
 * So the copy goes in the catalogues, in Spanish, IDENTICALLY IN BOTH. That is a
 * deliberate decision and this test is what stops it being "fixed" by a
 * well-meaning later pass that translates `tracking.*` into English and silently
 * breaks the criterion. It is also the honest shape of the module: this is a
 * Spanish-language product surface for one client, and its own domain vocabulary
 * is Spanish end to end — `planes-accion`, `mis-tareas`, `semáforo`,
 * `involucrados`, `hallazgo`, `porcentaje_avance` — on both sides of the wire.
 *
 * If tracking is ever offered to a tenant that wants it in another language, this
 * test is the thing to delete, along with a per-locale translation of the whole
 * namespace. Until then, deleting it silently would let the module drift out of
 * the one language its users read.
 */
function leafPaths(node: MessageNode, prefix = ''): string[] {
  if (typeof node === 'string') return [prefix]
  return Object.entries(node).flatMap(([key, child]) =>
    leafPaths(child, prefix ? `${prefix}.${key}` : key),
  )
}

function lookup(node: MessageNode, path: string): string {
  let current: MessageNode | undefined = node
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null) return ''
    current = current[segment]
  }
  return typeof current === 'string' ? current : ''
}

const REFERENCE = CATALOGUES.es.tracking as MessageNode

describe('the tracking namespace', () => {
  it('exists in every locale', () => {
    for (const locale of LOCALES) {
      expect(CATALOGUES[locale].tracking, `no tracking namespace in ${locale}`).toBeTruthy()
    }
  })

  it('is the SAME Spanish copy in every locale', () => {
    const paths = leafPaths(REFERENCE)
    expect(paths.length).toBeGreaterThan(40)

    for (const locale of LOCALES) {
      const catalogue = CATALOGUES[locale].tracking as MessageNode
      for (const path of paths) {
        expect(lookup(catalogue, path), `tracking.${path} differs in ${locale}`).toBe(
          lookup(REFERENCE, path),
        )
      }
    }
  })

  it('is actually Spanish, not English that happens to match', () => {
    // A cheap but real check: the module's own vocabulary. If someone translates
    // this namespace, these go first.
    const all = leafPaths(REFERENCE)
      .map((path) => lookup(REFERENCE, path))
      .join(' ')
    for (const word of ['semáforo', 'avance', 'Involucrados', 'jefatura', 'plan']) {
      expect(all.toLocaleLowerCase()).toContain(word.toLocaleLowerCase())
    }
  })
})
