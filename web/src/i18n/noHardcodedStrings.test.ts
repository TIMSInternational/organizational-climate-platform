import { describe, it, expect } from 'vitest'
import { readFileSync, globSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

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
 * #78 translated every page and parked the 24 feature components on a ratcheted
 * baseline of 157 literals. #176 drained that baseline to zero and deleted it, so
 * this is now an absolute check rather than a ratchet: any untranslated copy
 * anywhere under src/ fails.
 *
 * #217 widened the sweep from `.tsx` to `.ts` as well. Until then a plain `.ts`
 * module could carry any amount of English and the guard saw none of it — the
 * documented case is `navigation/navSections.ts`, which shipped `label: 'Companies'`
 * and rendered untranslated for a Spanish user in both the sidebar and the mobile
 * nav (see the comment on `NavItem.labelKey`). `.ts` files hold no JSX, so reach
 * alone would have been vacuous; the OBJECT-PROPERTY and VARIABLE rules below are
 * what actually make the wider sweep detect anything.
 */

// Vitest runs with the package root as cwd. `import.meta.url` is not a file URL
// here, because Vite serves modules over its own dev server.
const SRC = join(process.cwd(), 'src')

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

/**
 * Files that legitimately contain untranslated literals.
 *
 * `\.test\.tsx?$` already covers `.test.ts` as well as `.test.tsx`, so widening
 * the sweep to `.ts` did not need it extended.
 */
const EXEMPT = [
  /[/\\]i18n[/\\]/, // the catalogues and the layer itself
  /\.test\.tsx?$/, // tests assert on concrete strings on purpose
  /[/\\]App\.tsx$/, // dead Vite scaffold, imported nowhere (see main.tsx)
]

function sourceFiles(): string[] {
  return globSync('**/*.{ts,tsx}', { cwd: SRC })
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

/** A whitespace-separated CSS utility class, e.g. `text-fg-primary`, `md:grid-cols-2`. */
const UTILITY_CLASS = /^-?[a-z0-9]+(?:[-:/.][a-z0-9[\]%.]+)+$/

/**
 * An extra gate applied ONLY to the object-property and variable rules.
 *
 * A JSX text node or a `placeholder=` attribute proves by position that the string
 * reaches the screen, so no gate is needed there. Off the JSX path there is no such
 * proof — the property or variable NAME is the only signal, and a name is weak
 * evidence on its own. `typographyVariants.caption` holds
 * `'text-xs leading-snug text-fg-tertiary'` and `DEFAULT_ELEMENT.caption` holds
 * `'span'`; calendar.tsx's react-day-picker `classNames` map has `caption_label` and
 * `month_caption` holding Tailwind class lists. Six real false positives, all of the
 * same shape: lowercase technical tokens, never prose.
 *
 * So off the JSX path the value must look like prose too. Copy is capitalised, or is
 * a phrase of plain words; a class list is neither.
 */
function looksLikeProse(text: string): boolean {
  const trimmed = text.trim()
  if (/[A-Z]/.test(trimmed)) return true
  // All-lowercase copy is still copy — `label: 'save changes'` — but a lowercase
  // multi-word string made of utility classes is not.
  const words = trimmed.split(/\s+/)
  return words.length > 1 && !words.some((word) => UTILITY_CLASS.test(word))
}

interface Finding {
  file: string
  text: string
  kind: 'jsx-text' | 'prop' | 'jsx-expression' | 'object-prop' | 'variable'
}

/**
 * Exemptions from ONE rule rather than from the whole sweep, so a file with a real
 * reason to hold a literal of one shape stays guarded against every other shape.
 */
const RULE_EXEMPT: ReadonlyArray<{ kind: Finding['kind']; file: RegExp }> = [
  {
    // Sample data for the dev-only chart gallery: `{ label: 'Leadership', … }` and
    // twenty-three more like it. The route is gated on `import.meta.env.DEV` and
    // `app/router.test.ts` asserts the module is absent from the production graph,
    // so none of it ships — translating fake bar labels would only add ~24 keys to
    // catalogues that cannot be tree-shaken per key. Its actual on-screen copy all
    // goes through `t()` and stays covered by every other rule here.
    kind: 'object-prop',
    file: /[/\\]ChartGalleryPage\.tsx$/,
  },
]

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
  // The script kind has to follow the extension. Under `ScriptKind.TSX` a `.ts`
  // file's `const identity = <T>(value: T) => value` parses as an unterminated JSX
  // element, and everything after it is lost — the sweep would silently see half
  // the module.
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const findings: Finding[] = []

  function report(raw: string, label: string, kind: Finding['kind']): void {
    if (RULE_EXEMPT.some((rule) => rule.kind === kind && rule.file.test(file))) return
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

    // OBJECT-PROPERTY: `{ label: 'Companies', href: '/admin/companies' }`.
    //
    // This is the rule that gives the `.ts` sweep something to find: a module with
    // no JSX in it still describes what the sidebar, the select options and the
    // column headers say. Shorthand (`{ label }`) is not a PropertyAssignment and
    // carries no literal, so it is correctly skipped.
    if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))) {
      const name = node.name.text
      if (isCopyProp(name)) {
        for (const literal of stringLiterals(node.initializer)) {
          if (looksLikeProse(literal)) report(literal, `${name}: '${literal.trim()}'`, 'object-prop')
        }
      }
    }

    // VARIABLE: `const emptyMessage = 'No results yet'`.
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isCopyProp(node.name.text)
    ) {
      for (const literal of stringLiterals(node.initializer)) {
        if (looksLikeProse(literal)) {
          report(literal, `${node.name.text} = '${literal.trim()}'`, 'variable')
        }
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

  it('sweeps .ts modules as well as .tsx', () => {
    // #217: the sweep was `**/*.tsx` only. A non-zero total is not enough to prove
    // the fix — it was already non-zero — so count the `.ts` half specifically.
    // Without this, dropping back to a `.tsx`-only glob would still pass above.
    const files = sourceFiles()
    expect(files.filter((file) => file.endsWith('.ts')).length).toBeGreaterThan(0)
    expect(files.filter((file) => file.endsWith('.tsx')).length).toBeGreaterThan(0)
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

  it('detects copy that a plain .ts module would leak', () => {
    // Guard the guard, `.ts` half. A `.ts` file holds no JSX, so every rule above
    // finds nothing in one and widening the glob alone would have been vacuous.
    const findings = findHardcoded(join(SRC, 'i18n', '__fixture__.ts'))
    expect(findings.map((f) => f.text).sort()).toEqual([
      "emptyMessage = 'No results yet'",
      "label: 'Companies'",
      "label: 'System settings'",
      "submitLabel = 'Nothing to save'",
      "submitLabel = 'Save changes'",
    ])
  })

  it('does not mistake utility-class lists for copy off the JSX path', () => {
    // The six real false positives the object-property rule surfaced when it was
    // added — typographyVariants.ts and calendar.tsx — are all this shape. If
    // `looksLikeProse` is loosened away, this fails rather than the whole suite
    // turning red on strings that were never copy.
    expect(looksLikeProse('text-xs leading-snug text-fg-tertiary')).toBe(false)
    expect(looksLikeProse('flex h-control-lg items-center justify-center')).toBe(false)
    expect(looksLikeProse('span')).toBe(false)

    // And it still lets real copy through, including all-lowercase copy.
    expect(looksLikeProse('Companies')).toBe(true)
    expect(looksLikeProse('Work-life balance')).toBe(true)
    expect(looksLikeProse('save changes')).toBe(true)
  })

  it('has no untranslated copy anywhere in src/', () => {
    const findings = sourceFiles().flatMap(findHardcoded)
    const report = findings.map((f) => `${relative(SRC, f.file)}  [${f.kind}]  ${f.text}`).sort()

    expect(
      report,
      'Use t() from useTranslation() instead of a literal. If it is genuinely not ' +
        'translatable copy, add it to ALLOWED in this file with a reason — there is no ' +
        'baseline to add it to, #176 drained and removed it.',
    ).toEqual([])
  })

})
