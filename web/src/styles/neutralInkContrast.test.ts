import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every step of the neutral ramp must carry the count printed inside it.
 *
 * `DistributionStrip` paints answer shares with `--admin-chart-neutral-1..5` and prints each
 * segment's count in the paired `-ink`. As with the diverging inks, the assignment inverts
 * between the themes (dark on the light steps of the light ramp, light on the dark steps of
 * the dark one), so one shared ink would be illegible in one theme. The values are parsed
 * out of `tokens.css`, never restated: a guard that restates what it guards agrees with
 * itself while both are wrong (`divInkContrast.test.ts`).
 */

const TOKENS = join(process.cwd(), 'src', 'styles', 'tokens.css')
const DARK_SELECTOR = ":root[data-admin-theme='dark']"
/** The strip's counts are 11px: WCAG AA for small text. */
const AA_SMALL_TEXT = 4.5
const STEPS = [1, 2, 3, 4, 5] as const

function declarations(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/(--admin-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
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

describe('the neutral ramp can carry a count on every step', () => {
  const { light, dark } = palettes()

  for (const [theme, palette] of [['light', light], ['dark', dark]] as const) {
    for (const step of STEPS) {
      it(`${theme} step ${step}: its ink clears ${AA_SMALL_TEXT}:1`, () => {
        const fill = palette[`--admin-chart-neutral-${step}`]
        const ink = palette[`--admin-chart-neutral-${step}-ink`]
        expect(fill, `--admin-chart-neutral-${step} missing in ${theme}`).toBeDefined()
        expect(ink, `--admin-chart-neutral-${step}-ink missing in ${theme}`).toBeDefined()
        expect(contrast(fill, ink)).toBeGreaterThanOrEqual(AA_SMALL_TEXT)
      })
    }

    it(`${theme}: the ramp is ordered, each step further from the card than the last`, () => {
      const card = palette['--admin-bg-card']
      const distances = STEPS.map((step) => contrast(palette[`--admin-chart-neutral-${step}`], card))
      for (let i = 1; i < distances.length; i++) expect(distances[i]).toBeGreaterThan(distances[i - 1])
    })

    it(`${theme}: every step is a grey, not a hue that could read as a result area`, () => {
      for (const step of STEPS) {
        const n = parseInt(palette[`--admin-chart-neutral-${step}`].slice(1), 16)
        const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
        // The same 12/255 channel-spread fence palette.test.ts holds the diverging midpoint to,
        // widened to 30 for the darkest steps, where the shell's blue bias is proportionally larger.
        expect(Math.max(...channels) - Math.min(...channels)).toBeLessThanOrEqual(30)
      }
    })
  }
})
