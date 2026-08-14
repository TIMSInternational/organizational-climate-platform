import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every ink the application chrome prints must be legible on the chrome's own ground.
 *
 * ## Why this exists
 *
 * The rail, the top strip and the gutter went from `#f0f0f0` to `#1b1f24` (UI-0). The
 * chrome's text is set from `--admin-font-*`, which `.on-shell` re-points at the shell
 * palette — so from that commit onward the legibility of the navigation depends on a
 * relationship between two token groups that nothing checked. A later nudge to any shell
 * value, in either direction, would be invisible until somebody looked at a rail.
 *
 * ## The trap this covers, which the rail alone would miss
 *
 * There are **two** grounds, not one. The user menu opens INSIDE the rail and lifts to
 * `--admin-shell-bg-raised`, printing the signed-in person's role in
 * `--admin-font-tertiary` on it. That surface is lighter than the rail, so it is the
 * binding constraint: a label chosen to pass on `--admin-bg-shell` alone (`#868e99`,
 * 5.00:1 there) fails on the raised one (4.31:1). Both are asserted.
 *
 * ## Why the shell is asserted identical across themes
 *
 * The shell is the one region that deliberately does not invert — the product keeps a
 * constant frame and only the page inside it changes. If a future dark-theme override
 * reintroduces a per-theme shell value, that is a decision worth making on purpose, and
 * this test is where it gets noticed.
 */

const TOKENS = join(process.cwd(), 'src', 'styles', 'tokens.css')
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

/** Every ink the chrome prints, against every ground the chrome prints it on. */
const INKS = [
  '--admin-shell-font',
  '--admin-shell-font-strong',
  '--admin-shell-font-label',
] as const
const GROUNDS = ['--admin-bg-shell', '--admin-shell-bg-raised'] as const

describe('shell ink contrast', () => {
  for (const theme of ['light', 'dark'] as const) {
    describe(theme, () => {
      for (const ground of GROUNDS) {
        for (const ink of INKS) {
          it(`${ink} on ${ground} clears AA`, () => {
            const t = palettes()[theme]
            const ratio = contrast(t[ink], t[ground])
            expect(
              ratio,
              `${ink} (${t[ink]}) on ${ground} (${t[ground]}) is ${ratio.toFixed(2)}:1`,
            ).toBeGreaterThanOrEqual(AA_NORMAL)
          })
        }
      }

      /**
       * The selected row. `tokens.css` states that `--admin-font-on-accent` may only ever
       * sit on the FILL token, and `.nav-row[data-nav-state='selected']` used the identity
       * token instead — white on `--admin-accent-blue` is 3.74:1, under AA for a 13px row.
       */
      it('the selected nav row fill carries its own ink', () => {
        const t = palettes()[theme]
        const ratio = contrast(t['--admin-accent-blue-fill'], t['--admin-font-on-accent'])
        expect(ratio, `selected row is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_NORMAL)
      })

      /**
       * The card has to read as a surface sitting ON the shell rather than as part of it —
       * but the two themes achieve that differently, and demanding luminance separation in
       * both was wrong. In light the white card is 16.56:1 against the ink shell and the
       * edge is obvious. In dark the card (#171717) and the shell (#1b1f24) are 1.08:1
       * apart: near-identical by luminance, which is normal for a dark UI, where the edge
       * is carried by the hairline instead.
       *
       * So the guarantee is that the card's edge is findable EITHER way: the surfaces
       * differ, or the panel border does.
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

  /**
   * The token pair being legible is not the same as the RULE using it. An earlier version
   * of this file asserted only `contrast(--admin-accent-blue-fill, --admin-font-on-accent)`,
   * which stays true no matter which token `.nav-row` actually paints with — so reverting
   * the rule to the identity accent (3.74:1, the original defect) left the suite green.
   * This reads the rule.
   */
  it('the selected nav rule paints with the fill token, not the identity accent', () => {
    // Comments stripped FIRST. The prose above the rule quotes the selector verbatim, so
    // matching the raw file finds the comment and reads whatever declarations follow it --
    // the same "the regex matched the explanation, not the code" mistake that once made a
    // coverage audit report nine un-redesigned screens when the real answer was three.
    const css = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    )
    const rule = /\.nav-row\[data-nav-state='selected'\][^{]*\{([^}]*)\}/.exec(css)
    expect(rule, "index.css no longer has a .nav-row[data-nav-state='selected'] rule").not.toBeNull()
    expect(rule![1]).toContain('var(--admin-accent-blue-fill)')
    expect(
      /background:\s*var\(--admin-accent-blue\)/.test(rule![1]),
      'the selected row is painted with the identity accent, which is 3.74:1 with white',
    ).toBe(false)
  })

  it('the shell does not invert between themes', () => {
    const { light, dark } = palettes()
    for (const token of [...INKS, ...GROUNDS]) {
      expect(dark[token], `${token} differs between themes`).toBe(light[token])
    }
  })
})
