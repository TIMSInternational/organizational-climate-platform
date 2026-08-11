import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The state words must be legible on every surface they land on, in both themes.
 *
 * ## Why this exists
 *
 * UI-3 puts three all-caps state words on screen at `text-2xs` — PROTECTED beside
 * the anonymity hatch in `LiveSessionPanel` and `MicroclimateList`, ACTIVE in the
 * live card's header, PAST DUE beside an action plan's due date. The first draft
 * set them in `text-accent-amber` / `text-accent-green` / `text-accent-red`, and
 * measured against `tokens.css` those pairings are:
 *
 * | ink | on `bg-panel` | on `bg-icon-box` |
 * |---|---|---|
 * | light `--admin-accent-amber` `#d97706` | 3.19:1 | 2.80:1 |
 * | light `--admin-accent-green` `#059669` | 3.77:1 | 3.31:1 |
 * | light `--admin-accent-red` `#dc2626` | 4.83:1 | 4.24:1 |
 * | dark `--admin-accent-red` `#ef4444` | 4.76:1 | 3.81:1 |
 *
 * `--admin-text-2xs` is `0.625rem` = 10px, so WCAG AA 1.4.3 asks 4.5:1, not the
 * 3:1 that applies to large text and to non-text contrast. Five of those eight
 * numbers fail, including the one carrying the anonymity guarantee — the single
 * claim this product most needs a reader to believe.
 *
 * Raising the type size does not fix it: 4.5 applies below 18.66px bold, and these
 * words are labels. The value has to move, which is why `tokens.css` now separates
 * identity from ink per state hue exactly as it already separates
 * `--admin-accent-blue` from `--admin-accent-blue-fill`.
 *
 * ## What it checks, and the two controls
 *
 * Every `--admin-accent-*-ink`, against both surfaces, in both themes. Values are
 * parsed out of `tokens.css` rather than restated here, for the reason
 * `seqInkContrast.test.ts` and `divInkContrast.test.ts` both give: a guard that
 * restates the values it guards can agree with itself while both are wrong.
 *
 * The vacuity control pins that the token names still resolve, so a rename cannot
 * leave every assertion running over `undefined` with the suite still green. The
 * second control measures the *plain* accent on the worst surface and requires it
 * to still fail — if a future retheme makes the identity accents legible as small
 * text, these ink tokens are redundant and should be deleted rather than left to
 * accumulate, and that is worth being told about instead of discovering.
 */

const TOKENS = join(process.cwd(), 'src', 'styles', 'tokens.css')
const DARK_SELECTOR = ":root[data-admin-theme='dark']"

/** WCAG AA 1.4.3 below 18.66px bold / 24px regular. These words are 10px. */
const AA_SMALL_TEXT = 4.5

const HUES = ['green', 'amber', 'red'] as const
const THEMES = ['light', 'dark'] as const
/** Every surface a state word sits on in UI-3: the table/panel, and the live card. */
const SURFACES = ['--admin-bg-panel', '--admin-bg-icon-box'] as const

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
  // The dark block overrides the light one rather than restating it.
  return { light, dark: { ...light, ...declarations(css.slice(cut)) } }
}

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  expect(m, `expected a 6-digit hex colour, got ${JSON.stringify(hex)}`).not.toBeNull()
  const n = parseInt(m![1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((c) => {
      const s = c / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    })
    .reduce((acc, v, i) => acc + [0.2126, 0.7152, 0.0722][i] * v, 0)
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('the state hues can carry a word', () => {
  const p = palettes()

  it.each(
    THEMES.flatMap((theme) =>
      HUES.flatMap((hue) => SURFACES.map((surface) => [theme, hue, surface] as const)),
    ),
  )('%s / accent-%s-ink clears AA on %s', (theme, hue, surface) => {
    const t = p[theme]
    const ink = t[`--admin-accent-${hue}-ink`]
    const ratio = contrast(ink, t[surface])
    expect(
      ratio,
      `--admin-accent-${hue}-ink (${ink}) on ${surface} (${t[surface]}) is ${ratio.toFixed(2)}:1 in ${theme}`,
    ).toBeGreaterThanOrEqual(AA_SMALL_TEXT)
  })

  it('measures a real failure too, so a broken measurement cannot pass everything', () => {
    // Guard the guard, and the reason the ink tokens exist. Light amber on the
    // icon box is the worst pairing in the set at 2.80:1. If this ever clears AA
    // the identity accents became legible as text on their own and these tokens
    // should be deleted, not quietly kept.
    const worst = contrast(p.light['--admin-accent-amber'], p.light['--admin-bg-icon-box'])
    expect(worst).toBeLessThan(AA_SMALL_TEXT)
  })

  it('reads real values out of tokens.css — the vacuity control', () => {
    for (const theme of THEMES) {
      for (const name of [
        ...HUES.map((hue) => `--admin-accent-${hue}-ink`),
        ...HUES.map((hue) => `--admin-accent-${hue}`),
        ...SURFACES,
      ]) {
        expect(p[theme][name], `${name} is missing from the ${theme} palette`).toMatch(
          /^#[0-9a-f]{6}$/i,
        )
      }
    }
    expect(
      p.light['--admin-accent-red-ink'],
      'the dark palette no longer overrides the state inks, so the dark cases restate the light ones',
    ).not.toBe(p.dark['--admin-accent-red-ink'])
  })

  it('exposes each ink as a utility, next to the accent it belongs to', () => {
    // Without this the tokens exist and `text-accent-amber-ink` still compiles to
    // nothing — the failure mode utilityExistence.test.ts was written for.
    const theme = readFileSync(join(process.cwd(), 'src', 'styles', 'theme.css'), 'utf8')
    for (const hue of HUES) {
      expect(theme).toContain(`--color-accent-${hue}-ink: var(--admin-accent-${hue}-ink);`)
    }
  })
})
