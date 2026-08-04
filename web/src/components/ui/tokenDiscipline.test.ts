import { describe, it, expect } from 'vitest'
import { readFileSync, globSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Enforces #75's "no primitive hardcodes a colour or spacing value".
 *
 * The legacy primitives were full of raw values — `text-[13px]`, `rounded-[4px]`,
 * `h-8`, `bg-green-500` — and the whole point of porting onto the #74 token layer
 * is that those become `text-base`, `rounded-md`, `h-control-lg`,
 * `bg-accent-green-soft`. Reviewing that by eye across 15 files does not scale,
 * and the failure is silent: a hardcoded colour looks right in light mode and
 * wrong in dark.
 */

const UI_DIR = join(process.cwd(), 'src', 'components', 'ui')

/**
 * `charts/` is swept too, as of #79.
 *
 * Charts are the single most likely place for a raw colour to appear -- every
 * charting library's examples pass hex strings, and a chart's colours are
 * load-bearing rather than decorative. The failure is also the one this guard
 * exists for: a hardcoded series colour looks right in light mode and disappears
 * against the dark surface, and it silently bypasses the colourblind-validated
 * palette in `charts/palette.ts`.
 *
 * Unlike `ui/`, this sweep includes `.ts` as well as `.tsx` -- the palette module
 * itself is plain TypeScript.
 */
const CHARTS_DIR = join(process.cwd(), 'src', 'components', 'charts')

function filesIn(dir: string, extensions: string[]): string[] {
  return extensions
    .flatMap((extension) => globSync(`*.${extension}`, { cwd: dir }))
    .filter((file) => !/\.test\.tsx?$/.test(file))
    .map((file) => join(dir, file))
}

function sourceFiles(): string[] {
  return filesIn(UI_DIR, ['tsx'])
}

function chartFiles(): string[] {
  return filesIn(CHARTS_DIR, ['tsx', 'ts'])
}

interface Violation {
  file: string
  match: string
  rule: string
}

const RULES: { rule: string; pattern: RegExp }[] = [
  // Literal colours.
  { rule: 'hex colour', pattern: /#[0-9a-fA-F]{3,8}\b/g },
  { rule: 'rgb()/hsl() colour', pattern: /\b(?:rgba?|hsla?)\(/g },
  // Tailwind's stock palette — the token layer replaces it entirely.
  {
    rule: 'stock palette colour',
    pattern:
      /\b(?:bg|text|border|ring|fill|stroke|from|via|to|outline|shadow|decoration|divide|accent|caret)-(?:slate|gray|grey|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g,
  },
  { rule: 'literal white/black', pattern: /\b(?:bg|text|border|ring)-(?:white|black)\b/g },
  // Arbitrary values, which bypass the theme by construction.
  {
    rule: 'arbitrary value',
    pattern:
      /\b(?:w|h|min-w|min-h|max-w|max-h|size|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|space-x|space-y|text|rounded|border|bg|shadow|leading|tracking|font)-\[[^\]]+\]/g,
  },
]

/**
 * Values that are legitimately raw.
 *
 * `--radix-*` are runtime-measured values Radix writes onto the element, not
 * design decisions. `px` is the one-device-pixel hairline, which has no token
 * because it is not a spacing step. `rounded-[inherit]` names no radius at all —
 * it defers to whatever the caller set, which is the opposite of hardcoding one.
 */
const ALLOWED = [
  /--radix-[a-z-]+/,
  /^(?:h|w|border|border-[trbl])-px$/,
  /^rounded-\[inherit\]$/,
]

/**
 * Removes comments before scanning.
 *
 * The port comments quote the legacy classes they replace — badge.tsx says the
 * legacy variants were `bg-green-500 text-white`. That is documentation, not a
 * class that can reach the DOM, and flagging it would push the comments out of
 * the files that most need them.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

function findViolations(file: string): Violation[] {
  const source = stripComments(readFileSync(file, 'utf8'))
  const violations: Violation[] = []

  for (const { rule, pattern } of RULES) {
    for (const match of source.matchAll(pattern)) {
      const value = match[0]
      if (ALLOWED.some((allowed) => allowed.test(value))) continue
      violations.push({ file, match: value, rule })
    }
  }

  return violations
}

describe('token discipline in ui/ primitives', () => {
  it('finds the primitives', () => {
    // Guard the guard: an empty sweep would make the assertion below vacuous.
    expect(sourceFiles().length).toBeGreaterThanOrEqual(38)
  })

  it('hardcodes no colour, size or arbitrary value', () => {
    const report = sourceFiles()
      .flatMap(findViolations)
      .map((v) => `${relative(UI_DIR, v.file)}  [${v.rule}]  ${v.match}`)
      .sort()

    expect(
      report,
      'Use a token utility from src/styles/theme.css instead of a raw value. ' +
        'If the value genuinely has no token, add it to theme.css, not here.',
    ).toEqual([])
  })

  it('detects a violation when there is one', () => {
    // The rules must actually match, or the sweep above passes for the wrong reason.
    const samples = [
      'className="bg-green-500"',
      'className="text-[13px]"',
      'className="rounded-[4px]"',
      'className="h-[32px]"',
      'style={{ color: "#1a73e8" }}',
      'className="text-white"',
    ]
    for (const sample of samples) {
      const hit = RULES.some(({ pattern }) => new RegExp(pattern.source).test(sample))
      expect(hit, `${sample} should be flagged`).toBe(true)
    }
  })

  it('does not flag the values that are legitimately raw', () => {
    const samples = [
      'max-h-(--radix-select-content-available-height)',
      'h-px',
      'border-px',
      'rounded-[inherit]',
    ]
    for (const sample of samples) {
      const violations = RULES.flatMap(({ pattern }) => [
        ...sample.matchAll(new RegExp(pattern.source, 'g')),
      ])
        .map((m) => m[0])
        .filter((value) => !ALLOWED.some((allowed) => allowed.test(value)))
      expect(violations, `${sample} should be allowed`).toEqual([])
    }
  })
})

describe('token discipline in charts/', () => {
  it('finds the chart modules', () => {
    // Guard the guard: an empty sweep passes the assertion below vacuously.
    // Grows as #79's components land; the palette module alone satisfies it today.
    expect(chartFiles().length).toBeGreaterThanOrEqual(1)
  })

  it('hardcodes no colour, size or arbitrary value', () => {
    const report = chartFiles()
      .flatMap(findViolations)
      .map((v) => `${relative(CHARTS_DIR, v.file)}  [${v.rule}]  ${v.match}`)
      .sort()

    expect(
      report,
      'Chart colours come from src/components/charts/palette.ts, which reads the ' +
        'validated --admin-chart-* tokens. A raw hex bypasses the colourblind ' +
        'validation and breaks dark mode silently.',
    ).toEqual([])
  })
})
