import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every diverging step must be able to carry a label.
 *
 * ## Why this exists
 *
 * `#208` added a paired ink per *sequential* step so a heatmap could print its
 * value inside the cell. The climate map (UI-0) does the same thing on the
 * *diverging* ramp — score against a target — so the same guarantee is needed,
 * and `tokens.css` now declares `--admin-chart-div-*-ink` in both themes.
 *
 * The reason it is a test rather than a comment is that the diverging case has a
 * trap the sequential case does not. The sequential ramp runs light→dark, so its
 * inks are a monotone run of dark values with a light one at the end. The
 * diverging ramps run dark→light→dark, and **the two themes invert**:
 *
 * | step | light fill | light ink | dark fill | dark ink |
 * |---|---|---|---|---|
 * | neg-2 | `#b91c1c` | light | `#f87171` | dark |
 * | neg-1 | `#fca5a5` | dark | `#7f1d1d` | light |
 * | mid | `#a1a1a1` | dark | `#6b6b6b` | light |
 * | pos-1 | `#7dd3fc` | dark | `#0c4a6e` | light |
 * | pos-2 | `#0369a1` | light | `#38bdf8` | dark |
 *
 * So a single shared ink array — the obvious implementation, and what
 * `DIVERGING_INKS` would have been if it held literals instead of `var()`
 * references — is correct in one theme and illegible in the other. Nobody
 * reviewing a diff catches that, and it only shows up if someone opens the app in
 * the other theme and looks at a cell.
 *
 * Values are parsed out of `tokens.css` rather than restated here, for the reason
 * `seqInkContrast.test.ts` and `badgeVariantContrast.test.ts` both give: a guard
 * that restates the values it guards can agree with itself while both are wrong.
 */

const TOKENS = join(process.cwd(), 'src', 'styles', 'tokens.css')
const DARK_SELECTOR = ":root[data-admin-theme='dark']"

/** WCAG AA for small text. The map's cell labels are 12.5px, so 4.5 not 3.0. */
const AA_SMALL_TEXT = 4.5

const STEPS = ['neg-2', 'neg-1', 'mid', 'pos-1', 'pos-2'] as const

function declarations(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/(--admin-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  )
}

function palettes(): { light: Record<string, string>; dark: Record<string, string> } {
  const css = readFileSync(TOKENS, 'utf8')
  const cut = css.indexOf(DARK_SELECTOR)
  expect(cut, 'tokens.css no longer declares a dark palette').toBeGreaterThan(0)
  const light = declarations(css.slice(css.indexOf(':root {'), cut))
  return { light, dark: { ...light, ...declarations(css.slice(cut)) } }
}

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  expect(m, `expected a 6-digit hex colour, got ${JSON.stringify(hex)}`).not.toBeNull()
  const n = parseInt(m![1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((c) => {
      const s = c / 255
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    })
    .reduce((acc, v, i) => acc + [0.2126, 0.7152, 0.0722][i] * v, 0)
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const THEMES = ['light', 'dark'] as const

describe('the diverging ramp can carry a label on every step', () => {
  const p = palettes()

  it.each(
    THEMES.flatMap((theme) => STEPS.map((step) => [theme, step] as const)),
  )('%s / %s clears AA for small text', (theme, step) => {
    const t = p[theme]
    const fill = t[`--admin-chart-div-${step}`]
    const ink = t[`--admin-chart-div-${step}-ink`]
    const ratio = contrast(fill, ink)
    expect(
      ratio,
      `--admin-chart-div-${step} (${fill}) with its ink (${ink}) is ${ratio.toFixed(2)}:1 in ${theme}`,
    ).toBeGreaterThanOrEqual(AA_SMALL_TEXT)
  })

  it('the ink assignment really does invert between the themes', () => {
    // This is the property that makes a shared literal array wrong. If a future
    // retheme makes the two agree, the inversion note in tokens.css and
    // palette.ts becomes false prose and should be rewritten — not silently left.
    const polarity = (theme: (typeof THEMES)[number]) =>
      STEPS.map((step) => (luminance(p[theme][`--admin-chart-div-${step}-ink`]) > 0.5 ? 'L' : 'D'))
    const light = polarity('light')
    const dark = polarity('dark')
    expect(light.join(''), 'light ink polarity changed shape').toBe('LDDDL')
    expect(dark.join(''), 'dark ink polarity changed shape').toBe('DLLLD')
    for (const [i, step] of STEPS.entries()) {
      expect(light[i], `${step} no longer inverts between themes`).not.toBe(dark[i])
    }
  })

  it('reads real values out of tokens.css — the vacuity control', () => {
    // Without this, a renamed token would make every assertion above run over
    // `undefined` and the suite would still be green.
    for (const theme of THEMES) {
      for (const step of STEPS) {
        for (const suffix of ['', '-ink']) {
          const name = `--admin-chart-div-${step}${suffix}`
          expect(p[theme][name], `${name} is missing from the ${theme} palette`).toMatch(
            /^#[0-9a-f]{6}$/i,
          )
        }
      }
    }
    expect(
      p.light['--admin-chart-div-neg-2'],
      'the dark palette no longer overrides the diverging ramp, so the dark cases restate the light ones',
    ).not.toBe(p.dark['--admin-chart-div-neg-2'])
  })
})
