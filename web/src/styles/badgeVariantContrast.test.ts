import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The badge variants the #94 tables use must stay legible in BOTH themes.
 *
 * ## Why this exists
 *
 * `ui/badgeVariants.ts` offers six variants. Measured against `styles/tokens.css` in
 * light and dark, only two of them clear WCAG AA 1.4.3 (4.5:1, and badge text is
 * `text-xs`, so 4.5 is the right threshold, not 3.0):
 *
 * | variant | light | dark |
 * |---|---|---|
 * | `default` — accent-blue on blue-soft | 3.45:1 | 4.25:1 |
 * | `success` — accent-green on green-soft | 3.49:1 | 6.14:1 |
 * | `warning` — accent-amber on amber-soft | 2.99:1 | 7.05:1 |
 * | `destructive` — font-on-accent on accent-red | 4.83:1 | 3.76:1 |
 * | `secondary` — font-secondary on icon-box | 8.15:1 | 6.85:1 |
 * | `outline` — font-primary on panel | 18.42:1 | 15.04:1 |
 *
 * That is the project's documented recurring blind spot in both directions at once: the
 * three soft variants fail in *light* while passing in dark, and `destructive` fails in
 * *dark* while passing in light. `charts/RecommendationCard.tsx` already maps priority
 * onto `warning`/`destructive`, so the defect is pre-existing and system-wide; repainting
 * six variants is its own change to a shared primitive, not this issue's.
 *
 * What #94 could do — and did — is not add new instances. Reports' status column,
 * AI insights' priority column and benchmarks' scope column all use `secondary` or
 * `outline` and let the word carry the meaning (which WCAG 1.4.1 wants anyway). This
 * test pins that those two variants really are legible, in both themes, so the choice
 * cannot be quietly undone by a token nudge.
 *
 * Measured from the stylesheet rather than from a hardcoded hex list, for the reason
 * `seqInkContrast.test.ts` gives: a guard that restates the values it guards can agree
 * with itself while both are wrong.
 */

const TOKENS = join(process.cwd(), 'src', 'styles', 'tokens.css')
const DARK_SELECTOR = ":root[data-admin-theme='dark']"

type Rgba = [number, number, number, number]

function declarations(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/(--admin-[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]),
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

function parseColor(value: string): Rgba {
  const hex = value.match(/^#([0-9a-fA-F]{6})$/)
  if (hex) {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16))
    return [r, g, b, 1]
  }
  const rgb = value.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/)
  if (rgb) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])]
  }
  throw new Error(`Unparseable colour: ${value}`)
}

/** Composites a translucent fill over an opaque surface. */
function flatten(fill: Rgba, surface: Rgba): Rgba {
  const [, , , alpha] = fill
  return [
    ...([0, 1, 2] as const).map((i) => Math.round(fill[i] * alpha + surface[i] * (1 - alpha))),
    1,
  ] as Rgba
}

function relativeLuminance([r, g, b]: Rgba): number {
  const channel = (value: number): number => {
    const scaled = value / 255
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrastRatio(a: Rgba, b: Rgba): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

/** WCAG AA 1.4.3 for text below 18.66px bold / 24px regular. Badge text is 12px. */
const AA_SMALL_TEXT = 4.5

/** The two variants #94's tables are allowed to use, as (text, fill) token pairs. */
const SAFE_VARIANTS: ReadonlyArray<{ variant: string; ink: string; fill: string }> = [
  { variant: 'secondary', ink: '--admin-font-secondary', fill: '--admin-bg-icon-box' },
  // `outline` is `bg-transparent`, so it takes the panel it sits on.
  { variant: 'outline', ink: '--admin-font-primary', fill: '--admin-bg-panel' },
]

describe('badge variants used by the reports and analytics tables', () => {
  const { light, dark } = palettes()
  const themes = [
    ['light', light],
    ['dark', dark],
  ] as const

  it.each(
    SAFE_VARIANTS.flatMap(({ variant, ink, fill }) =>
      themes.map(([theme, palette]) => [variant, theme, palette, ink, fill] as const),
    ),
  )('%s clears AA in %s', (_variant, _theme, palette, ink, fill) => {
    const surface = parseColor(palette['--admin-bg-panel'])
    const ratio = contrastRatio(parseColor(palette[ink]), flatten(parseColor(palette[fill]), surface))
    expect(ratio).toBeGreaterThanOrEqual(AA_SMALL_TEXT)
  })

  it('measures a real failure too, so a broken measurement cannot pass everything', () => {
    // Guard the guard. `warning` in light mode is the worst pairing in the set at
    // 2.99:1; if this ever clears AA, the tokens were fixed and the pages above can go
    // back to hued variants — which is worth being told about rather than discovering.
    const surface = parseColor(light['--admin-bg-panel'])
    const ratio = contrastRatio(
      parseColor(light['--admin-accent-amber']),
      flatten(parseColor(light['--admin-accent-bg-amber']), surface),
    )
    expect(ratio).toBeLessThan(AA_SMALL_TEXT)
  })
})
