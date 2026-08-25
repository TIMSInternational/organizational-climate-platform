import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every ink/surface pair the survey results screen introduces, measured in BOTH
 * palettes.
 *
 * ## Why this exists beside `respondContrast.test.ts`
 *
 * That file guards the respond form and sweeps `features/surveys/**` for two
 * banned utilities. It cannot see the results screen's real problem, which is one
 * directory over: the redesign puts `charts/KpiTile` on a real page for the first
 * time, and the tile's label and sub-line were written `text-fg-tertiary` on the
 * tile's own recessed surface.
 *
 * Measured from `styles/tokens.css` — not from a list restated here, for the
 * reason `seqInkContrast` gives:
 *
 * | pair | light | dark |
 * |---|---|---|
 * | `text-fg-tertiary` on `bg-surface-icon-box` (the KPI label, first draft) | **3.42:1** | **3.68:1** |
 * | `text-fg-secondary` on `bg-surface-icon-box` | 8.15:1 | 6.85:1 |
 *
 * Both themes failed, which is why it survived: this project's recurring contrast
 * bug is light-only, so a reviewer who checked dark and saw a passing figure would
 * have concluded the pair was fine in the theme that was actually being tested.
 *
 * The class sweep at the bottom is what stops the fix being quietly undone — the
 * ratios above stay true whatever `KpiTile` writes, so measuring tokens alone
 * would go stale the moment somebody reached for the obvious utility again.
 */

const TOKENS = join(process.cwd(), 'src', 'styles', 'tokens.css')
const KPI_TILE = join(process.cwd(), 'src', 'components', 'charts', 'KpiTile.tsx')
const RESULTS_PAGE = join(process.cwd(), 'src', 'features', 'surveys', 'pages', 'SurveyResultsPage.tsx')
const CLIMATE_MAP = join(process.cwd(), 'src', 'components', 'charts', 'ClimateMap.tsx')
const DARK_SELECTOR = ":root[data-admin-theme='dark']"

type Rgb = [number, number, number]

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
  return { light, dark: { ...light, ...declarations(css.slice(cut)) } }
}

function parseColor(value: string): Rgb {
  const hex = value.match(/^#([0-9a-fA-F]{6})$/)
  if (!hex) throw new Error(`Unparseable colour: ${value}`)
  return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)) as Rgb
}

function relativeLuminance([r, g, b]: Rgb): number {
  const channel = (value: number): number => {
    const scaled = value / 255
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

/** WCAG AA 1.4.3. Every string measured here is `text-2xs`, `text-xs` or `text-sm`. */
const AA_SMALL_TEXT = 4.5

interface Pair {
  what: string
  ink: string
  surface: string
}

const PAIRS: readonly Pair[] = [
  // charts/KpiTile: the participation strip at the top of the results screen.
  { what: 'the KPI tile label', ink: '--admin-font-secondary', surface: '--admin-bg-icon-box' },
  { what: 'the KPI tile sub-line', ink: '--admin-font-secondary', surface: '--admin-bg-icon-box' },
  // The findings cards, which sit on the same recessed surface.
  { what: 'a finding headline', ink: '--admin-font-primary', surface: '--admin-bg-icon-box' },
  { what: "a finding's reading", ink: '--admin-font-secondary', surface: '--admin-bg-icon-box' },
  // The prose in the map and findings panels.
  { what: 'the panel prose', ink: '--admin-font-secondary', surface: '--admin-bg-panel' },
  // charts/ClimateMap: the dimension column headers (`text-2xs`) and the two
  // diverging-scale legend labels. Measured on BOTH surfaces, because the same
  // component renders on the bare panel here and inside a recessed tile on the
  // dashboard, and the ink that shipped was below AA on both.
  { what: 'the map column header', ink: '--admin-font-secondary', surface: '--admin-bg-panel' },
  {
    what: 'the map column header on a tile',
    ink: '--admin-font-secondary',
    surface: '--admin-bg-icon-box',
  },
  { what: 'the map legend label', ink: '--admin-font-secondary', surface: '--admin-bg-panel' },
  {
    what: 'the map legend label on a tile',
    ink: '--admin-font-secondary',
    surface: '--admin-bg-icon-box',
  },
]

/**
 * The vacuity control's ink: one that must genuinely FAIL AA, so a broken
 * measurement cannot report everything as passing.
 *
 * This used to be `--admin-font-tertiary` — the ink that shipped on the map and
 * could not be read on it. #83 repainted that token (`styles/tokens.css`), and it
 * now clears 4.5:1 on both map surfaces in both themes, so it can no longer serve
 * as the known-bad case. `--admin-font-light` took its place: it is the one ink
 * this design system deliberately holds to 1.4.11's 3:1 instead of 1.4.3's 4.5:1,
 * because nothing it paints is text (`styles/inkContrast.test.ts` enforces that),
 * so it must measure BELOW 4.5 by construction.
 *
 * The source ban further down is kept as it was. Those three files use
 * `--admin-font-secondary`, which is stronger than the floor either way, and
 * relaxing another slice's guard is not this issue's to do.
 */
const REJECTED_INK = '--admin-font-light'

/** Surfaces ClimateMap is rendered on. */
const MAP_SURFACES = ['--admin-bg-panel', '--admin-bg-icon-box'] as const

describe('the survey results screen reads in both themes', () => {
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
    expect(
      contrastRatio(parseColor(palette[pair.ink]), parseColor(palette[pair.surface])),
    ).toBeGreaterThanOrEqual(AA_SMALL_TEXT)
  })

  /**
   * The measured failure, banned by name from the two files that would reintroduce
   * it. Neither `tsc`, oxlint nor `utilityExistence` can see it: the class compiles
   * perfectly, it just cannot be read.
   */
  /**
   * Vacuity control for the pair table: the rejected ink must genuinely fail on the
   * surfaces the map is drawn on, in the theme named. Without this, swapping every
   * PAIRS entry to an ink that trivially passes would leave the suite green while
   * proving nothing about the defect it was written for.
   */
  it.each(MAP_SURFACES.flatMap((surface) => themes.map(([theme, palette]) => [theme, palette, surface] as const)))(
    'the non-text ink does NOT clear AA in %s',
    (_theme, palette, surface) => {
      const ratio = contrastRatio(parseColor(palette[REJECTED_INK]), parseColor(palette[surface]))
      expect(ratio).toBeLessThan(AA_SMALL_TEXT)
    },
  )

  it.each([
    ['components/charts/KpiTile.tsx', KPI_TILE],
    ['features/surveys/pages/SurveyResultsPage.tsx', RESULTS_PAGE],
    ['components/charts/ClimateMap.tsx', CLIMATE_MAP],
  ])('%s never writes text-fg-tertiary', (_name, path) => {
    const source = readFileSync(path, 'utf8')
    // Only className positions, not the prose explaining why the class is absent.
    expect(/className=(?:"|\{)[^`]*?\btext-fg-tertiary\b/s.test(source)).toBe(false)
  })
})
