import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SEGMENTS, SYSTEM_CHIP_WEIGHT } from './mixSegments'

/**
 * The platform dashboard's survey mix is a graphic whose parts carry meaning, so WCAG
 * 1.4.11 holds each part to 3:1 against the card it sits on — in BOTH themes. The greys it
 * first wore (`line-hover`, `line-default`) measured 1.5 / 1.2:1 in light and 1.65 / 1.3:1
 * in dark: the archived swatch vanished. This resolves every colour class the table names
 * through `theme.css` to its hex in each block of `tokens.css` and measures it.
 */
const STYLES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../styles')
const THEME = readFileSync(resolve(STYLES, 'theme.css'), 'utf8')
const TOKENS = readFileSync(resolve(STYLES, 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const DARK_AT = TOKENS.indexOf(":root[data-admin-theme='dark']")

function hexOf(utility: string, theme: 'light' | 'dark'): string {
  const admin = new RegExp(`--color-${utility}:\\s*var\\(--(admin-[a-z0-9-]+)\\)`).exec(THEME)?.[1]
  if (!admin) throw new Error(`no --color-${utility} in theme.css`)
  const block = theme === 'light' ? TOKENS.slice(0, DARK_AT) : TOKENS.slice(DARK_AT)
  const hex = new RegExp(`--${admin}:\\s*(#[0-9a-fA-F]{6})\\b`).exec(block)?.[1]
  if (!hex) throw new Error(`no ${admin} hex in the ${theme} block`)
  return hex
}

function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16)
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin((value >> 16) & 0xff) + 0.7152 * lin((value >> 8) & 0xff) + 0.0722 * lin(value & 0xff)
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** The colour a part is painted with: its fill, or its edge when the fill is transparent. */
function paintOf(className: string): string {
  const fill = /(?:^|\s)bg-([a-z0-9-]+)/.exec(className)?.[1]
  if (fill && fill !== 'transparent') return fill
  const edge = /(?:^|\s)border-([a-z][a-z0-9-]+)/.exec(className)?.[1]
  if (!edge) throw new Error(`no paint in "${className}"`)
  return edge
}

describe('the survey mix colours', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`clears 3:1 against the card for every part, in ${theme}`, () => {
      const card = hexOf('surface-card', theme)
      for (const segment of SEGMENTS) {
        const ratio = contrast(hexOf(paintOf(segment.className), theme), card)
        expect(ratio, `${segment.key} in ${theme}`).toBeGreaterThanOrEqual(3)
      }
    })
  }

  it('tells every part apart: no two share both a paint and a shape', () => {
    const looks = SEGMENTS.map((segment) => `${paintOf(segment.className)}|${/\bborder\b/.test(segment.className) ? 'outline' : 'fill'}`)
    expect(new Set(looks).size).toBe(SEGMENTS.length)
  })

  it('wears none of the three result colours', () => {
    for (const segment of SEGMENTS) expect(segment.className).not.toMatch(/green|amber|red|good|warning|critical|band/)
  })
})

describe('the system chips', () => {
  it('makes a failing and a degraded system louder than a healthy one, in neutral ink', () => {
    expect(SYSTEM_CHIP_WEIGHT.good).toBeUndefined()
    expect(SYSTEM_CHIP_WEIGHT.critical).toContain('bg-fg-primary')
    expect(SYSTEM_CHIP_WEIGHT.warning).toContain('text-fg-primary')
    expect(SYSTEM_CHIP_WEIGHT.critical).not.toBe(SYSTEM_CHIP_WEIGHT.warning)
    for (const weight of Object.values(SYSTEM_CHIP_WEIGHT)) expect(weight ?? '').not.toMatch(/green|amber|red|chip-(good|warning|critical)/)
  })

  for (const theme of ['light', 'dark'] as const) {
    it(`sets the inverted critical word at 4.5:1 or more, in ${theme}`, () => {
      expect(contrast(hexOf('fg-primary', theme), hexOf('surface-card', theme))).toBeGreaterThanOrEqual(4.5)
    })
  }
})
