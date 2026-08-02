import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync, globSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import BASELINE from './hardcodedStringsBaseline.json'

/**
 * Guard against user-facing English creeping back in.
 *
 * #78 exists because every page written with literal strings has to be reworked
 * later. This test makes that failure loud at the moment it is introduced rather
 * than at translation time.
 *
 * It is a lint-shaped test rather than an oxlint rule because oxlint has no
 * custom-rule plugin API, and adding ESLint alongside it just to express one rule
 * would put two linters in CI.
 *
 * It walks the TypeScript AST rather than pattern-matching the source. A regex
 * over `>...<` cannot tell JSX text from a generic type argument, so
 * `useState<Record<string, string>>(x)` reads as copy — that produced ~90 false
 * positives before this was rewritten.
 *
 * #78 translated every page but not the 24 feature components, whose 157 literals
 * are recorded in hardcodedStringsBaseline.json. The baseline is a ratchet, not an
 * allowlist: new copy anywhere fails, pages are held at zero unconditionally, and
 * a stale baseline entry fails too, so the file can only shrink. Removing it
 * entirely is the follow-up issue's job.
 */

// Vitest runs with the package root as cwd. `import.meta.url` is not a file URL
// here, because Vite serves modules over its own dev server.
const SRC = join(process.cwd(), 'src')
const BASELINE_PATH = join(SRC, 'i18n', 'hardcodedStringsBaseline.json')

/** Props whose values are read out to a user. */
const USER_FACING_PROPS = new Set([
  'placeholder',
  'aria-label',
  'aria-description',
  'aria-placeholder',
  'title',
  'alt',
])

/**
 * Custom props that carry copy — `submitLabel="Create field"` is as user-visible
 * as JSX text, and matching by name catches component props this file has never
 * heard of.
 */
const COPY_PROP_PATTERN = /(label|message|heading|caption|tooltip|blurb|copy)$/i

/**
 * Props matching COPY_PROP_PATTERN that nonetheless hold identifiers, not copy.
 * `aria-labelledby` takes an element id.
 */
const NOT_COPY_PROPS = new Set(['aria-labelledby', 'aria-describedby', 'htmlFor'])

function isCopyProp(name: string): boolean {
  if (NOT_COPY_PROPS.has(name)) return false
  return USER_FACING_PROPS.has(name) || COPY_PROP_PATTERN.test(name)
}

/**
 * Literals that are not translatable copy. Keep this list short and justified —
 * it is the escape hatch, and a long one means the guard is not working.
 */
const ALLOWED = new Set([
  'Organizational Climate Platform', // the product name, not translated
  'acme.com', // example domain, mirrors dashboard.domainPlaceholder
])

/** Files that legitimately contain untranslated literals. */
const EXEMPT = [
  /[/\\]i18n[/\\]/, // the catalogues and the layer itself
  /\.test\.tsx?$/, // tests assert on concrete strings on purpose
  /[/\\]App\.tsx$/, // dead Vite scaffold, imported nowhere (see main.tsx)
]

function sourceFiles(): string[] {
  return globSync('**/*.tsx', { cwd: SRC })
    .map((file) => join(SRC, file))
    .filter((file) => !EXEMPT.some((pattern) => pattern.test(file)))
}

