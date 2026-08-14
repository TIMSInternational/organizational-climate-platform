import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every ink the application chrome prints must be legible on the chrome's own ground.
 *
 * ## Why this exists
 *
 * The rail, the top strip and the gutter went from `#f0f0f0` to `#1b1f24` (UI-0), and
 * then from that ink slate to navy `#122c4d` when the employee redesign recoloured the
 * shell. The chrome's text is set from `--admin-font-*`, which `.on-shell` re-points at
 * the shell palette — so the legibility of the navigation depends on a relationship
 * between two token groups that nothing else checks. A later nudge to any shell value,
 * in either direction, would be invisible until somebody looked at a rail.
 *
 * ## The trap this covers, which the rail alone would miss
 *
 * There are **two** grounds, not one. The user menu opens INSIDE the rail and lifts to
 * `--admin-shell-bg-raised`, printing the signed-in person's role in
 * `--admin-font-tertiary` on it. That surface is lighter than the rail, so it is the
 * binding constraint: a label chosen to pass on `--admin-bg-shell` alone (`#868e99`,
 * 5.00:1 there) fails on the raised one (4.31:1). Both are asserted.
 *
 * ## Why the ink list is read out of `index.css` rather than written here
 *
 * "Every text tone used on the navy shell" is a claim about `.on-shell`, not about this
 * file's opinion of it. This test used to name three tokens, which meant a fourth ink
 * re-pointed onto the shell would have been chrome text that nothing measured — the
 * same shape of hole as the one in "Reading the rule, not the token pair" below. So the
 * inks are derived: whatever `.on-shell` assigns a `var(--admin-shell-*)` to is a tone
 * printed on the shell, and every one of them is measured on both grounds in both
 * themes. `derivedInks` has its own vacuity control.
 *
 * ## Why the shell now DOES invert
 *
 * It did not, and the previous version of this comment said so on purpose, adding: "if
 * a future dark-theme override reintroduces a per-theme shell value, that is a decision
 * worth making on purpose, and this test is where it gets noticed." This is that
 * moment. `employee-screens.html` (design note 08) gives the dark theme its own deeper
 * navy, because a single `#122c4d` over that theme's `#0b111b` page would be the
 * *lighter* of the two surfaces and so would read as content rather than as frame. What
 * survives is the property the old assertion was reaching for — a constant frame — now
 * pinned as constant HUE plus a depth that only ever moves one way. See
 * `the shell stays one navy frame across both themes`.
 */

const TOKENS = join(process.cwd(), 'src', 'styles', 'tokens.css')
const INDEX = join(process.cwd(), 'src', 'index.css')
const DARK_SELECTOR = ":root[data-admin-theme='dark']"

/** WCAG AA for body-sized text. The rail's rows are 13px and its labels 10px. */
const AA_NORMAL = 4.5

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

