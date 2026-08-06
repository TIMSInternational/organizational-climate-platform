/**
 * Fixture for noHardcodedStrings.test.ts — the `.ts` half.
 *
 * `__fixture__.tsx` proves the JSX rules. This file proves the rules that reach a
 * module with no JSX in it at all, which is the whole of #217: before it, a `.ts`
 * file could carry any amount of English and the guard swept only `.tsx`.
 *
 * It lives under src/i18n/ so the guard's own EXEMPT list skips it during the
 * repo-wide sweep; the test points at it explicitly instead.
 */

/**
 * Must NOT be flagged, and must come FIRST.
 *
 * A generic arrow with no trailing comma is valid `.ts` and a syntax error in
 * `.tsx` — `<T>` opens a JSX element that is never closed, so a TSX parse swallows
 * the rest of the file and every rule below finds nothing. That is the failure this
 * line exists to catch, and it only catches it from the top of the file. The
 * `<T,>` spelling is deliberately TSX-compatible and would prove nothing.
 */
export const identity = <T>(value: T): T => value

export interface NavRow {
  label: string
  href: string
}

export const ROWS: NavRow[] = [
  // Must be flagged: copy on a copy-shaped property. This is the exact shape
  // navSections.ts shipped untranslated.
  { label: 'Companies', href: '/admin/companies' },
  // Must NOT be flagged: `href` is not a copy prop, and a path is not copy.
  { label: 'System settings', href: '/admin/system-settings' },
]

/** Must be flagged: copy on a variable whose name says it is copy. */
export const emptyMessage = 'No results yet'

/** Must be flagged: a ternary of copy, same as the JSX rules accept. */
export const submitLabel = ROWS.length > 0 ? 'Save changes' : 'Nothing to save'

/** Must NOT be flagged: a catalogue path. `labelKey` does not end in `label`. */
export const labelKey = 'navigation.companies'

/** Must NOT be flagged: utility class lists, keyed by variant name. */
export const variants = {
  caption: 'text-xs leading-snug text-fg-tertiary',
  sectionLabel: 'text-2xs font-medium uppercase tracking-label text-fg-label',
}

/** Must NOT be flagged: an element name, keyed by the same variant name. */
export const elements = {
  caption: 'span',
  sectionLabel: 'span',
}

/** Must NOT be flagged: not a copy-shaped name, however English the value. */
export const config = {
  method: 'POST',
  status: 'pending_review',
}
