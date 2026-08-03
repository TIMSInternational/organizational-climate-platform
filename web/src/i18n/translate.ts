/**
 * The pure half of the translation layer: no React, no storage, no globals, so it
 * can be tested directly.
 */

export type Locale = 'en' | 'es'

/** A catalogue is an arbitrarily nested tree of strings. */
export type MessageNode = string | { [key: string]: MessageNode }
export type Messages = Record<string, MessageNode>

/** Values allowed as `{placeholder}` substitutions. */
export type TranslateParams = Record<string, string | number>

export type TranslateFn = (key: string, params?: TranslateParams) => string

/** Walks a dot-separated path, returning the string leaf or null. */
function lookup(messages: Messages, key: string): string | null {
  let node: MessageNode | undefined = messages

  for (const segment of key.split('.')) {
    // `Object.hasOwn`, not `in`: `'constructor' in {}` is true via the prototype
    // chain, so `in` would happily walk into Object internals for a key like
    // `common.toString`.
    if (typeof node !== 'object' || node === null || !Object.hasOwn(node, segment)) return null
    node = node[segment]
  }

  // A path that stops on a subtree rather than a leaf is a caller error, not a
  // translation — treat it as a miss.
  return typeof node === 'string' ? node : null
}

/** Substitutes `{name}` placeholders, leaving unknown ones untouched. */
function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    // A missing param leaves `{name}` visible on purpose: silently emitting an
    // empty string hides the bug, whereas the braces show up in review.
    Object.hasOwn(params, name) ? String(params[name]) : match,
  )
}

/**
 * Builds a `t` for one locale.
 *
 * Missing keys fall back to `fallback` before giving up and returning the key
 * itself. That matters concretely: the legacy `es.json` was missing 8 `surveys.*`
 * keys that `en.json` had, so a Spanish user would have seen raw key paths. The
 * catalogues are aligned now, and this keeps the next such gap merely imperfect
 * rather than broken.
 */
export function createTranslator(messages: Messages, fallback?: Messages): TranslateFn {
  return (key, params) => {
    const hit = lookup(messages, key) ?? (fallback ? lookup(fallback, key) : null)
    return hit === null ? key : interpolate(hit, params)
  }
}
