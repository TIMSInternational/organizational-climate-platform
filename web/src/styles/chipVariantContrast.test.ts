import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chipVariants, type ChipTone } from '../components/ui/chipVariants'

/**
 * Every status-chip tone stays legible, in both themes.
 *
 * ## What makes this different from `badgeVariantContrast.test.ts`
 *
 * That file measures two hand-listed variants and *records* that four others
 * fail. It cannot do more, because Badge's failing pairings are shipped and
 * changing them is a separate job (see `ui/chip.tsx`).
 *
 * Chip is new, so nothing here is allowed to fail — and the pairing is not
 * hand-listed. This calls the real `chipVariants()` for each tone, pulls the
 * `bg-*` and `text-*` classes out of the string it returns, resolves those class
 * names back through `styles/theme.css` to `--admin-*` tokens, resolves those
 * through `styles/tokens.css` per theme, composites the fill over each surface a
 * chip can land on and measures. So the chain under test is the whole chain a
 * browser walks, and every link can break it:
 *
 *   - re-pointing a tone at a different fill or ink in `chipVariants.ts`
 *   - re-mapping a `--color-*` in `theme.css`
 *   - nudging a hex or an alpha in `tokens.css`
 *
 * A guard that restated the ten hex pairs would agree with itself while all
 * three drifted — the reasoning `seqInkContrast.test.ts` sets out.
 *
 * ## Why FOUR surfaces and not just the panel
 *
 * The first version of this file composited over `--admin-bg-panel` and nothing
 * else, and passed while the shipped pixels failed. A chip does not have a fixed
 * ground: `ui/table.tsx`'s `TableRow` carries `hover:bg-state-hover`, so hovering
 * an ordinary row lays `--admin-bg-hover` over the panel; and `--admin-bg-icon-box`
 * is both the page background and the recessed KPI-tile surface. Measured in
 * Chromium on `/dev/chart-gallery`, the old translucent fills read 4.28:1 (good)
 * and 4.32:1 (warning) on a hovered row — under the line, with the panel-only
 * guard green.
 *
 * The fix was opaque fills, so the surface no longer matters. `fills are opaque`
 * below asserts exactly that, and the four surfaces stay because they are what
 * makes a regression to a translucent fill *visible* rather than merely illegal.
 */

const STYLES = join(process.cwd(), 'src', 'styles')
const TOKENS = readFileSync(join(STYLES, 'tokens.css'), 'utf8')
const THEME = readFileSync(join(STYLES, 'theme.css'), 'utf8')

const DARK_SELECTOR = ":root[data-admin-theme='dark']"

/** WCAG AA 1.4.3 for text below 18.66px bold / 24px regular. Chip text is 11px. */
const AA_SMALL_TEXT = 4.5

type Rgba = [number, number, number, number]

function declarations(block: string, prefix: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(new RegExp(`(--${prefix}[\\w-]+):\\s*([^;]+);`, 'g'))].map((match) => [
      match[1],
      match[2].trim(),
    ]),
  )
}

/** The two `--admin-*` palettes. Dark overrides light rather than restating it. */
function palettes(): Record<Theme, Record<string, string>> {
  const cut = TOKENS.indexOf(DARK_SELECTOR)
  expect(cut, 'tokens.css no longer declares a dark palette').toBeGreaterThan(0)
  const light = declarations(TOKENS.slice(TOKENS.indexOf(':root {'), cut), 'admin-')
  return { light, dark: { ...light, ...declarations(TOKENS.slice(cut), 'admin-') } }
}

/** `--color-*` → `--admin-*`, as `theme.css` maps them. */
const THEME_MAP = declarations(THEME, 'color-')

type Theme = 'light' | 'dark'

/**
 * Resolves a declared value to a literal colour, following `var()` chains.
 *
 * `--admin-chip-ink-neutral` is declared as `var(--admin-font-secondary)` rather
 * than as a copied hex, precisely so the two cannot drift; that only works if the
 * measurement follows the reference.
 */
function resolve(value: string, palette: Record<string, string>, depth = 0): string {
  const reference = /^var\((--[\w-]+)\)$/.exec(value.trim())
  if (!reference) return value.trim()
  expect(depth, `var() chain from ${value} does not terminate`).toBeLessThan(8)
  const next = palette[reference[1]]
  expect(next, `${reference[1]} is not declared in tokens.css`).toBeTruthy()
  return resolve(next, palette, depth + 1)
}

