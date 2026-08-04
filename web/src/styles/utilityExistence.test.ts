import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { readFileSync, globSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { __unstable__loadDesignSystem } from 'tailwindcss'

/**
 * Every class a component writes must actually compile to a rule.
 *
 * ## Why this exists, and why `tokenDiscipline` does not already cover it
 *
 * `components/ui/tokenDiscipline.test.ts` rejects *raw values* — a hex colour, a
 * stock Tailwind palette step, an arbitrary `[...]` value. It says nothing about
 * whether a token-shaped utility exists. So `className="text-primary"` sails
 * through it: there is no hex, no stock colour, no bracket. But `theme.css`
 * declares `--color-fg-primary`, not `--color-primary`, so the utility Tailwind
 * generates is `text-fg-primary` and `text-primary` compiles to **nothing at all**.
 *
 * That is the same failure tokenDiscipline was written to prevent, arrived at from
 * the other side: text renders in the inherited colour, which looks close enough
 * to correct in light mode to survive review, and the class is invisible in the
 * DOM diff because the attribute *is* there. Nothing in `tsc`, the build, oxlint
 * or the test suite fails — Tailwind silently emits no rule for a candidate it
 * cannot resolve, by design, because it cannot tell a typo from a class belonging
 * to some other stylesheet.
 *
 * This guard found four such classes in the #79 chart components at the point it
 * was written (`text-primary`, `text-secondary`, `border-default`,
 * `font-regular` — across `ChartFrame`, `Counter` and `HeatMap`), all introduced
 * by the palette/chart PRs and all invisible to every other check in CI.
 *
 * ## How it decides
 *
 * It does not model the theme, and deliberately holds no list of valid
 * namespaces. It loads **the real `src/index.css`** through **the real Tailwind
 * compiler** and asks it to resolve each candidate, which is exactly what the
 * production build does. So the guard cannot drift from the stylesheet: adding
 * `--color-brand` to `theme.css` makes `text-brand` legal here the same moment it
 * becomes legal in the browser, with nothing to update in this file.
 *
 * ## What it does not cover
 *
 * The cva variant tables in `components/ui/*Variants.ts`. Their class strings sit
 * as object *values* two levels inside a `variants: { size: { sm: '...' } }`
 * literal, indistinguishable from the variant *keys* beside them without
 * modelling cva's call shape — and the keys (`sm`, `default`, `destructive`) are
 * not classes, so sweeping them naively produces pure noise. Checked by hand once
 * when this was written: they contain no non-compiling class. Worth revisiting if
 * a bug ever does land there.
 */

const WEB = process.cwd()
const SRC = join(WEB, 'src')
const NODE_MODULES = join(WEB, 'node_modules')
const ENTRY = join(SRC, 'index.css')

/**
 * Marker classes. `group` and `peer` (and their named `group//peer/` forms) exist
 * only to be *referenced* by a `group-hover:`/`peer-checked:` variant on a
 * sibling — Tailwind emits no rule of their own, so "compiles to nothing" is
 * correct for them rather than a bug.
 */
const MARKER_CLASS = /^(?:group|peer)(?:\/[A-Za-z][\w-]*)?$/

const EXEMPT = [
  /\.test\.tsx$/,
  // Dead Vite scaffold, imported nowhere (see main.tsx) — same exemption
  // i18n/noHardcodedStrings.test.ts makes, for the same reason.
  /[/\\]App\.tsx$/,
  // Deliberately-wrong-on-purpose input to another guard's own self-test.
  /__fixture__/,
]

/** Classes written as literal selectors in index.css, e.g. `.nav-icon`. */
function handWrittenClasses(css: string): Set<string> {
  return new Set([...css.matchAll(/^\s*\.([A-Za-z][\w-]*)\s*\{/gm)].map((match) => match[1]))
}

/**
 * Resolves an `@import` the way Vite does: relative paths against the importing
 * file, bare specifiers against `node_modules` (index.css imports `tailwindcss`,
 * and fonts.css imports `@fontsource/poppins/*`).
 */
async function loadStylesheet(id: string, basedir: string) {
  const candidates =
    id.startsWith('.') || id.startsWith('/')
      ? [resolve(basedir, id)]
      : [
          join(NODE_MODULES, id),
          join(NODE_MODULES, `${id}.css`),
          join(NODE_MODULES, id, 'index.css'),
        ]

  for (const path of candidates) {
    try {
      return { path, base: dirname(path), content: await readFile(path, 'utf8') }
    } catch {
      // Try the next candidate; a genuinely missing import throws below.
    }
  }
  throw new Error(`cannot resolve stylesheet "${id}" imported from ${basedir}`)
}

/**
 * Class strings inside a `className` attribute.
 *
 * Walks the TypeScript AST rather than matching `className="..."`, because the
 * real forms are `cn('a', cond && 'b', className)` and ternaries, which a regex
 * cannot follow.
 *
 * Three exclusions, each one a false positive this produced before it was added:
 *
 * - **Object literals are not entered.** `cn(buttonVariants({ variant:
 *   'destructive' }))` puts a *variant key* where a class would be. (The same
 *   trap i18n/noHardcodedStrings.test.ts documents.)
 * - **Comparisons contribute nothing, and `&&`/`||` contribute only the right
 *   side.** In `side === 'bottom' && 'inset-x-0'` the left operand is data being
 *   tested, not a class — that alone accounted for `bottom`, `left`, `right`,
 *   `top`, `horizontal`, `vertical` and `popper`.
 * - **Template literals with substitutions are skipped.** `` `h-${size}` `` has
 *   no knowable class; the static chunk `h-` is not one.
 */
function classCandidatesIn(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )
  const found: string[] = []

  function collect(node: ts.Node): void {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      found.push(node.text)
      return
    }
    if (ts.isTemplateExpression(node) || ts.isObjectLiteralExpression(node)) return
    if (ts.isJsxExpression(node)) {
      if (node.expression) collect(node.expression)
      return
    }
    if (ts.isCallExpression(node)) {
      node.arguments.forEach(collect)
      return
    }
    if (ts.isConditionalExpression(node)) {
      collect(node.whenTrue)
      collect(node.whenFalse)
      return
    }
    if (ts.isBinaryExpression(node)) {
      const kind = node.operatorToken.kind
      if (
        kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        kind === ts.SyntaxKind.BarBarToken
      ) {
        collect(node.right)
      } else if (kind === ts.SyntaxKind.QuestionQuestionToken) {
        collect(node.left)
        collect(node.right)
      }
      return
    }
    if (ts.isParenthesizedExpression(node)) {
      collect(node.expression)
      return
    }
    if (ts.isArrayLiteralExpression(node)) {
      node.elements.forEach(collect)
    }
  }

  function walk(node: ts.Node): void {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(source) === 'className' &&
      node.initializer
    ) {
      collect(node.initializer)
    }
    node.forEachChild(walk)
  }

  walk(source)
  return found
}

