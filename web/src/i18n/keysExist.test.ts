import { describe, it, expect } from 'vitest'
import { readFileSync, globSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { CATALOGUES, LOCALES } from './locale'
import type { Messages, MessageNode } from './translate'

/**
 * Guard against `t()` being handed a key no catalogue has.
 *
 * `createTranslator` returns the key itself on a miss (`translate.ts`), which is the
 * right runtime behaviour — a visible `surveys.reviewQuestionCount` beats a silent
 * blank — but nothing failed when it happened. Three sites shipped that way across the
 * UI redesign lanes and rendered a raw dotted path on screen in **both** languages:
 *
 * - `SurveyTemplateCard` and `SurveyList` both asked for `surveys.reviewQuestionCount`
 *   while the string lived at `microclimates.reviewQuestionCount`. The templates card
 *   showed `surveys.reviewQuestionCount` where the design says "34 questions".
 * - `SidebarUserMenu` asked for `shell.account` as its no-name fallback; `shell` had
 *   no `account`.
 *
 * `catalogues.test.ts` could not see any of it: the catalogues were at exact key
 * parity and had no blanks. Parity says the two files agree, not that the code asks
 * for keys either one holds. `noHardcodedStrings.test.ts` could not either — a `t()`
 * call is precisely what it wants to see. This is the third leg: the keys the code
 * actually references must exist.
 *
 * ## The namespace is why this has to read the file, not just grep it
 *
 * `useTranslation('language')` prefixes every key unconditionally, so
 * `t('selectLanguage')` means `language.selectLanguage`. A check that took the literal
 * at face value would report all ~40 scoped call sites as missing — which is exactly
 * what the first draft of this file did.
 *
 * The namespaces of a file are collected and each key is accepted if it resolves under
 * any of them (or unprefixed). Measured across `src/`: 175 files call `useTranslation`
 * with no namespace, 141 with exactly one, and one — `SurveyRespondForm` — uses both a
 * scoped and a root translator, which is the case that makes "any candidate" the
 * honest rule rather than "the file's namespace". It costs precision only there, and
 * only in the direction of a miss going unreported; a key that resolves under no
 * candidate at all is still caught everywhere.
 *
 * Like its neighbour it walks the AST rather than pattern-matching, so `t(roleKey)`
 * and `` t(`surveys.${x}`) `` are skipped as dynamic instead of read as a literal
 * named `roleKey`, and a `useTranslation('surveys')` inside a doc comment is not
 * mistaken for a call. That leaves a real hole — a computed key can still miss — but a
 * static check cannot close it.
 */

// Vitest runs with the package root as cwd, as in noHardcodedStrings.test.ts.
const SRC = join(process.cwd(), 'src')

/** Walks a dot path, mirroring `lookup` in translate.ts. */
function resolves(messages: Messages, key: string): boolean {
  let node: MessageNode | undefined = messages
  for (const segment of key.split('.')) {
    if (typeof node !== 'object' || node === null || !Object.hasOwn(node, segment)) return false
    node = node[segment]
  }
  return typeof node === 'string'
}

interface FileKeys {
  /** Namespace prefixes in play, `''` for an unscoped translator. */
  namespaces: string[]
  keys: { key: string; line: number }[]
}

/** A plain string or a template literal with no substitutions — the knowable forms. */
function staticText(node: ts.Node | undefined): string | null {
  if (!node) return null
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null
}

/**
 * The statically-known `t(...)` keys in one file, plus the namespaces its translators
 * were built with.
 */
export function scanFile(fileName: string, source: string): FileKeys {
  const parsed = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const keys: FileKeys['keys'] = []
  const namespaces = new Set<string>()

  const isTranslatorCallee = (node: ts.Expression): boolean =>
    (ts.isIdentifier(node) && node.text === 't') ||
    (ts.isPropertyAccessExpression(node) && node.name.text === 't')

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === 'useTranslation') {
        const [first] = node.arguments
        // A dynamic namespace contributes nothing knowable; the unprefixed candidate
        // below still applies, so such a file is checked loosely rather than wrongly.
        namespaces.add(first === undefined ? '' : (staticText(first) ?? ''))
      } else if (isTranslatorCallee(node.expression)) {
        const key = staticText(node.arguments[0])
        if (key !== null) {
          keys.push({
            key,
            line:
              parsed.getLineAndCharacterOfPosition(node.arguments[0].getStart(parsed)).line + 1,
          })
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(parsed)
  // An unscoped translator is always a possibility: a file may destructure the root
  // `t` from context directly, or take one as a prop, without calling the hook.
  namespaces.add('')
  return { namespaces: [...namespaces], keys }
}

/**
 * Production sources only. A test may legitimately pass a key that does not exist —
 * `translate.test.ts` asserts the miss behaviour — and a fixture exists to be wrong.
 */
function sourceFiles(): string[] {
  return globSync('**/*.{ts,tsx}', { cwd: SRC })
    .filter((file) => !/\.test\.tsx?$/.test(file) && !file.includes('__fixture__'))
    .map((file) => join(SRC, file))
}

/** The locales in which no candidate prefix resolves `key`. */
function missingLocales(namespaces: string[], key: string): string[] {
  const candidates = namespaces.map((ns) => (ns === '' ? key : `${ns}.${key}`))
  return LOCALES.filter(
    (locale) => !candidates.some((candidate) => resolves(CATALOGUES[locale], candidate)),
  )
}

describe('t() keys exist in every catalogue', () => {
  it('extracts static keys and skips the ones only known at runtime', () => {
    const { keys, namespaces } = scanFile(
      'sample.tsx',
      [
        "const { t } = useTranslation('language')",
        "const a = t('surveys.timesUsed')",
        'const b = t(`shell.settings`)',
        'const c = t(roleKey)',
        'const d = t(`surveys.${name}`)',
        "const e = i18n.t('common.retry')",
        "const f = notT('surveys.timesUsed')",
        "// const g = t('in.a.comment')",
      ].join('\n'),
    )

    expect(keys.map((k) => `${k.line}:${k.key}`)).toEqual([
      '2:surveys.timesUsed',
      '3:shell.settings',
      '6:common.retry',
    ])
    expect(namespaces.sort()).toEqual(['', 'language'])
  })

  it('resolves a scoped key under its namespace', () => {
    // The false-positive case: `t('selectLanguage')` in a `useTranslation('language')`
    // file is `language.selectLanguage` and must not be reported.
    expect(missingLocales(['', 'language'], 'selectLanguage')).toEqual([])
    expect(missingLocales([''], 'selectLanguage')).toEqual(['en', 'es'])
  })

  it('reports a missing key as missing and a real one as present', () => {
    // Vacuity control. If `resolves` were inverted or always-true, the sweep below
    // would pass by finding nothing rather than by there being nothing to find.
    expect(resolves(CATALOGUES.en, 'surveys.timesUsed')).toBe(true)
    expect(resolves(CATALOGUES.es, 'surveys.timesUsed')).toBe(true)
    expect(resolves(CATALOGUES.en, 'surveys.reviewQuestionCount')).toBe(true)
    expect(resolves(CATALOGUES.es, 'surveys.reviewQuestionCount')).toBe(true)
    expect(resolves(CATALOGUES.en, 'shell.account')).toBe(true)
    expect(resolves(CATALOGUES.es, 'shell.account')).toBe(true)

    expect(resolves(CATALOGUES.en, 'surveys.noSuchKeyAnywhere')).toBe(false)
    // A path that stops on a subtree is a miss, as in translate.ts.
    expect(resolves(CATALOGUES.en, 'surveys')).toBe(false)
    // And it must not walk the prototype chain.
    expect(resolves(CATALOGUES.en, 'surveys.constructor')).toBe(false)
  })

  it('sweeps a substantial number of call sites', () => {
    // The other half of the vacuity control: a glob or AST change that stops
    // matching would otherwise turn the check below green by scanning nothing.
    const total = sourceFiles().reduce(
      (sum, file) => sum + scanFile(file, readFileSync(file, 'utf8')).keys.length,
      0,
    )
    expect(total).toBeGreaterThan(1200)
  })

  it('has no t() key missing from any catalogue', () => {
    const report: string[] = []

    for (const file of sourceFiles()) {
      const { namespaces, keys } = scanFile(file, readFileSync(file, 'utf8'))
      for (const { key, line } of keys) {
        const missing = missingLocales(namespaces, key)
        if (missing.length > 0) {
          report.push(
            `${relative(SRC, file)}:${line}  ${key}  ` +
              `(tried: ${namespaces.map((ns) => ns || '<root>').join(', ')})  ` +
              `missing in: ${missing.join(', ')}`,
          )
        }
      }
    }

    expect(
      report.sort(),
      'A key no catalogue holds renders as its own dotted path on screen. Add it to ' +
        'every catalogue in src/i18n, or point the call at the section that already has it.',
    ).toEqual([])
  })
})