function parseColor(value: string): Rgba {
  const hex = /^#([0-9a-fA-F]{6})$/.exec(value)
  if (hex) {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16))
    return [r, g, b, 1]
  }
  const rgb = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/.exec(value)
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

/** Composites a translucent fill over an opaque surface. */
function flatten(fill: Rgba, surface: Rgba): Rgba {
  const alpha = fill[3]
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

/** `bg-accent-green-soft` → `--admin-accent-bg-green`, via theme.css. */
function tokenForUtility(className: string, theme: Theme): string {
  const name = /^(?:bg|text)-(.+)$/.exec(className)
  expect(name, `${className} is neither a bg- nor a text- utility`).not.toBeNull()
  const mapped = THEME_MAP[`--color-${name![1]}`]
  expect(mapped, `theme.css declares no --color-${name![1]}`).toBeTruthy()
  return resolve(mapped, palettes()[theme])
}

/** The fill and ink classes the real variant table hands a tone. */
function classesFor(tone: ChipTone): { fill: string; ink: string } {
  const classes = chipVariants({ tone }).split(/\s+/)
  const fill = classes.filter((name) => /^bg-/.test(name))
  const ink = classes.filter((name) => /^text-(?!xs$)/.test(name))
  expect(fill, `${tone} names exactly one background`).toHaveLength(1)
  expect(ink, `${tone} names exactly one ink`).toHaveLength(1)
  return { fill: fill[0], ink: ink[0] }
}

const TONES: ChipTone[] = ['good', 'warning', 'critical', 'accent', 'neutral']
const THEMES: Theme[] = ['light', 'dark']

/**
 * The grounds a chip is actually rendered on, built from the same tokens the
 * browser uses rather than from literals.
 *
 * `panelHovered` is `hover:bg-state-hover` on a `TableRow` — `theme.css` maps
 * `--color-state-hover` to `--admin-bg-hover`, which is translucent, so it has to
 * be composited over the panel to get the surface. `iconBox` is
 * `--admin-bg-icon-box`, which is the page background *and* the recessed tile;
 * `iconBoxHovered` is the same row hover over that.
 */
type Surface = 'panel' | 'panelHovered' | 'iconBox' | 'iconBoxHovered'
const SURFACES: Surface[] = ['panel', 'panelHovered', 'iconBox', 'iconBoxHovered']

function surfaceColor(surface: Surface, theme: Theme): Rgba {
  const palette = palettes()[theme]
  const token = (name: string): Rgba => parseColor(resolve(palette[name], palette))
  const hover = token('--admin-bg-hover')
  const base = surface.startsWith('panel') ? token('--admin-bg-panel') : token('--admin-bg-icon-box')
  return surface.endsWith('Hovered') ? flatten(hover, base) : base
}

function measure(tone: ChipTone, theme: Theme, surface: Surface = 'panel'): number {
  const { fill, ink } = classesFor(tone)
  return contrastRatio(
    parseColor(tokenForUtility(ink, theme)),
    flatten(parseColor(tokenForUtility(fill, theme)), surfaceColor(surface, theme)),
  )
}

describe('status chip contrast', () => {
  it.each(
    TONES.flatMap((tone) =>
      THEMES.flatMap((theme) => SURFACES.map((surface) => [tone, theme, surface] as const)),
    ),
  )('the %s chip clears AA in %s on the %s', (tone, theme, surface) => {
    expect(measure(tone, theme, surface)).toBeGreaterThanOrEqual(AA_SMALL_TEXT)
  })

  it.each(TONES)('the %s fill is opaque, so no surface can change it', (tone) => {
    // The whole reason the four surfaces above agree. A translucent fill takes
    // its rendered colour from the ground, and the ground under a chip moves:
    // `ui/table.tsx` line ~77 puts `hover:bg-state-hover` on every `TableRow`.
    // Asserted on the alpha rather than inferred from the ratios, because a
    // near-opaque fill would still pass the ratios by a hair and then fail the
    // moment a token was nudged.
    const { fill } = classesFor(tone)
    for (const theme of THEMES) {
      expect(parseColor(tokenForUtility(fill, theme))[3], `${tone} in ${theme}`).toBe(1)
    }
  })

  it('measures a surface difference, so the four surfaces are not decoration', () => {
    // Guard the guard, part three. The four surfaces above all agree — which is
    // the point, and also means that on their own they could not tell a working
    // composite from a broken one. So assert the two halves of the property
    // separately:
    //
    //   a TRANSLUCENT fill's ratio depends on the surface,
    //   an OPAQUE one's does not.
    //
    // `--admin-accent-bg-green` is the 8% tint the `good` chip used to wear and
    // is still declared for Badge, so it is a live translucent value, not a hex
    // copied in here to argue with itself.
    const { light } = palettes()
    const ink = parseColor(resolve(light['--admin-chip-ink-good'], light))
    const tint = parseColor(resolve(light['--admin-accent-bg-green'], light))
    expect(tint[3], 'the accent tint stopped being translucent').toBeLessThan(1)
    const onPanel = contrastRatio(ink, flatten(tint, surfaceColor('panel', 'light')))
    const onHover = contrastRatio(ink, flatten(tint, surfaceColor('panelHovered', 'light')))
    expect(onPanel, 'a hovered row is darker, so a tint on it contrasts less').toBeGreaterThan(
      onHover,
    )

    for (const tone of TONES) {
      for (const theme of THEMES) {
        const ratios = SURFACES.map((surface) => measure(tone, theme, surface))
        expect(new Set(ratios).size, `${tone} in ${theme} varies with its surface`).toBe(1)
      }
    }
  })

  it('reads the pairing out of the real variant table', () => {
    // Guard the guard, part one. If `classesFor` ever stopped finding the classes
    // the table actually sets, every assertion above would be measuring something
    // other than the shipped chip. Pin two tones by name.
    expect(classesFor('good')).toEqual({
      fill: 'bg-chip-good-fill',
      ink: 'text-chip-good-ink',
    })
    expect(classesFor('neutral')).toEqual({
      fill: 'bg-chip-neutral-fill',
      ink: 'text-chip-neutral-ink',
    })
  })

  it('follows a var() reference rather than stopping at it', () => {
    // `--admin-chip-ink-neutral` is `var(--admin-font-secondary)`,
    // `--admin-chip-bg-neutral` is `var(--admin-bg-icon-box)` and
    // `--admin-chip-ink-accent` is `var(--admin-accent-blue)` in dark.
    // Unresolved, `parseColor` would throw rather than pass — but a future
    // resolver bug that returned a default instead would pass silently, so
    // assert the values.
    // The light values moved with the blue-on-the-shell recolour (the neutrals are
    // blue-biased now); what this test asserts is unchanged — that the resolver
    // FOLLOWS the reference instead of returning a default.
    const { light, dark } = palettes()
    expect(resolve(light['--admin-chip-ink-neutral'], light)).toBe('#4a3d72')
    expect(resolve(dark['--admin-chip-ink-neutral'], dark)).toBe('#afa7ca')
    expect(resolve(light['--admin-chip-bg-neutral'], light)).toBe('#f3f1fa')
    expect(resolve(dark['--admin-chip-bg-neutral'], dark)).toBe('#1b1433')
    expect(resolve(dark['--admin-chip-ink-accent'], dark)).toBe('#9882df')
  })

  it('measures a known failure, so a broken measurement cannot pass everything', () => {
    // Guard the guard, part two. The accents this chip deliberately does NOT use
    // are the reason the chip inks exist. `--admin-accent-amber` on the amber
    // soft fill in light is `badgeVariantContrast.test.ts`'s worst pairing at
    // 2.99:1; if the machinery here reported it as passing, the ten assertions
    // above would be worthless. If this ever fails, the accents were fixed and
    // Badge and Chip can merge — worth being told rather than discovering.
    const { light } = palettes()
    const panel = parseColor(light['--admin-bg-panel'])
    const ratio = contrastRatio(
      parseColor(resolve(light['--admin-accent-amber'], light)),
      flatten(parseColor(resolve(light['--admin-accent-bg-amber'], light)), panel),
    )
    expect(ratio).toBeLessThan(AA_SMALL_TEXT)
  })

  it('leaves a margin over the threshold rather than sitting on it', () => {
    // The worst pairing is `critical` in light, 5.59:1. Recorded as a floor, not
    // as an equality: a token nudge that took it to 4.51 would still pass every
    // assertion above while being one rounding away from failing. The first cut
    // of this chip had 0.14 of margin and lost all of it to a row hover, which is
    // why the bar here is a whole point over AA and not a tenth.
    const worst = Math.min(
      ...TONES.flatMap((tone) =>
        THEMES.flatMap((theme) => SURFACES.map((surface) => measure(tone, theme, surface))),
      ),
    )
    expect(worst).toBeGreaterThanOrEqual(5.5)
  })
})
