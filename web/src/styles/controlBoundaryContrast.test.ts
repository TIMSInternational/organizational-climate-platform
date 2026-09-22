import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * WCAG 2.2 SC 1.4.11 for the edge of a control, in the two halves it actually needs.
 *
 * ## Why this file exists
 *
 * `ui/input.tsx` drew every field in the product with `border-line-default` — #d7deeb,
 * **1.35:1** on white — until 2026-09-22. That token is right for a hairline between table
 * rows and it is not a control boundary, which 1.4.11 holds to 3:1 against what sits on
 * both sides of it. Nothing measured it. The whole admin contrast suite next door measures
 * INK on grounds; the one non-text thing it checks is the focus ring.
 *
 * `storefront.css` had already made exactly this split, and said so in a comment —
 * `--storefront-line-control`, "WCAG 1.4.11 wants 3:1; this is 3.02:1 on surface. Needed
 * because the system leans on borders, not shadow, to say where a control is." The admin
 * palette simply never got the second token, so every control in the product used the rule.
 *
 * ## The two halves
 *
 * A ratio guard alone would not have caught it: `--admin-line-control` can be perfect while
 * a component keeps reaching for `--admin-border-default`. So this file checks BOTH that
 * the token clears the floor, and that the components which draw a control surface actually
 * use it. The second is the tripwire; the first is why the value is safe to use.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const TOKENS = resolve(HERE, 'tokens.css')
const UI = resolve(HERE, '..', 'components', 'ui')

/** WCAG 1.4.11: a user-interface component's boundary against adjacent colours. */
const AA_NON_TEXT = 3.0

function linearize(channel: number): number {
  const srgb = channel / 255
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) throw new Error(`not a six-digit hex colour: ${hex}`)
  const value = Number.parseInt(match[1], 16)
  return (
    0.2126 * linearize((value >> 16) & 0xff) +
    0.7152 * linearize((value >> 8) & 0xff) +
    0.0722 * linearize(value & 0xff)
  )
}

function contrast(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * The two palette blocks, comments stripped first: `tokens.css` quotes legacy hexes in its
 * prose, and a scrape that reads those measures a colour nothing paints with.
 */
function palettes(): { light: Record<string, string>; dark: Record<string, string> } {
  const css = readFileSync(TOKENS, 'utf8')
  const cut = css.indexOf("data-admin-theme='dark'")
  expect(cut, 'tokens.css no longer declares a dark palette').toBeGreaterThan(0)

  const read = (block: string) => {
    const out: Record<string, string> = {}
    const bare = block.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const m of bare.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2]
    return out
  }
  const light = read(css.slice(0, cut))
  return { light, dark: { ...light, ...read(css.slice(cut)) } }
}

/**
 * Both sides of the edge. The ground OUTSIDE the control binds harder than the fill inside
 * it: `--admin-bg-outer` is the page a form sits on, and a border that clears white but not
 * the page is a border that disappears exactly where forms are drawn.
 */
const GROUNDS = [
  '--admin-bg-input',
  '--admin-bg-panel',
  '--admin-bg-card',
  '--admin-bg-outer',
] as const

describe('a control boundary is not a hairline (WCAG 1.4.11)', () => {
  const p = palettes()

  it.each(['light', 'dark'] as const)(
    'in %s, --admin-line-control clears 3:1 on every ground a control is drawn against',
    (theme) => {
      const line = p[theme]['--admin-line-control']
      expect(line, `${theme} palette has no --admin-line-control`).toMatch(/^#[0-9a-f]{6}$/i)

      const failures = GROUNDS.map((ground) => ({
        ground,
        ratio: contrast(line, p[theme][ground]),
      })).filter(({ ratio }) => ratio < AA_NON_TEXT)

      expect(
        failures.map((f) => `${f.ground} ${f.ratio.toFixed(2)}:1`),
        `--admin-line-control (${line}) in ${theme}`,
      ).toEqual([])
    },
  )

  /**
   * The control that was wrong is the proof this is worth measuring: `--admin-border-default`
   * must NOT clear the floor, or the two tokens have collapsed into one and the split that
   * `storefront.css` made for a reason has been undone by a well-meaning revalue.
   */
  it.each(['light', 'dark'] as const)(
    'in %s, --admin-border-default is still the hairline it is supposed to be',
    (theme) => {
      const ratio = contrast(p[theme]['--admin-border-default'], p[theme]['--admin-bg-panel'])
      expect(
        ratio,
        `--admin-border-default reached ${ratio.toFixed(2)}:1 on the panel in ${theme}; ` +
          'if it is now a control boundary too, delete --admin-line-control rather than keeping two',
      ).toBeLessThan(AA_NON_TEXT)
    },
  )
})

describe('every control surface in ui/ draws its edge with the control token', () => {
  /**
   * A source scan, because the ratio above can be perfect while a component reaches for the
   * wrong token — which is exactly how this shipped. `bg-surface-input` is the marker: it is
   * what a control's fill is painted with, so a class list that sets it AND a `border-line-*`
   * is describing the edge of a control.
   *
   * A bare `border-b border-line-default` is a RULE — the line under a tab list, the divider
   * between accordion items — and is deliberately not caught here.
   */
  const files = readdirSync(UI).filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'))

  it('finds the control surfaces at all — the vacuity control', () => {
    const withControlFill = files.filter((f) => readFileSync(join(UI, f), 'utf8').includes('bg-surface-input'))
    // input, textarea, select, checkbox, radio-group, date-picker. If this ever drops to a
    // handful, the marker moved and the scan below is measuring nothing.
    expect(withControlFill.length).toBeGreaterThanOrEqual(5)
  })

  it('never pairs a control fill with the hairline token', () => {
    const offenders: string[] = []
    for (const file of files) {
      const source = readFileSync(join(UI, file), 'utf8')
      for (const line of source.split('\n')) {
        if (!line.includes('bg-surface-input')) continue
        if (line.includes('border-line-default')) offenders.push(`${file}: ${line.trim()}`)
      }
    }
    expect(
      offenders,
      'a control painted with bg-surface-input must draw its edge with border-line-control: ' +
        'border-line-default is #d7deeb, 1.35:1 on white, and fails WCAG 1.4.11',
    ).toEqual([])
  })
})