/** `index.css` with comments stripped, for the same reason the nav-row test strips them. */
function rules(): string {
  return readFileSync(INDEX, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
}

function rgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  expect(m, `expected a 6-digit hex colour, got ${JSON.stringify(hex)}`).not.toBeNull()
  const n = parseInt(m![1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

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

/**
 * The shell inks, read off `.on-shell` — the rule that recolours the rail and the top
 * strip by re-pointing the generic ink tokens at the shell palette. Every
 * `--admin-shell-*` value it assigns to an ink role is a tone that gets printed on the
 * navy, so every one of them is measured below.
 */
function derivedInks(): string[] {
  const block = /\.on-shell\s*\{([^}]*)\}/.exec(rules())
  expect(block, 'index.css no longer has an .on-shell rule').not.toBeNull()
  // Ink roles only: the `--admin-font-*` re-pointings plus `.on-shell`'s own `color`.
  // The rule also re-points backgrounds and borders at the shell palette, and a
  // hairline is not held to 4.5:1.
  const matches = block![1].matchAll(
    /(?:--admin-font-[\w-]+|color):\s*var\((--admin-shell-[\w-]+)\)/g,
  )
  return [...new Set([...matches].map((m) => m[1]))].sort()
}

/**
 * Reading the rule, not the token pair. An earlier version of this file asserted only
 * `contrast(--admin-accent-blue-fill, --admin-font-on-accent)`, which stays true no
 * matter which token `.nav-row` actually paints with — so reverting the rule to the
 * identity accent (3.74:1, the original defect) left the suite green. Both ends of the
 * pairing are read out of the shipped rule instead.
 */
function selectedRow(): { fill: string; ink: string } {
  // Comments stripped FIRST (by `rules()`). The prose above the rule quotes the selector
  // verbatim, so matching the raw file finds the comment and reads whatever declarations
  // follow it -- the same "the regex matched the explanation, not the code" mistake that
  // once made a coverage audit report nine un-redesigned screens when the real answer
  // was three.
  const rule = /\.nav-row\[data-nav-state='selected'\][^{]*\{([^}]*)\}/.exec(rules())
  expect(rule, "index.css no longer has a .nav-row[data-nav-state='selected'] rule").not.toBeNull()
  const fill = /background:\s*var\((--admin-[\w-]+)\)/.exec(rule![1])
  const ink = /color:\s*var\((--admin-[\w-]+)\)/.exec(rule![1])
  expect(fill, 'the selected nav row declares no background token').not.toBeNull()
  expect(ink, 'the selected nav row declares no colour token').not.toBeNull()
  return { fill: fill![1], ink: ink![1] }
}

/** Every ground the chrome prints those inks on. */
const GROUNDS = ['--admin-bg-shell', '--admin-shell-bg-raised'] as const

describe('shell ink contrast', () => {
  /**
   * The vacuity control for the derivation. If the regex or the selector ever stopped
   * matching, `derivedInks()` would return nothing and the whole table below would
   * become zero test cases — a green suite that measures no pairing at all. Three inks
   * are re-pointed today (strong for headings, the base for row text, the label for
   * section titles and the user menu's role line); the assertion is a floor rather than
   * an equality so that adding a fourth is a change this file *covers* rather than one
   * it rejects.
   */
  it('reads the shell inks out of .on-shell rather than naming them here', () => {
    const inks = derivedInks()
    expect(inks.length, 'no shell ink was derived from .on-shell').toBeGreaterThanOrEqual(3)
    expect(inks).toContain('--admin-shell-font')
    expect(inks).toContain('--admin-shell-font-strong')
    expect(inks).toContain('--admin-shell-font-label')
  })

  for (const theme of ['light', 'dark'] as const) {
    describe(theme, () => {
      it.each(GROUNDS.flatMap((ground) => derivedInks().map((ink) => [ink, ground] as const)))(
        '%s on %s clears AA',
        (ink, ground) => {
          const t = palettes()[theme]
          const ratio = contrast(t[ink], t[ground])
          expect(
            ratio,
            `${ink} (${t[ink]}) on ${ground} (${t[ground]}) is ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(AA_NORMAL)
        },
      )

      /**
       * The selected row, measured against the tokens the RULE actually names.
       *
       * `tokens.css` states that `--admin-font-on-accent` may only ever sit on the FILL
       * token, and `.nav-row[data-nav-state='selected']` used the identity token instead
       * — white on `--admin-accent-blue` is 3.74:1, under AA for a 13px row. Asserting
       * the fill/ink pair by name would keep passing whatever the rule was changed to,
       * so both ends are read out of the rule: "the active row's ink against whatever
       * fills it" is then a claim about the shipped row and not about a pair of tokens
       * that happen to be legible together.
       */
      it("the active nav row's ink clears AA on whatever fills it", () => {
        const { fill, ink } = selectedRow()
        const t = palettes()[theme]
        const ratio = contrast(t[fill], t[ink])
        expect(
          ratio,
          `the selected row prints ${ink} (${t[ink]}) on ${fill} (${t[fill]}), ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(AA_NORMAL)
      })

      /**
       * The other half of "blue on the shell, white inside": the content ground is now
       * #ffffff, and the ink the pages actually set their prose in has to clear AA on
       * it. `--admin-font-secondary` is that ink — the repo's own convention, arrived at
       * the hard way in `PageTopBar`, `DashboardSurveyTable`, `KpiTile` and `ClimateMap`,
       * all of which reach for it *because* `--admin-font-tertiary` does not clear 4.5:1
       * on white (3.66:1 after the recolour, 3.90:1 before it).
       *
       * Both white surfaces, not just the panel: the recessed one is where a KPI label
       * and a neutral chip land, and it is the darker of the two, so it binds first.
       */
      it.each(['--admin-bg-panel', '--admin-bg-icon-box'] as const)(
        'the muted content ink clears AA on %s',
        (ground) => {
          const t = palettes()[theme]
          const ratio = contrast(t['--admin-font-secondary'], t[ground])
          expect(
            ratio,
            `--admin-font-secondary (${t['--admin-font-secondary']}) on ${ground} (${t[ground]}) is ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(AA_NORMAL)
        },
      )

      /**
       * The card has to read as a surface sitting ON the shell rather than as part of it —
       * but the two themes achieve that differently, and demanding luminance separation in
       * both was wrong. In light the white card is 14.06:1 against the navy shell and the
       * edge is obvious. In dark the card (#121a26) and the shell (#0a1c31) are 1.02:1
       * apart: near-identical by luminance, which is normal for a dark UI, where the edge
       * is carried by the hairline instead.
       *
       * So the guarantee is that the card's edge is findable EITHER way: the surfaces
       * differ, or the panel border does. Dark passes on the border, at 1.3026:1 against
       * the 1.3 floor — the tightest number in the palette, and the reason `tokens.css`
       * carries a do-not-nudge note on `--admin-border-panel`.
       */
      it('the content card has a findable edge against the shell', () => {
        const t = palettes()[theme]
        const bySurface = contrast(t['--admin-bg-panel'], t['--admin-bg-shell'])
        const byBorder = Math.min(
          contrast(t['--admin-border-panel'], t['--admin-bg-panel']),
          contrast(t['--admin-border-panel'], t['--admin-bg-shell']),
        )
        expect(
          Math.max(bySurface, byBorder),
          `surface separation ${bySurface.toFixed(2)}:1, border separation ${byBorder.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(1.3)
      })
    })
  }

  it('the selected nav rule paints with the fill token, not the identity accent', () => {
    const { fill, ink } = selectedRow()
    expect(fill).toBe('--admin-accent-blue-fill')
    expect(ink).toBe('--admin-font-on-accent')
    expect(
      fill,
      'the selected row is painted with the identity accent, which is 3.74:1 with white',
    ).not.toBe('--admin-accent-blue')
  })

  /**
   * What replaced "the shell does not invert".
   *
   * The frame is still one thing across the two themes, but it is now one thing by HUE
   * rather than by hex: navy in both, deeper in dark. Two ways that could rot, and both
   * are asserted, because either would be invisible until somebody opened a rail:
   *
   *  1. Somebody "simplifies" the shell back to a neutral. A navy has a blue channel
   *     clearly above its red one; `#1b1f24`, the slate this replaced, has 36 vs 27 and
   *     would fail the margin.
   *  2. Somebody deepens light or lightens dark until the light shell is the darker of
   *     the two, which inverts the frame relative to the page and undoes the whole
   *     reason dark got its own value.
   *
   * The inks are deliberately NOT pinned to a single value here — `--admin-shell-font-label`
   * legitimately differs per theme, and the table above is what keeps both legible.
   */
  it('the shell stays one navy frame across both themes', () => {
    const { light, dark } = palettes()
    for (const [theme, ground] of [
      ['light', light['--admin-bg-shell']],
      ['dark', dark['--admin-bg-shell']],
    ] as const) {
      const [r, g, b] = rgb(ground)
      expect(b, `the ${theme} shell ${ground} is not blue-dominant`).toBeGreaterThan(g)
      expect(
        b - r,
        `the ${theme} shell ${ground} is too close to a neutral to read as navy`,
      ).toBeGreaterThanOrEqual(24)
    }
    expect(
      luminance(dark['--admin-bg-shell']),
      `the dark shell ${dark['--admin-bg-shell']} is lighter than the light shell ${light['--admin-bg-shell']}, ` +
        'which puts the frame on the wrong side of its own page',
    ).toBeLessThan(luminance(light['--admin-bg-shell']))
  })
})