function looksLikeCopy(text: string): boolean {
  // Entity references are markup, not words — `&middot;` would otherwise read as
  // copy on the strength of its letters.
  const trimmed = text.replace(/&(?:#\d+|#x[0-9a-fA-F]+|\w+);/g, '').trim()
  // Two consecutive letters means a word, rather than punctuation, a unit, or a
  // lone symbol.
  return trimmed.length >= 2 && /[A-Za-z]{2,}/.test(trimmed)
}

interface Finding {
  file: string
  text: string
  kind: 'jsx-text' | 'prop' | 'jsx-expression'
}

/**
 * String literals directly in an expression — the expression itself, or the
 * branches of a ternary. Deliberately shallow: it must not descend into object
 * or array literals, or every `style={{ padding: 'var(--admin-space-4)' }}` and
 * every `type="text"` lookalike would register as copy.
 */
function stringLiterals(expression: ts.Expression): string[] {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return [expression.text]
  }
  if (ts.isConditionalExpression(expression)) {
    return [...stringLiterals(expression.whenTrue), ...stringLiterals(expression.whenFalse)]
  }
  // `a || 'fallback'` and `a ?? 'fallback'`
  if (ts.isBinaryExpression(expression)) {
    const kind = expression.operatorToken.kind
    if (
      kind === ts.SyntaxKind.BarBarToken ||
      kind === ts.SyntaxKind.QuestionQuestionToken
    ) {
      return [...stringLiterals(expression.left), ...stringLiterals(expression.right)]
    }
  }
  if (ts.isParenthesizedExpression(expression)) return stringLiterals(expression.expression)
  return []
}

function findHardcoded(file: string): Finding[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  )
  const findings: Finding[] = []

  function report(raw: string, label: string, kind: Finding['kind']): void {
    if (looksLikeCopy(raw) && !ALLOWED.has(raw.trim())) {
      findings.push({ file, text: label, kind })
    }
  }

  function visit(node: ts.Node): void {
    if (ts.isJsxText(node)) {
      report(node.text, node.text.trim(), 'jsx-text')
    }

    if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText(source)

      // placeholder="Search users"
      if (ts.isStringLiteral(node.initializer) && isCopyProp(name)) {
        report(node.initializer.text, `${name}="${node.initializer.text.trim()}"`, 'prop')
      }

      // submitLabel={'Create field'} and label={cond ? 'A' : 'B'}
      if (ts.isJsxExpression(node.initializer) && node.initializer.expression && isCopyProp(name)) {
        for (const literal of stringLiterals(node.initializer.expression)) {
          report(literal, `${name}={…'${literal.trim()}'…}`, 'prop')
        }
      }
    }

    // {creating ? 'Cancel' : 'New field'} rendered as a child.
    //
    // Only direct string literals and ternaries of them, never a nested object —
    // otherwise every `style={{ padding: 'var(--admin-space-4)' }}` reads as copy.
    if (ts.isJsxExpression(node) && node.expression && node.parent && ts.isJsxElement(node.parent)) {
      for (const literal of stringLiterals(node.expression)) {
        report(literal, `{…'${literal.trim()}'…}`, 'jsx-expression')
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(source)
  return findings
}

describe('no hardcoded user-facing strings', () => {
  it('finds source files to check', () => {
    expect(sourceFiles().length).toBeGreaterThan(0)
  })

  it('detects copy that a real component would leak', () => {
    // Guard the guard: if the detector silently stopped matching, the main
    // assertion below would pass vacuously.
    const findings = findHardcoded(join(SRC, 'i18n', '__fixture__.tsx'))
    expect(findings.map((f) => f.text).sort()).toEqual([
      'Delete user',
      'placeholder="Search users"',
      'submitLabel="Create field"',
      "{…'Empty'…}",
      "{…'Has rows'…}",
    ])
  })

  it('introduces no new untranslated copy', () => {
    const findings = sourceFiles().flatMap(findHardcoded)
    const report = findings.map((f) => `${relative(SRC, f.file)}  [${f.kind}]  ${f.text}`).sort()

    // Regenerate with `UPDATE_I18N_BASELINE=1 npx vitest run`. Deriving the
    // baseline any other way loses fidelity — multi-line JSX text and embedded
    // quotes have to round-trip exactly.
    if (process.env.UPDATE_I18N_BASELINE) {
      writeFileSync(BASELINE_PATH, `${JSON.stringify(report, null, 2)}\n`)
      return
    }

    const baseline = new Set(BASELINE)
    const added = report.filter((entry) => !baseline.has(entry))

    expect(
      added,
      'New untranslated copy. Use t() from useTranslation() instead of a literal. If it ' +
        'is genuinely not translatable copy, add it to ALLOWED in this file with a reason.',
    ).toEqual([])
  })

  it('has no untranslated copy in any page', () => {
    // #78 translated every page. Nothing in the baseline is a page, so a page
    // regression fails here even if someone widens the baseline.
    const pageFindings = sourceFiles()
      .filter((file) => /Page\.tsx$|RouteErrorBoundary\.tsx$/.test(file))
      .flatMap(findHardcoded)
      .map((f) => `${relative(SRC, f.file)}  [${f.kind}]  ${f.text}`)
      .sort()

    expect(pageFindings).toEqual([])
  })

  it('keeps the baseline honest — every entry still exists', () => {
    // Once a component is translated its entries must be deleted from the
    // baseline, otherwise the file rots into a permanent allowlist.
    const report = new Set(
      sourceFiles()
        .flatMap(findHardcoded)
        .map((f) => `${relative(SRC, f.file)}  [${f.kind}]  ${f.text}`),
    )
    const stale = BASELINE.filter((entry) => !report.has(entry))

    expect(
      stale,
      'These baseline entries no longer exist. Remove them from ' +
        'hardcodedStringsBaseline.json — the baseline shrinks, it never grows.',
    ).toEqual([])
  })
})
