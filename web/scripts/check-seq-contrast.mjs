#!/usr/bin/env node
/**
 * Measures the sequential ramp against its paired ink, in both themes.
 *
 * `HeatMap showValues` paints the number *on top of* the ramp swatch, so every
 * `(--admin-chart-seq-N, --admin-chart-seq-N-ink)` pair has to clear WCAG AA for
 * small text — 4.5:1. #208 exists because it did not: a single ink measured
 * 1.56:1 against dark-mode `seq-7`, which is text you cannot see.
 *
 * This is the instrument, not the guard. `src/styles/seqInkContrast.test.ts`
 * runs it and fails the build on its exit code, so the numbers below are
 * re-measured on every CI run rather than trusted from a PR description.
 *
 *   node scripts/check-seq-contrast.mjs            # table, exit 1 if any pair fails
 *   node scripts/check-seq-contrast.mjs --json     # machine-readable
 *   node scripts/check-seq-contrast.mjs --css path/to/tokens.css
 *
 * It reads the stylesheet rather than a copy of the hexes on purpose: a list of
 * colours maintained beside tokens.css is a list of colours that drifts from it.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** WCAG 2.2 small-text minimum. The value in a heatmap cell is small text. */
export const AA_SMALL_TEXT = 4.5

const STEPS = [1, 2, 3, 4, 5, 6, 7]

/** The two palette blocks tokens.css declares, in the order a report should read. */
const THEMES = [
  { name: 'light', selector: ':root' },
  { name: 'dark', selector: ":root\\[data-admin-theme='dark'\\]" },
]

/** sRGB channel -> linear light. WCAG 2.x relative-luminance, verbatim. */
function linearize(channel) {
  const srgb = channel / 255
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) throw new Error(`not a six-digit hex colour: ${hex}`)
  const value = Number.parseInt(match[1], 16)
  return (
    0.2126 * linearize((value >> 16) & 0xff) +
    0.7152 * linearize((value >> 8) & 0xff) +
    0.0722 * linearize(value & 0xff)
  )
}

/** WCAG contrast ratio. Symmetric: the order of the two colours does not matter. */
export function contrastRatio(a, b) {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Comments in tokens.css quote legacy CSS verbatim, braces and all, so they are
 * stripped before any block is matched — the same thing tokens.test.ts does.
 */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

function blockFor(css, selector) {
  const body = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm').exec(stripComments(css))
  if (!body) throw new Error(`tokens.css has no ${selector.replace(/\\/g, '')} block`)
  return body[1]
}

function declaration(block, name, selector) {
  const match = new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm').exec(block)
  if (!match) {
    throw new Error(`${name} is not declared in ${selector.replace(/\\/g, '')}`)
  }
  return match[1].trim()
}

/** Every (fill, ink) pairing in the stylesheet, measured. */
export function measure(css) {
  return THEMES.flatMap(({ name, selector }) => {
    const block = blockFor(css, selector)
    return STEPS.map((step) => {
      const fill = declaration(block, `--admin-chart-seq-${step}`, selector)
      const ink = declaration(block, `--admin-chart-seq-${step}-ink`, selector)
      const ratio = contrastRatio(fill, ink)
      return { theme: name, step, fill, ink, ratio, passes: ratio >= AA_SMALL_TEXT }
    })
  })
}

function defaultCssPath() {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles', 'tokens.css')
}

function main(argv) {
  const jsonFlag = argv.includes('--json')
  const cssFlag = argv.indexOf('--css')
  const cssPath = cssFlag === -1 ? defaultCssPath() : resolve(argv[cssFlag + 1])

  let rows
  try {
    rows = measure(readFileSync(cssPath, 'utf8'))
  } catch (error) {
    // A missing token is a failure, not a reason to print an empty passing table.
    if (jsonFlag) {
      process.stdout.write(`${JSON.stringify({ error: String(error.message ?? error) })}\n`)
    } else {
      process.stderr.write(`${error.message ?? error}\n`)
    }
    return 1
  }

  const failures = rows.filter((row) => !row.passes)

  if (jsonFlag) {
    process.stdout.write(`${JSON.stringify({ threshold: AA_SMALL_TEXT, rows }, null, 2)}\n`)
  } else {
    process.stdout.write(`sequential ramp ink contrast (WCAG AA small text, >= ${AA_SMALL_TEXT}:1)\n`)
    process.stdout.write(`source: ${cssPath}\n\n`)
    process.stdout.write('theme  step  fill      ink       ratio   \n')
    for (const row of rows) {
      const cells = [
        row.theme.padEnd(6),
        String(row.step).padEnd(5),
        row.fill.padEnd(9),
        row.ink.padEnd(9),
        `${row.ratio.toFixed(2)}:1`.padEnd(8),
        row.passes ? 'PASS' : 'FAIL',
      ]
      process.stdout.write(`${cells.join(' ')}\n`)
    }
    const worst = rows.reduce((a, b) => (a.ratio <= b.ratio ? a : b))
    process.stdout.write(`\nworst pairing: ${worst.theme} seq-${worst.step} at ${worst.ratio.toFixed(2)}:1\n`)
  }

  return failures.length === 0 ? 0 : 1
}

// `process.argv[1]` is this file only when it was run, not when it was imported.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)))
}
