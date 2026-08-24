import { describe, it, expect } from 'vitest'
import { CATALOGUES, LOCALES } from '../../../i18n/locale'
import type { MessageNode } from '../../../i18n/translate'
import {
  CONSENT_LABEL_PATH,
  ERASURE_ANONYMISED_TABLES,
  ERASURE_DELETED_TABLES,
  ERASURE_LABEL_PATHS,
  ERASURE_REDACTED_TABLES,
} from './privacyScope'
import { exportTreatmentLabelPath, subjectLinkLabelPath } from '../api/gdpr'

/**
 * The catalogue paths the privacy page looks up **dynamically**.
 *
 * `i18n/keysExist.test.ts` walks the AST for `t('literal')` calls and skips anything
 * computed, which is every lookup on this page: the consent flag labels are keyed by the
 * column name the API sent, the erasure lists by table name, and the two enum labels come
 * back from a function. A typo in any of those maps renders the raw dotted path on screen
 * in both languages, and the existing three i18n guards see none of it — parity says the
 * catalogues agree with each other, not that the code asks for keys either one holds.
 *
 * So this is the fourth leg, for one page: every path these lookups can produce must
 * resolve to a string in every locale.
 */

function resolves(locale: (typeof LOCALES)[number], path: string): boolean {
  let node: MessageNode | undefined = CATALOGUES[locale] as MessageNode
  for (const segment of path.split('.')) {
    if (typeof node !== 'object' || node === null || !Object.hasOwn(node, segment)) return false
    node = node[segment]
  }
  return typeof node === 'string' && node.trim() !== ''
}

/** Every path the page can hand to `t` without a literal at the call site. */
function dynamicPaths(): string[] {
  const enums = [0, 1, 2, 3]
    .flatMap((value) => [subjectLinkLabelPath(value), exportTreatmentLabelPath(value)])
    .filter((path): path is string => path !== null)

  return [...new Set([...Object.values(CONSENT_LABEL_PATH), ...Object.values(ERASURE_LABEL_PATHS), ...enums])]
}

describe('privacy page copy', () => {
  it('has paths to check', () => {
    // Guard the guard: an empty list would make every assertion below vacuous.
    expect(dynamicPaths().length).toBeGreaterThan(15)
  })

  it.each(LOCALES)('resolves every dynamically-looked-up path in %s', (locale) => {
    const missing = dynamicPaths().filter((path) => !resolves(locale, path))
    expect(missing).toEqual([])
  })

  /**
   * Every table the erasure lists name has a description beside it. A table with no copy
   * still renders (as its bare table name) rather than vanishing, which is the right
   * runtime behaviour — but shipping one that way is not, and nothing else would notice.
   */
  it('describes every table it lists', () => {
    const listed = [
      ...ERASURE_DELETED_TABLES,
      ...ERASURE_ANONYMISED_TABLES,
      ...ERASURE_REDACTED_TABLES,
    ]
    const undescribed = listed.filter((table) => ERASURE_LABEL_PATHS[table] === undefined)
    expect(undescribed).toEqual([])
  })

  /**
   * The six consent columns `UserConsent` declares. Derived reading means an unknown
   * seventh renders as its raw column name, which is deliberate — but the six that exist
   * today must not be relying on that fallback.
   */
  it('names every consent column the server ships', () => {
    expect(Object.keys(CONSENT_LABEL_PATH).sort()).toEqual([
      'Analytics',
      'Demographics',
      'Essential',
      'Marketing',
      'Personalization',
      'ThirdParty',
    ])
  })
})
