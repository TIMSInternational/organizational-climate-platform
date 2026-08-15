import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every ink/surface pair the wizard rail writes must clear WCAG AA in BOTH palettes.
 *
 * ## Why this file exists
 *
 * The rail states four step conditions, and the obvious way to state them is the way the
 * approved prototype does — a coloured ink on a soft fill of the same hue. Measured
 * against `styles/tokens.css` over `--admin-bg-panel`, the surface the rail sits on,
 * every version of that fails in light mode:
 *
 * | pairing | light | dark |
 * |---|---|---|
 * | `--admin-accent-green` on `--admin-accent-bg-green` | **3.49:1** | 6.14:1 |
 * | `--admin-accent-amber` on `--admin-accent-bg-amber` | **2.99:1** | 7.11:1 |
 * | `--admin-accent-blue` on `--admin-accent-bg-blue` | **3.40:1** | 6.23:1 |
 * | `--admin-accent-green` on the bare panel | **3.77:1** | 7.07:1 |
 * | `--admin-font-on-accent` on solid `--admin-accent-blue` | **3.74:1** | **2.49:1** |
 * | `--admin-font-tertiary` on `--admin-bg-icon-box` | **3.42:1** | **3.68:1** |
 *
 * The first three agree with `badgeVariantContrast.test.ts`'s own table to within
 * rounding, which is the point: this is the third place in the repository to measure
 * these tokens and get the same answer.
 *
 * `styles/badgeVariantContrast.test.ts` reached the same conclusion for `Badge`'s six
 * variants and records that only `secondary` and `outline` clear AA in both themes;
 * `features/surveys/respondContrast.test.ts` reached it for `text-fg-tertiary` and bans
 * that class from its whole feature. The rail is a third arrival at the same wall, so
 * the pairs it settled on are pinned here rather than trusted.
 *
 * None of these failures is visible to `tsc`, to oxlint or to
 * `styles/utilityExistence.test.ts`: every one of those classes compiles perfectly. Nor
 * to a screenshot, which is where this project's documented blind spot lives — a soft
 * green on white looks *fine* and measures 3.10.
 *
 * ## What it checks
 *
 * The PAIRS below are the claim. The sweep at the bottom is what stops the claim going
 * stale: if a banned accent ink or `text-fg-tertiary` reappears in a `className` in this
 * directory, this fails.
 *
 * Values come from the stylesheet rather than a hardcoded hex list, for the reason
 * `seqInkContrast.test.ts` gives — a guard that restates the values it guards can agree
 * with itself while both are wrong.
 */

const TOKENS = join(process.cwd(), 'src', 'styles', 'tokens.css')
const STEPPER = join(process.cwd(), 'src', 'components', 'wizard', 'WizardStepper.tsx')
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
    return [
      Number(rgb[1]),
      Number(rgb[2]),
      Number(rgb[3]),
      rgb[4] === undefined ? 1 : Number(rgb[4]),
    ]
  }
  throw new Error(`Unparseable colour: ${value}`)
}

/** Composites a translucent fill over the opaque surface behind it. */
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

/**
 * WCAG AA 1.4.3. Nothing in the rail is larger than the 20px meter, which is below the
 * 24px large-text threshold, so the small-text ratio is the right one throughout.
 */
const AA_SMALL_TEXT = 4.5

interface Pair {
  what: string
  ink: string
  /** The fill written on the element. Translucent fills composite over `base`. */
  fill: string
  /** The opaque surface behind `fill`. The rail sits on the shell's content panel. */
  base: string
}

const PAIRS: readonly Pair[] = [
  // The meter, which sits in its own recessed box.
  { what: 'the progress eyebrow', ink: '--admin-font-secondary', fill: '--admin-bg-icon-box', base: '--admin-bg-panel' },
  { what: 'the completion reading', ink: '--admin-font-primary', fill: '--admin-bg-icon-box', base: '--admin-bg-panel' },
  { what: 'the completion denominator', ink: '--admin-font-secondary', fill: '--admin-bg-icon-box', base: '--admin-bg-panel' },
  // The four step markers. All four take the primary ink; only the tint changes.
  { what: 'the current step ordinal', ink: '--admin-font-primary', fill: '--admin-accent-bg-blue', base: '--admin-bg-panel' },
  { what: 'a complete step ordinal', ink: '--admin-font-primary', fill: '--admin-accent-bg-green', base: '--admin-bg-panel' },
  { what: 'an outstanding step ordinal', ink: '--admin-font-primary', fill: '--admin-accent-bg-amber', base: '--admin-bg-panel' },
  { what: 'a locked step ordinal', ink: '--admin-font-primary', fill: '--admin-bg-icon-box', base: '--admin-bg-panel' },
  // The step names: on the panel, or on the current row's 4% tint.
  { what: 'a step name', ink: '--admin-font-primary', fill: '--admin-bg-panel', base: '--admin-bg-panel' },
  { what: 'the current step name', ink: '--admin-font-primary', fill: '--admin-accent-bg-blue-subtle', base: '--admin-bg-panel' },
  // The state chips: `outline` (transparent) and `secondary` (the icon box).
  { what: 'an outline state chip', ink: '--admin-font-primary', fill: '--admin-bg-panel', base: '--admin-bg-panel' },
  { what: 'the outstanding count chip', ink: '--admin-font-secondary', fill: '--admin-bg-icon-box', base: '--admin-bg-panel' },
]

describe('the wizard rail reads in both themes', () => {
  const { light, dark } = palettes()
  const themes = [
    ['light', light],
    ['dark', dark],
  ] as const

  it.each(
    PAIRS.flatMap((pair) =>
      themes.map(([theme, palette]) => [pair.what, theme, palette, pair] as const),
    ),
  )('%s clears AA in %s', (_what, _theme, palette, pair) => {
    const surface = flatten(parseColor(palette[pair.fill]), parseColor(palette[pair.base]))
    expect(contrastRatio(parseColor(palette[pair.ink]), surface)).toBeGreaterThanOrEqual(
      AA_SMALL_TEXT,
    )
  })

  /**
   * Guard the guard. If the measurement above were broken it would pass everything, so
   * one pairing that is known to fail has to keep failing: the accent amber on its own
   * soft fill in light, which is the worst in the set and the obvious thing to reach for
   * when marking a step "outstanding".
   */
  it('still measures the pairing the rail refused, so a broken measurement cannot pass', () => {
    const surface = flatten(
      parseColor(light['--admin-accent-bg-amber']),
      parseColor(light['--admin-bg-panel']),
    )
    expect(contrastRatio(parseColor(light['--admin-accent-amber']), surface)).toBeLessThan(
      AA_SMALL_TEXT,
    )
  })

  /**
   * The inks measured to fail above, banned from this component by name. Neither is
   * detectable by `utilityExistence`: both compile to a real rule.
   */
  const BANNED_INKS = ['text-fg-tertiary', 'text-accent-green', 'text-accent-amber', 'text-accent-blue', 'text-fg-on-accent']

  it.each(BANNED_INKS)('never writes %s, which fails AA in one theme or both', (utility) => {
    const source = readFileSync(STEPPER, 'utf8')
    // Only className positions, not the prose above explaining why the class is absent.
    const written = new RegExp(`className=(?:"|\\{)[^\`]*?\\b${utility}\\b`, 's').test(source)
    expect(written).toBe(false)
  })
})
