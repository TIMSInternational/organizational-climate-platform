import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buttonVariants } from '../components/ui/buttonVariants'

/**
 * The accent is two tokens, and this is the guard that keeps it that way.
 *
 * ## Why this exists
 *
 * UI-0 revalued `--admin-accent-blue` from the legacy `#2e9098` to `#0d9488`.
 * The legacy value measures oklch chroma 0.0887, below the 0.1 floor the dataviz
 * rules use, which is the measured reason the product read grey rather than teal.
 *
 * The revalue on its own would have shipped a contrast regression. The app pairs
 * accent fills with `--admin-font-on-accent: #ffffff` (the selected nav row, the
 * primary button, `SidebarUserMenu`), and white on `#0d9488` is 3.74:1 — under
 * the 4.5:1 this project already committed to in `badgeVariantContrast.test.ts`
 * ("badge text is `text-xs`, so 4.5 is the right threshold, not 3.0").
 *
 * **The two constraints cannot be satisfied by one value on this hue.** The
 * lightest hue-matched teal that clears 4.5:1 is `#0e857b`, and its chroma is
 * 0.0951 — back under the floor. Widening the search finds only blues, which
 * abandon the brand and collide with `--admin-chart-series-4`. So identity and
 * fill are separate tokens, and this file pins each to the job it can actually do:
 *
 * | token | job | requirement |
 * |---|---|---|
 * | `--admin-accent-blue` | identity — borders, focus ring, icons, tints, chart series 1 | chroma ≥ 0.1, and ≥ 3:1 on its own panel (WCAG 1.4.11) |
 * | `--admin-accent-blue-fill` | the only surface `--admin-font-on-accent` may sit on | ≥ 4.5:1 with the on-accent ink (WCAG 1.4.3) |
 * | `--admin-accent-blue-fill-hover` | hover/active for that fill | ≥ 4.5:1 with the ink **and** ≥ 3:1 against the panel |
 *
 * That last row is the one worth keeping. Hover has to move in OPPOSITE
 * directions per theme: light darkens, but the same darkened step is 2.36:1
 * against the dark panel `#171717`, so in dark the button would dissolve into the
 * page. Dark lightens instead. A future edit that "makes hover consistent" across
 * the two themes reintroduces exactly that, and this test is what refuses it.
 *
 * ## How it is measured
 *
 * Values are parsed out of `tokens.css`, never restated here — the reason
 * `seqInkContrast.test.ts` and `badgeVariantContrast.test.ts` both give: a guard
 * that restates the values it guards can agree with itself while both are wrong.
 * The vacuity control at the bottom is because that parsing is the failure mode:
 * a renamed token would otherwise make every assertion below pass over `undefined`.
 */

const TOKENS = join(process.cwd(), 'src', 'styles', 'tokens.css')
const THEME = join(process.cwd(), 'src', 'styles', 'theme.css')
const DARK_SELECTOR = ":root[data-admin-theme='dark']"

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

function rgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  expect(m, `expected a 6-digit hex colour, got ${JSON.stringify(hex)}`).not.toBeNull()
  const n = parseInt(m![1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** WCAG 2.x relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Chroma in oklch — the axis the "reads grey" finding was measured on. */
function chroma(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  const cbrt = (v: number) => Math.cbrt(v)
  const l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
  return Math.hypot(A, B)
}

const AA_TEXT = 4.5
const AA_NON_TEXT = 3.0
const CHROMA_FLOOR = 0.1

const THEMES = ['light', 'dark'] as const

describe('the accent is split into an identity token and a fill token', () => {
  const p = palettes()

  it.each(THEMES)(
    'in %s, white-on-accent sits on the FILL and clears AA for normal text',
    (theme) => {
      const t = p[theme]
      const ratio = contrast(t['--admin-accent-blue-fill'], t['--admin-font-on-accent'])
      expect(
        ratio,
        `--admin-font-on-accent on --admin-accent-blue-fill is ${ratio.toFixed(2)}:1 in ${theme}`,
      ).toBeGreaterThanOrEqual(AA_TEXT)
    },
  )

  it.each(THEMES)(
    'in %s, the IDENTITY accent is deliberately NOT safe for white text — proving the split earns its keep',
    (theme) => {
      const t = p[theme]
      const ratio = contrast(t['--admin-accent-blue'], t['--admin-font-on-accent'])
      // If this ever passes, the identity accent got dark enough to carry white
      // text, which means it also fell under the chroma floor and the whole
      // reason for the revalue is gone. Either way the split needs rethinking
      // rather than silently collapsing back to one token.
      expect(
        ratio,
        `--admin-accent-blue reached ${ratio.toFixed(2)}:1 with white in ${theme}; ` +
          're-derive the split before merging (see the header of this file)',
      ).toBeLessThan(AA_TEXT)
    },
  )

  it.each(THEMES)('in %s, the identity accent clears the chroma floor', (theme) => {
    const c = chroma(p[theme]['--admin-accent-blue'])
    expect(
      c,
      `--admin-accent-blue chroma is ${c.toFixed(4)} in ${theme}; under ${CHROMA_FLOOR} it reads grey`,
    ).toBeGreaterThanOrEqual(CHROMA_FLOOR)
  })

  it.each(THEMES)(
    'in %s, the identity accent is visible against its own panel (1.4.11)',
    (theme) => {
      const t = p[theme]
      const ratio = contrast(t['--admin-accent-blue'], t['--admin-bg-panel'])
      expect(
        ratio,
        `--admin-accent-blue on --admin-bg-panel is ${ratio.toFixed(2)}:1 in ${theme}`,
      ).toBeGreaterThanOrEqual(AA_NON_TEXT)
    },
  )

  it.each(THEMES)('in %s, hover keeps its text legible AND stays off the panel', (theme) => {
    const t = p[theme]
    const onInk = contrast(t['--admin-accent-blue-fill-hover'], t['--admin-font-on-accent'])
    expect(
      onInk,
      `hover fill is ${onInk.toFixed(2)}:1 with the on-accent ink in ${theme}`,
    ).toBeGreaterThanOrEqual(AA_TEXT)

    // The trap: the light-theme hover step is 2.36:1 on the dark panel. A hover
    // that darkens in dark mode dissolves the button into the page.
    const onPanel = contrast(t['--admin-accent-blue-fill-hover'], t['--admin-bg-panel'])
    expect(
      onPanel,
      `hover fill is ${onPanel.toFixed(2)}:1 against --admin-bg-panel in ${theme}; ` +
        'in dark, hover must LIGHTEN rather than darken',
    ).toBeGreaterThanOrEqual(AA_NON_TEXT)
  })

  it('hover moves away from the panel in both themes, in whichever direction that takes', () => {
    // Stated as a relationship rather than a pair of hexes so it keeps meaning
    // after a future revalue: hover must be further from the panel than the
    // resting fill is, which is what makes it read as a state change at all.
    for (const theme of THEMES) {
      const t = p[theme]
      const resting = contrast(t['--admin-accent-blue-fill'], t['--admin-bg-panel'])
      const hovered = contrast(t['--admin-accent-blue-fill-hover'], t['--admin-bg-panel'])
      expect(
        hovered,
        `in ${theme} the hover fill (${hovered.toFixed(2)}:1 vs panel) is not more ` +
          `separated from the panel than the resting fill (${resting.toFixed(2)}:1)`,
      ).toBeGreaterThan(resting)
    }
  })

  /**
   * The rule above, followed through to the one component that has to obey it.
   *
   * Splitting the accent only helps if the call sites move. `buttonVariants`
   * paired `text-fg-on-accent` with `bg-accent-blue` — the identity token — which
   * is 3.74:1 in light and 2.49:1 in dark against a label the base classes set at
   * `text-base` (0.8125rem = 13px, normal text under WCAG 1.4.3, so 4.5:1). The
   * catalogue grid on /surveys/templates puts six of those buttons on one screen.
   *
   * Nothing else would have caught it: `tokenDiscipline` sees a token-shaped class
   * and passes it, `utilityExistence` does not enter cva tables, and the ratio
   * lives in tokens.css where no component test looks.
   *
   * Every step here is *derived* rather than restated — the class comes out of the
   * variant table, the custom property out of theme.css, the hex out of tokens.css
   * — so this cannot agree with itself while the button is wrong.
   */
  const themeVars = Object.fromEntries(
    [...readFileSync(THEME, 'utf8').matchAll(/(--color-[\w-]+):\s*var\((--admin-[\w-]+)\)/g)].map(
      (m) => [m[1], m[2]],
    ),
  )

  /** `bg-accent-blue-fill` -> the `--admin-*` token theme.css maps it to. */
  function tokenFor(utility: string): string {
    const property = `--color-${utility.replace(/^(?:bg|text)-/, '')}`
    const token = themeVars[property]
    expect(token, `theme.css declares no ${property}, so ${utility} compiles to nothing`).toBeTruthy()
    return token
  }

  function classes(variant: 'primary'): string[] {
    return buttonVariants({ variant }).split(/\s+/).filter(Boolean)
  }

  it.each(THEMES)('in %s, the primary button carries its label at AA', (theme) => {
    const t = p[theme]
    const found = classes('primary')
    const background = found.find((c) => /^bg-/.test(c))
    const ink = found.find((c) => /^text-(?!base$)/.test(c))
    expect(background, 'the primary variant names no background class').toBeTruthy()
    expect(ink, 'the primary variant names no text colour class').toBeTruthy()

    const ratio = contrast(t[tokenFor(background!)], t[tokenFor(ink!)])
    expect(
      ratio,
      `${ink} on ${background} is ${ratio.toFixed(2)}:1 in ${theme}; the button label is ` +
        'text-base (13px), which 1.4.3 counts as normal text. Put it on ' +
        'bg-accent-blue-fill, not bg-accent-blue.',
    ).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it.each(THEMES)('in %s, the primary button stays legible while hovered', (theme) => {
    const t = p[theme]
    // `opacity-90` would have been the easy hover and it is the wrong one: fading
    // the fill toward the panel gives back exactly the contrast the fill exists to
    // provide. The paired hover token moves per theme instead (light darkens, dark
    // lightens) and is measured above.
    const hover = classes('primary')
      .map((c) => /^hover:(?:not-disabled:)?(bg-.+)$/.exec(c)?.[1])
      .find(Boolean)
    expect(hover, 'the primary variant changes no background on hover').toBeTruthy()
    const ink = classes('primary').find((c) => /^text-(?!base$)/.test(c))!

    const ratio = contrast(t[tokenFor(hover!)], t[tokenFor(ink)])
    expect(ratio, `hovered primary is ${ratio.toFixed(2)}:1 in ${theme}`).toBeGreaterThanOrEqual(
      AA_TEXT,
    )
  })

  it('reads real values out of tokens.css — the vacuity control', () => {
    // Every assertion above would pass over `undefined` if a token were renamed,
    // because rgb() would throw on `undefined` only when reached. Prove the
    // parse actually found each token, in each theme, and that the two themes
    // genuinely differ (a dark block that silently stopped overriding would
    // otherwise make the dark cases restate the light ones).
    const required = [
      '--admin-accent-blue',
      '--admin-accent-blue-fill',
      '--admin-accent-blue-fill-hover',
      '--admin-font-on-accent',
      '--admin-bg-panel',
    ]
    for (const theme of THEMES) {
      for (const name of required) {
        expect(p[theme][name], `${name} is missing from the ${theme} palette`).toMatch(
          /^#[0-9a-f]{6}$/i,
        )
      }
    }
    expect(
      p.light['--admin-bg-panel'],
      'the dark palette no longer overrides --admin-bg-panel, so the dark cases are testing light values',
    ).not.toBe(p.dark['--admin-bg-panel'])
    expect(
      p.light['--admin-accent-blue'],
      'the dark palette no longer overrides --admin-accent-blue',
    ).not.toBe(p.dark['--admin-accent-blue'])
  })
})
