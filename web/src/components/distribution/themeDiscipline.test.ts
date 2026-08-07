import { describe, it, expect } from 'vitest'
import { readFileSync, globSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The distribution components must be legible in **both** themes.
 *
 * ## Why this file exists rather than trusting review
 *
 * A light-mode-only contrast failure is this project's documented recurring blind spot.
 * `styles/badgeVariantContrast.test.ts` measured all six badge variants against
 * `tokens.css` and found that only two — `secondary` and `outline` — clear WCAG AA
 * (4.5:1, correct for badge text at 12px) in light *and* dark. Three soft variants fail in
 * light while passing in dark; `destructive` fails in dark while passing in light. Whoever
 * reviews a PR sees one theme.
 *
 * So this guard does two things a reviewer reliably will not:
 *
 * 1. It **measures** the colour pairs these components actually put on screen, in both
 *    palettes, rather than asserting a class list. `text-fg-tertiary` on a card is the
 *    kind of low-contrast label that passes a glance and fails a meter.
 * 2. It pins the badge variants to the measured-safe pair, so a later edit cannot
 *    reintroduce a hued badge and let the colour, rather than the word, carry the meaning
 *    (which WCAG 1.4.1 forbids anyway).
 *
 * Measured from the stylesheet, never from a hardcoded hex list: a guard that restates the
 * values it guards can agree with itself while both are wrong.
 */

const TOKENS = join(process.cwd(), 'src', 'styles', 'tokens.css')
const DIR = join(process.cwd(), 'src', 'components', 'distribution')
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

const AA_SMALL_TEXT = 4.5

function sources(): Array<[string, string]> {
  return globSync('*.tsx', { cwd: DIR })
    .filter((file) => !file.endsWith('.test.tsx'))
    .map((file) => [file, readFileSync(join(DIR, file), 'utf8')])
}

/**
 * Every ink/surface pair these components put on screen, as token names.
 *
 * All are text at `text-sm` (12px) or smaller inside a `Card`, so AA small-text is the
 * right threshold for every one of them. `--admin-bg-card` is what a `Card` paints.
 */
const INK_ON_CARD = ['--admin-font-primary', '--admin-font-secondary'] as const

/**
 * `--admin-font-tertiary` is deliberately absent from the list above, and that is a
 * finding rather than an omission.
 *
 * Measured on `--admin-bg-card` it is **3.90:1 in light and 4.28:1 in dark** — below AA
 * 4.5:1 in *both* themes, so it is not even the usual one-theme blind spot. It was the
 * obvious token for the stat labels and the fieldset legends on this page, and this guard
 * rejected it on the first run; those now use `--admin-font-secondary`, which clears AA in
 * both. The token itself is used widely elsewhere (`TableCaption`, `TableEmpty`), so
 * repainting it is a change to a shared primitive and not this issue's to make — recorded
 * here so it is a known number rather than a surprise.
 */
const TERTIARY_FAILS_AA = '--admin-font-tertiary'

describe('distribution components in both themes', () => {
  const { light, dark } = palettes()
  const themes = [
    ['light', light],
    ['dark', dark],
  ] as const

  it.each(
    INK_ON_CARD.flatMap((ink) => themes.map(([theme, palette]) => [ink, theme, palette] as const)),
  )('%s on a card clears AA in %s', (ink, _theme, palette) => {
    const ratio = contrastRatio(parseColor(palette[ink]), parseColor(palette['--admin-bg-card']))
    expect(ratio).toBeGreaterThanOrEqual(AA_SMALL_TEXT)
  })

  it.each(themes)('records that fg-tertiary would have failed on a card in %s', (_theme, palette) => {
    // The defect this guard caught on its first run. Pinned as a number so that if the
    // token is ever repainted, this fails and says the restriction can be lifted.
    const ratio = contrastRatio(
      parseColor(palette[TERTIARY_FAILS_AA]),
      parseColor(palette['--admin-bg-card']),
    )
    expect(ratio).toBeLessThan(AA_SMALL_TEXT)
  })

  it('uses no ink on a card that has not been measured', () => {
    const measured = new Set<string>([...INK_ON_CARD].map((token) => token.replace('--admin-font-', 'text-fg-')))
    const used = new Set<string>()
    for (const [, source] of sources()) {
      for (const match of source.matchAll(/\btext-fg-[a-z-]+/g)) used.add(match[0])
    }
    expect(used.size, 'no ink classes found — the extractor stopped matching').toBeGreaterThan(0)
    expect([...used].filter((cls) => !measured.has(cls))).toEqual([])
  })

  it('measures a real failure too, so a broken measurement cannot pass everything', () => {
    // Guard the guard: `accent-amber` on its own soft fill is 2.99:1 in light. If this
    // ever clears AA the tokens were repainted, which is worth being told about.
    const ratio = contrastRatio(
      parseColor(light['--admin-accent-amber']),
      flatten(parseColor(light['--admin-accent-bg-amber']), parseColor(light['--admin-bg-panel'])),
    )
    expect(ratio).toBeLessThan(AA_SMALL_TEXT)
  })

  it('uses only the two badge variants measured legible in both themes', () => {
    const used = new Set<string>()
    for (const [, source] of sources()) {
      for (const match of source.matchAll(/<Badge\b[^>]*\bvariant="([a-z]+)"/g)) {
        used.add(match[1])
      }
      // A `<Badge>` with no variant falls back to `default`, which is 3.45:1 in light.
      for (const match of source.matchAll(/<Badge(\s+[^>]*)?>/g)) {
        if (!/\bvariant=/.test(match[0])) used.add('default')
      }
    }

    expect(used.size, 'no badges found — the extractor stopped matching').toBeGreaterThan(0)
    expect([...used].sort()).toEqual(['outline', 'secondary'])
  })

  it('writes no colour literal, so nothing can be right in one theme and wrong in the other', () => {
    // A hex, an `rgb()` or a stock Tailwind palette step is a value that does not flip
    // with the theme. Every colour here has to come through the token layer.
    const offenders: string[] = []
    for (const [file, source] of sources()) {
      const classNames = [...source.matchAll(/className="([^"]*)"/g)].map((match) => match[1])
      for (const value of classNames) {
        for (const cls of value.split(/\s+/)) {
          if (/-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}$/.test(cls)) {
            offenders.push(`${file}: ${cls}`)
          }
        }
      }
      // Comments are stripped first: `#218` in a `// see #218` reads as a hex triple,
      // which is how a guard earns a reputation for crying wolf and stops being trusted.
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[^\n'"`]*?(?<!:)\/\/.*$/gm, '')
      if (/#[0-9a-fA-F]{3,8}\b/.test(code) || /\brgba?\(/.test(code)) {
        offenders.push(`${file}: colour literal`)
      }
    }
    expect(offenders).toEqual([])
  })
})