function sourceFiles(): string[] {
  return globSync('**/*.tsx', { cwd: SRC })
    .map((file) => join(SRC, file))
    .filter((file) => !EXEMPT.some((pattern) => pattern.test(file)))
}

interface DesignSystem {
  candidatesToCss(candidates: string[]): (string | null)[]
}

let designSystem: DesignSystem
let handWritten: Set<string>

/** Splits a `className` value into candidates, dropping the ones not ours to judge. */
function candidatesOf(strings: string[]): string[] {
  return [...new Set(strings.flatMap((value) => value.split(/\s+/)).filter(Boolean))].filter(
    (candidate) => !MARKER_CLASS.test(candidate) && !handWritten.has(candidate),
  )
}

function nonCompiling(candidates: string[]): string[] {
  const css = designSystem.candidatesToCss(candidates)
  return candidates.filter((_, index) => css[index] === null || css[index] === undefined)
}

describe('utility existence', () => {
  beforeAll(async () => {
    const entry = await readFile(ENTRY, 'utf8')
    handWritten = handWrittenClasses(entry)
    designSystem = (await __unstable__loadDesignSystem(entry, {
      base: SRC,
      loadStylesheet,
      async loadModule() {
        // index.css is pure CSS configuration — a JS plugin would mean the
        // stylesheet grew a `@plugin` and this guard needs teaching about it.
        throw new Error('index.css is not expected to load a JS plugin')
      },
    })) as DesignSystem
  }, 30_000)

  it('loads the real stylesheet', () => {
    // Guard the guard: if loading silently produced a design system that resolves
    // nothing, every sweep below would "pass" by finding no classes to check.
    expect(designSystem.candidatesToCss(['flex'])[0]).toBeTruthy()
    expect(handWritten.size, 'index.css declares .nav-icon and friends').toBeGreaterThan(0)
  })

  it('finds the components', () => {
    // Guard the guard: an empty sweep passes the assertion below vacuously.
    expect(sourceFiles().length).toBeGreaterThanOrEqual(80)
  })

  it('writes no class that compiles to nothing', () => {
    const report = sourceFiles()
      .flatMap((file) =>
        nonCompiling(candidatesOf(classCandidatesIn(file))).map(
          (candidate) => `${relative(SRC, file)}  ${candidate}`,
        ),
      )
      .sort()

    expect(
      report,
      'These classes resolve to no CSS rule, so they style nothing. Usually a ' +
        'token namespace typo: theme.css declares --color-fg-primary, so the ' +
        'utility is `text-fg-primary`, not `text-primary`. Check src/styles/theme.css ' +
        'for the real name, or add the token there if it genuinely does not exist.',
    ).toEqual([])
  })

  it('detects a class that does not exist', () => {
    // The whole guard rests on candidatesToCss returning null for a bad class.
    // Assert that directly, or a change in Tailwind's API turns the sweep above
    // into a test that cannot fail.
    expect(nonCompiling(['text-primary', 'border-default', 'font-regular'])).toEqual([
      'text-primary',
      'border-default',
      'font-regular',
    ])
    expect(nonCompiling(['definitely-not-a-utility'])).toEqual(['definitely-not-a-utility'])
  })

  it('accepts the real names of the classes it rejects', () => {
    // The counterpart to the test above: the corrected forms must pass, or the
    // guard is just rejecting everything.
    expect(
      nonCompiling(['text-fg-primary', 'border-line-default', 'font-normal', 'text-fg-secondary']),
    ).toEqual([])
  })

  it('accepts marker classes and hand-written component classes', () => {
    // `group`/`peer` emit no rule by design, and `.nav-icon` is written straight
    // into index.css. Both would otherwise read as failures.
    expect(candidatesOf(['group peer group/field nav-icon'])).toEqual([])
  })

  it('does not descend into cva variant tables', () => {
    // The exclusion that removed the largest group of false positives. If this
    // regresses, `destructive` and `sm` start reading as broken classes.
    const strings = classCandidatesIn(
      join(SRC, 'components', 'ui', 'confirmation-dialog.tsx'),
    )
    expect(strings).not.toContain('destructive')
  })
})
