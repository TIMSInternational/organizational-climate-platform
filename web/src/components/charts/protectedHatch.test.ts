import { describe, expect, it } from 'vitest'
import { readFileSync, globSync } from 'node:fs'
import { join, relative } from 'node:path'
import tokensCss from '../../styles/tokens.css?raw'
import protectedCellSource from './ProtectedCell.tsx?raw'
import { PROTECTED_HATCH } from './suppression'

/**
 * The protected hatch has to be *visible*, in both themes.
 *
 * `ProtectedCell` exists to make a withheld reading read as a guarantee being
 * enforced rather than as missing data, and the diagonal hatch is the whole of
 * that signal at a glance — the padlock is 12px. It shipped painting the stripes
 * in `--admin-border-light` over a `--admin-bg-icon-box` surface, and in the dark
 * palette those two tokens are the *same hex*, `#2a2a2a`. So the cell rendered as
 * a plain empty box: the exact failure the component was written to prevent,
 * inside the component that prevents it, invisible to every test in the suite
 * because happy-dom does not paint.
 *
 * This is a token-level check rather than a screenshot because that is the level
 * the bug lived at. It reads the classes out of `ProtectedCell.tsx` itself, so it
 * cannot drift into asserting a pairing the component no longer uses.
 */

/** Value of a custom property in the light (`:root`) block. */
function lightToken(name: string): string {
  const match = new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm').exec(tokensCss)
  if (!match) throw new Error(`token ${name} is not declared in tokens.css`)
  return match[1].trim()
}

/** Value of a custom property in the dark palette block. */
function darkToken(name: string): string {
  const body = /:root\[data-admin-theme='dark'\]\s*\{([\s\S]*?)\n\}/m.exec(tokensCss)
  if (!body) throw new Error('tokens.css has no dark palette block')
  const match = new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm').exec(body[1])
  if (!match) throw new Error(`token ${name} is not declared in the dark block`)
  return match[1].trim()
}

