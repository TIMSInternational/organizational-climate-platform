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

/**
 * The switch is the same rule in the other shape, and the scan above is blind to it.
 *
 * A switch paints no control fill — `bg-surface-input` never appears in it — because its
 * TRACK is both the fill and the boundary. And the track's off colour is the hairline:
 * `bg-line-default`, **1.27:1** on `--admin-bg-outer` and 1.35:1 on a panel. So on 17 admin
 * screens an off switch was a control you could not locate. The on state was never at issue
 * (4.17:1 light, 5.06:1 dark against the outer ground) — it is off that vanishes.
 *
 * Recolouring the off FILL to `--admin-line-control` was rejected rather than untried: it
 * clears the boundary but drops the on/off pair from 3.28:1 to **1.37:1**, which trades a
 * control you cannot find for a state you cannot read. The border leaves both fills alone.
 */
describe('a switch track is a boundary even though it is a fill', () => {
  const source = readFileSync(join(UI, 'switch.tsx'), 'utf8')
  const edge = source.split('\n').find((line) => line.trim().startsWith("'border "))

  it('finds the track edge class list at all — the vacuity control', () => {
    expect(edge, 'switch.tsx no longer has a recognisable track edge class list').toBeDefined()
  })

  it('draws the UNCHECKED track edge with the control token', () => {
    expect(
      edge,
      'the switch track is its own boundary and its off fill is the hairline, so the edge ' +
        'must be border-line-control; a transparent border leaves an off switch at 1.27:1 ' +
        'on --admin-bg-outer, under WCAG 1.4.11',
    ).toContain('border-line-control')
  })

  /**
   * And drops it when checked. A saturated checked fill clears the floor without help, and
   * callers re-colour it — `NotificationPreferencesNextPage` passes
   * `data-[state=checked]:bg-accent-green` — so a `line-control` ring there is a seam around
   * somebody else's colour, buying no contrast. Asserting it keeps a later "make the border
   * unconditional, it's simpler" from landing without the screenshot that refutes it.
   */
  it('drops that edge when checked, where the fill already carries the boundary', () => {
    expect(edge).toContain('data-[state=checked]:border-transparent')
  })

  /**
   * The checked fills actually in use, measured. `bg-accent-blue` is the default and
   * `bg-accent-green` is what the notification preferences screen passes; both are the
   * boundary in the checked state, so both have to clear 3:1 on their own.
   */
  it.each(['light', 'dark'] as const)(
    'in %s, every checked fill a caller uses is its own boundary',
    (theme) => {
      const p = palettes()
      const fills = ['--admin-accent-blue', '--admin-accent-green'] as const
      const failures: string[] = []
      for (const fill of fills) {
        expect(p[theme][fill], `${theme} palette has no ${fill}`).toMatch(/^#[0-9a-f]{6}$/i)
        for (const ground of GROUNDS) {
          const r = contrast(p[theme][fill], p[theme][ground])
          if (r < AA_NON_TEXT) failures.push(`${fill} on ${ground} ${r.toFixed(2)}:1`)
        }
      }
      expect(failures, 'a checked switch draws no border, so its fill IS the edge').toEqual([])
    },
  )

  it('keeps the two fills apart, so on and off stay tellable', () => {
    const p = palettes()
    for (const theme of ['light', 'dark'] as const) {
      const pair = contrast(p[theme]['--admin-border-default'], p[theme]['--admin-accent-blue'])
      expect(
        pair,
        `the switch's off and on fills are ${pair.toFixed(2)}:1 apart in ${theme}; ` +
          'below 3:1 the state stops being readable from colour, which is what recolouring ' +
          'the off fill to --admin-line-control would have done',
      ).toBeGreaterThanOrEqual(AA_NON_TEXT)
    }
  })
})
