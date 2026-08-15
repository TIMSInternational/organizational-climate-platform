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

  it('is painted in a token the component actually names', () => {
    expect(token).toBe('--admin-border-hover')
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
    ['light', lightToken(token), lightToken('--admin-bg-icon-box')],
    ['dark', darkToken(token), darkToken('--admin-bg-icon-box')],
  ])('is not the same colour as the surface it sits on, in %s', (_theme, stripe, surface) => {
    // The regression that shipped: identical hexes in dark, 1.02:1 in light.
    expect(stripe).not.toBe(surface)
    expect(contrast(stripe, surface)).toBeGreaterThan(1.2)
  })

  it.each([
    ['light', lightToken('--admin-font-tertiary'), lightToken('--admin-bg-icon-box')],
    ['dark', darkToken('--admin-font-tertiary'), darkToken('--admin-bg-icon-box')],
  ])('shows the padlock at 3:1 or better against the surface, in %s', (_theme, ink, surface) => {
    // 3:1 is WCAG 1.4.11 for a non-text graphic that carries meaning, which the
    // padlock does — it is what says "withheld" rather than "empty".
    expect(contrast(ink, surface)).toBeGreaterThanOrEqual(3)
  })

  it('uses that ink, rather than the near-invisible --admin-font-light', () => {
    // The class list as authored, so this cannot be satisfied by the token name
    // merely appearing in a comment — `text-fg-light` is named in one just above.
    expect(protectedCellSource).toContain("'bg-surface-icon-box text-fg-tertiary'")
  })
})