function channels(hex: string): [number, number, number] {
  const value = hex.trim().replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(value)) throw new Error(`${hex} is not a six-digit hex`)
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ]
}

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((channel) => {
    const sRGB = channel / 255
    return sRGB <= 0.03928 ? sRGB / 12.92 : ((sRGB + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

/** The token the hatch gradient is painted in, read out of the shared constant. */
function hatchToken(): string {
  const match = /repeating-linear-gradient\(135deg,var\((--[a-z0-9-]+)\)/.exec(PROTECTED_HATCH)
  if (!match) throw new Error('PROTECTED_HATCH no longer paints a 135deg repeating gradient')
  return match[1]
}

/** The token the hatch's gaps are painted in, read out of the shared constant. */
function groundToken(): string {
  const match = /_0_4px,var\((--[a-z0-9-]+)\)_4px_8px\)/.exec(PROTECTED_HATCH)
  if (!match) throw new Error('PROTECTED_HATCH no longer paints its gaps in a token')
  return match[1]
}

const SRC = join(process.cwd(), 'src')

/**
 * Every place in `src/` that writes a 135deg repeating gradient by hand, with the
 * token it paints in — so a second copy cannot drift off the shared constant the way
 * `ClimateMap`'s legend key did.
 */
function handRolledHatches(): { file: string; token: string }[] {
  const found: { file: string; token: string }[] = []
  for (const relativePath of globSync('**/*.{ts,tsx}', { cwd: SRC })) {
    // The constant's own definition is the one legitimate literal, and this file
    // quotes the gradient in its own prose and regexes.
    if (relativePath === 'components/charts/suppression.ts') continue
    if (relativePath.endsWith('protectedHatch.test.ts')) continue
    const source = readFileSync(join(SRC, relativePath), 'utf8')
    for (const match of source.matchAll(
      /repeating-linear-gradient\(135deg,\s*var\((--[a-z0-9-]+)\)/g,
    )) {
      found.push({ file: relativePath, token: match[1] })
    }
  }
  return found
}

describe('the fixtures themselves', () => {
  it('are the real stylesheet and the real component, not stubs', () => {
    // Guard the guard: an empty `?raw` import would make everything below pass
    // vacuously, and vitest returns '' for a CSS import unless `test.css` is on.
    expect(tokensCss).toContain('--admin-bg-icon-box')
    expect(protectedCellSource).toContain('export default function ProtectedCell')
  })
})

describe('the protected hatch', () => {
  const token = hatchToken()
  const ground = groundToken()

  it('is painted in a token the component actually names', () => {
    // Its own token since the canvas (10 Sep): the artboards' stripe is fainter than
    // `--admin-border-hover`, which every hovered border still uses.
    expect(token).toBe('--admin-hatch-stripe')
    // And its gaps in one, rather than `transparent` over whatever it lands on.
    expect(ground).toBe('--admin-hatch-ground')
    // The surface it is painted on. `bg-surface-icon-box` maps to
    // `--admin-bg-icon-box` through theme.css.
    expect(protectedCellSource).toContain('bg-surface-icon-box')
  })

  it('is the shared constant everywhere, not a second hand-rolled copy', () => {
    // `ClimateMap`'s legend key was a second literal. When the cell's stripe token
    // was corrected the key kept `--admin-border-light` — identical to the surface
    // in dark — so the fixed cell showed a hatch while its own legend showed a
    // blank box. Both now spread `PROTECTED_HATCH`; anything else fails here.
    const strays = handRolledHatches().filter(({ token: used }) => used !== token)
    expect(
      strays.map(({ file, token: used }) => `${relative('.', file)} paints the hatch in ${used}`),
      'Use PROTECTED_HATCH from components/charts/suppression rather than writing the gradient out',
    ).toEqual([])
  })

  it('the sweep for stray copies is not vacuous', () => {
    // Guard the guard. If the regex or the glob stopped matching, the check above
    // would pass by finding nothing. `ProtectedCell` and `ClimateMap` both consume
    // the constant, so neither writes the gradient literally any more — what must
    // still be findable is the constant itself.
    expect(PROTECTED_HATCH).toMatch(/^\[background-image:repeating-linear-gradient\(135deg,var\(--/)
    expect(globSync('**/*.{ts,tsx}', { cwd: SRC }).length).toBeGreaterThan(100)
  })

  it.each([
    ['light', lightToken(token), lightToken(ground)],
    ['dark', darkToken(token), darkToken(ground)],
  ])('is not the same colour as the ground between its stripes, in %s', (_theme, stripe, surface) => {
    // The regression that shipped: identical hexes in dark, 1.02:1 in light.
    expect(stripe).not.toBe(surface)
    expect(contrast(stripe, surface)).toBeGreaterThan(1.2)
  })

  it('paints its gaps in the canvas’s own ground in light, and in the surface it sits on in dark', () => {
    // Every artboard of 10 Sep, 26 of 26, draws the hatch as
    // `repeating-linear-gradient(135deg, #e6e3f1 0 4px, #f8f7fb 4px 8px)`: the gaps are
    // the outer ground, not the recessed #f3f1fa the cell sits on, which a transparent
    // gap showed and which read a shade darker and bluer on the live session's words.
    expect(lightToken(ground)).toBe(lightToken('--admin-bg-outer'))
    // The artboards draw no dark theme; there the gaps stay what they always showed.
    expect(darkToken(ground)).toBe(darkToken('--admin-bg-icon-box'))
  })

  it('is the canvas’s stripe in light, only as much darker as the floor needs', () => {
    // The canvas's own pair is under the floor above — which is why the stripe is not
    // the canvas's hex.
    expect(contrast('#e6e3f1', '#f8f7fb')).toBeLessThan(1.2)
    // Within 3 of it on every channel, and fainter than 1.21:1 on the ground: neither
    // under the floor nor darkened by eye into a texture the artboards do not draw.
    const stripe = channels(lightToken(token))
    const canvas = channels('#e6e3f1')
    expect(Math.max(...stripe.map((channel, i) => Math.abs(channel - canvas[i])))).toBeLessThanOrEqual(3)
    expect(contrast(lightToken(token), lightToken(ground))).toBeLessThan(1.21)
  })

  it.each([
    ['light', lightToken('--admin-font-tertiary'), lightToken(ground), lightToken(token)],
    ['dark', darkToken('--admin-font-tertiary'), darkToken(ground), darkToken(token)],
  ])('shows the padlock at 3:1 or better against both colours of the hatch, in %s', (_theme, ink, gap, stripe) => {
    // 3:1 is WCAG 1.4.11 for a non-text graphic that carries meaning, which the
    // padlock does — it is what says "withheld" rather than "empty". It sits across
    // the stripes and the gaps, so it clears both.
    expect(contrast(ink, gap)).toBeGreaterThanOrEqual(3)
    expect(contrast(ink, stripe)).toBeGreaterThanOrEqual(3)
  })

  it('uses that ink, rather than the near-invisible --admin-font-light', () => {
    // The class list as authored, so this cannot be satisfied by the token name
    // merely appearing in a comment — `text-fg-light` is named in one just above.
    expect(protectedCellSource).toContain("'bg-surface-icon-box text-fg-tertiary'")
  })
})
