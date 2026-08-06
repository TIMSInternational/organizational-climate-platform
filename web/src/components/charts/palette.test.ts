import { describe, expect, it } from 'vitest'
import tokensCss from '../../styles/tokens.css?raw'
import themeCss from '../../styles/theme.css?raw'
import {
  CHART_AXIS,
  CHART_GRID,
  CHART_SURFACE_GAP,
  DIVERGING_COLORS,
  MAX_SERIES,
  SEQUENTIAL_COLORS,
  SEQUENTIAL_INKS,
  SERIES_COLORS,
  divergingColor,
  sequentialColor,
  sequentialInk,
  sequentialPair,
  seriesColor,
  seriesColorFor,
} from './palette'
import { measureSeqInkContrast } from '../../test/seqInkContrast'

/**
 * #79. Two kinds of claim are pinned here.
 *
 * The **values** matter because the palette was chosen by measurement, not taste:
 * it passes the dataviz validator's six checks in both themes. A well-meaning
 * nudge to one hex can break colourblind separation without changing anything a
 * reviewer would notice, so the exact steps are asserted and the validator
 * command is recorded in `styles/tokens.css` next to them.
 *
 * The **rules** matter because they are the ones that fail silently: a cycled
 * palette gives two series the same colour, and rank-based assignment repaints
 * survivors when a filter changes.
 */

function stripComments(css: string) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Value of a custom property inside a specific selector block. */
function tokenIn(css: string, selector: string, name: string): string {
  const body = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm').exec(stripComments(css))
  if (!body) throw new Error(`selector ${selector} not found`)
  const match = new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm').exec(body[1])
  if (!match) throw new Error(`${name} is not declared in ${selector}`)
  return match[1].trim()
}

const light = (name: string) => tokenIn(tokensCss, ':root', name)
const dark = (name: string) => tokenIn(tokensCss, ":root\\[data-admin-theme='dark'\\]", name)

describe('categorical series palette', () => {
  // Exactly the string handed to the validator. Light mode, surface #ffffff:
  // lightness band PASS, chroma floor PASS, CVD separation PASS (worst adjacent
  // dE 13.6 deutan), normal-vision floor PASS (24.8), contrast PASS.
  it('is the validated light palette, unchanged', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => light(`--admin-chart-series-${n}`))).toEqual([
      '#0d9488',
      '#a21caf',
      '#c2410c',
      '#1d4ed8',
      '#4d7c0f',
      '#7c3aed',
    ])
  })

  // Dark mode, surface #171717: all six inside L 0.48-0.67, worst adjacent CVD
  // dE 12.8 deutan, normal-vision 29.4, contrast PASS. Selected for the dark
  // surface rather than flipped -- the light steps fail the narrower dark band.
  it('is the validated dark palette, unchanged', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => dark(`--admin-chart-series-${n}`))).toEqual([
      '#0d9488',
      '#c026d3',
      '#ea580c',
      '#3b82f6',
      '#65a30d',
      '#8b5cf6',
    ])
  })

  it('ships a distinct step per series in both themes', () => {
    for (const read of [light, dark]) {
      const values = [1, 2, 3, 4, 5, 6].map((n) => read(`--admin-chart-series-${n}`))
      expect(new Set(values).size).toBe(6)
    }
  })

  // Status colours are reserved. green/red/amber mean good/critical/warning
  // throughout the UI, and a palette where "critical" also means "series 3"
  // makes every dashboard ambiguous -- the reader cannot tell an encoding from a
  // judgement.
  //
  // Scoped to the status trio on purpose. Series 6 *does* equal
  // --admin-accent-purple in both themes, because both pick the same step of the
  // violet ramp, and that is fine: purple carries no state, so a violet bar says
  // only "series 6". Asserting no overlap with *any* accent would forbid a
  // perfectly good hue for no stated reason.
  it('never reuses a status colour as a series colour', () => {
    for (const read of [light, dark]) {
      const status = ['green', 'red', 'amber'].map((name) => read(`--admin-accent-${name}`))
      const series = [1, 2, 3, 4, 5, 6].map((n) => read(`--admin-chart-series-${n}`))
      for (const colour of series) {
        expect(status).not.toContain(colour)
      }
    }
  })

  it('exposes every chart token as a Tailwind utility', () => {
    const declared = [...tokensCss.matchAll(/--admin-(chart-[\w-]+):/g)].map((m) => m[1])
    expect(new Set(declared).size).toBeGreaterThan(0)
    for (const name of new Set(declared)) {
      expect(themeCss).toContain(`--color-${name}: var(--admin-${name});`)
    }
  })
})

describe('sequential and diverging scales', () => {
  it('has a neutral gray diverging midpoint, not a hue', () => {
    // A hue at the midpoint reads as a third category rather than as "neither".
    // Gray means r == g == b.
    for (const read of [light, dark]) {
      const mid = read('--admin-chart-div-mid')
      const [, r, g, b] = /^#(\w{2})(\w{2})(\w{2})$/.exec(mid) ?? []
      expect(r).toBe(g)
      expect(g).toBe(b)
    }
  })

  it('orders the sequential ramp light-to-dark in light mode and the reverse in dark', () => {
    // "More" must stay "more visible" against the surface it sits on.
    const luma = (hex: string) => {
      const [, r, g, b] = /^#(\w{2})(\w{2})(\w{2})$/.exec(hex)!
      return parseInt(r, 16) + parseInt(g, 16) + parseInt(b, 16)
    }
    const steps = [1, 2, 3, 4, 5, 6, 7]
    const lightRamp = steps.map((n) => luma(light(`--admin-chart-seq-${n}`)))
    const darkRamp = steps.map((n) => luma(dark(`--admin-chart-seq-${n}`)))
    expect(lightRamp).toEqual([...lightRamp].sort((a, b) => b - a))
    expect(darkRamp).toEqual([...darkRamp].sort((a, b) => a - b))
  })
})

describe('the module reads tokens, never literals', () => {
  it('exposes only var() references', () => {
    const all = [...SERIES_COLORS, ...SEQUENTIAL_COLORS, ...DIVERGING_COLORS, CHART_GRID, CHART_AXIS, CHART_SURFACE_GAP]
    for (const value of all) {
      expect(value).toMatch(/^var\(--admin-chart-[\w-]+\)$/)
    }
  })

  it('references properties that tokens.css actually declares', () => {
    // Catches a typo'd var() name, which renders as *nothing* rather than as an
    // error -- an invisible chart with no console message.
    const all = [...SERIES_COLORS, ...SEQUENTIAL_COLORS, ...DIVERGING_COLORS, CHART_GRID, CHART_AXIS, CHART_SURFACE_GAP]
    for (const value of all) {
      const name = /^var\((--[\w-]+)\)$/.exec(value)![1]
      expect(tokensCss).toContain(`${name}:`)
    }
  })
})

describe('seriesColor', () => {
  it('assigns in fixed order', () => {
    expect(seriesColor(0)).toBe(SERIES_COLORS[0])
    expect(seriesColor(5)).toBe(SERIES_COLORS[5])
  })

  // Cycling is the failure this guards: it renders happily and leaves two series
  // the same colour, which the reader cannot detect.
  it('throws rather than cycling past the last series', () => {
    expect(() => seriesColor(MAX_SERIES)).toThrow(RangeError)
    expect(() => seriesColor(MAX_SERIES)).toThrow(/not cycled/)
  })

  it('rejects negative and non-integer indices', () => {
    expect(() => seriesColor(-1)).toThrow(RangeError)
    expect(() => seriesColor(1.5)).toThrow(RangeError)
  })
})

describe('seriesColorFor', () => {
  const keys = ['engagement', 'leadership', 'communication'] as const

  it('gives an entity the same colour regardless of what is filtered out', () => {
    // The rule: colour follows the entity, never its rank. Filtering the data
    // must not repaint the survivors.
    const before = seriesColorFor('communication', keys)
    const afterFilteringOutTheFirst = seriesColorFor('communication', keys)
    expect(afterFilteringOutTheFirst).toBe(before)
    expect(before).toBe(SERIES_COLORS[2])
  })

  it('throws for a key outside the stable list', () => {
    expect(() => seriesColorFor('nope', keys)).toThrow(RangeError)
  })
})

describe('sequentialColor', () => {
  it('maps the range onto the ramp', () => {
    expect(sequentialColor(0)).toBe(SEQUENTIAL_COLORS[0])
    expect(sequentialColor(1)).toBe(SEQUENTIAL_COLORS[SEQUENTIAL_COLORS.length - 1])
  })

  // Clamps rather than throwing: magnitudes are computed from data, and a
  // rounding error at the edge must not blank a heatmap cell.
  it('clamps out-of-range and NaN input', () => {
    expect(sequentialColor(-0.2)).toBe(SEQUENTIAL_COLORS[0])
    expect(sequentialColor(1.4)).toBe(SEQUENTIAL_COLORS[SEQUENTIAL_COLORS.length - 1])
    expect(sequentialColor(Number.NaN)).toBe(SEQUENTIAL_COLORS[0])
  })

  it('is monotone across the range', () => {
    const seen = [0, 0.2, 0.4, 0.6, 0.8, 1].map(sequentialColor)
    const indices = seen.map((c) => SEQUENTIAL_COLORS.indexOf(c as (typeof SEQUENTIAL_COLORS)[number]))
    expect(indices).toEqual([...indices].sort((a, b) => a - b))
  })
})

/**
 * #208. The ramp is only half of a heatmap cell that shows its value; the other
 * half is the ink drawn on top of it.
 *
 * These assertions are about the **module**, not the stylesheet: that what
 * `sequentialPair` hands a caller is a fill and an ink that were measured against
 * each other. `styles/seqInkContrast.test.ts` measures the stylesheet.
 */
describe('sequential paired ink', () => {
  const measured = measureSeqInkContrast()

  it('has exactly one ink per ramp step', () => {
    expect(SEQUENTIAL_INKS).toHaveLength(SEQUENTIAL_COLORS.length)
  })

  it('exposes only var() references, as the rest of the module does', () => {
    for (const value of SEQUENTIAL_INKS) {
      expect(value).toMatch(/^var\(--admin-chart-seq-\d-ink\)$/)
    }
  })

  it('references properties tokens.css declares in both themes', () => {
    // A typo'd var() name renders as *nothing* rather than as an error, and an
    // ink that renders as nothing is the exact bug this issue is about.
    for (const [index, value] of SEQUENTIAL_INKS.entries()) {
      const name = /^var\((--[\w-]+)\)$/.exec(value)![1]
      expect(light(name)).toMatch(/^#[0-9a-f]{6}$/)
      expect(dark(name)).toMatch(/^#[0-9a-f]{6}$/)
      // Index alignment is the load-bearing property: ink i must name step i+1.
      expect(name).toBe(`--admin-chart-seq-${index + 1}-ink`)
    }
  })

  it('exposes each ink as a Tailwind colour alongside its fill', () => {
    for (let step = 1; step <= SEQUENTIAL_INKS.length; step += 1) {
      expect(themeCss).toContain(`--color-chart-seq-${step}-ink: var(--admin-chart-seq-${step}-ink);`)
    }
  })

  it('clears WCAG AA for small text at every step of both themes', () => {
    // Measured by scripts/check-seq-contrast.mjs over the real tokens.css, per
    // step and per theme -- never as one aggregate, because a single worst-case
    // number lets a light-mode regression hide behind dark-mode headroom (#80
    // shipped four light-mode-only AA failures exactly that way).
    expect(measured.rows).toHaveLength(2 * SEQUENTIAL_COLORS.length)
    expect(
      measured.rows.filter((row) => !row.passes).map((row) => `${row.theme} seq-${row.step}`),
      'run `node scripts/check-seq-contrast.mjs` for the full table',
    ).toEqual([])
  })

  it('measures the pairing sequentialPair actually returns', () => {
    // The assertion above measures tokens.css. This one closes the loop: for
    // every fraction, the fill and ink the module hands out are the same pairing
    // that was measured. A misaligned list would pass the first and fail here.
    for (const [index, row] of measured.rows.filter((row) => row.theme === 'light').entries()) {
      const fraction = (index + 0.5) / SEQUENTIAL_COLORS.length
      expect(sequentialPair(fraction)).toEqual({
        fill: `var(--admin-chart-seq-${row.step})`,
        ink: `var(--admin-chart-seq-${row.step}-ink)`,
      })
    }
  })
})

describe('sequentialInk and sequentialPair', () => {
  it('lands on the same step as sequentialColor for every fraction', () => {
    // The bug the shared step calculation exists to prevent: two independent
    // roundings can disagree at a bucket boundary and pair an ink with a fill it
    // was never measured against.
    for (let n = 0; n <= 200; n += 1) {
      const fraction = n / 200
      const step = SEQUENTIAL_COLORS.indexOf(
        sequentialColor(fraction) as (typeof SEQUENTIAL_COLORS)[number],
      )
      expect(sequentialInk(fraction)).toBe(SEQUENTIAL_INKS[step])
      expect(sequentialPair(fraction)).toEqual({
        fill: SEQUENTIAL_COLORS[step],
        ink: SEQUENTIAL_INKS[step],
      })
    }
  })

  it('clamps out-of-range and NaN input the way the fill does', () => {
    expect(sequentialInk(-0.2)).toBe(SEQUENTIAL_INKS[0])
    expect(sequentialInk(1.4)).toBe(SEQUENTIAL_INKS[SEQUENTIAL_INKS.length - 1])
    expect(sequentialInk(Number.NaN)).toBe(SEQUENTIAL_INKS[0])
    expect(sequentialPair(Number.NaN).fill).toBe(SEQUENTIAL_COLORS[0])
  })

  it('reaches both ends of the ink list', () => {
    // Guard the guard: an ink list that returned index 0 for everything would
    // satisfy the alignment test above.
    expect(sequentialInk(0)).toBe(SEQUENTIAL_INKS[0])
    expect(sequentialInk(1)).toBe(SEQUENTIAL_INKS[SEQUENTIAL_INKS.length - 1])
    expect(sequentialInk(0)).not.toBe(sequentialInk(1))
  })
})

describe('divergingColor', () => {
  it('maps polarity onto the two poles', () => {
    expect(divergingColor(-1)).toBe(DIVERGING_COLORS[0])
    expect(divergingColor(-0.3)).toBe(DIVERGING_COLORS[1])
    expect(divergingColor(0)).toBe(DIVERGING_COLORS[2])
    expect(divergingColor(0.3)).toBe(DIVERGING_COLORS[3])
    expect(divergingColor(1)).toBe(DIVERGING_COLORS[4])
  })

  // Without a dead band, +0.02 sentiment renders as "positive", which overstates
  // what the data says.
  it('treats a small magnitude as neutral', () => {
    expect(divergingColor(0.05)).toBe(DIVERGING_COLORS[2])
    expect(divergingColor(-0.05)).toBe(DIVERGING_COLORS[2])
  })

  it('falls back to neutral for NaN', () => {
    expect(divergingColor(Number.NaN)).toBe(DIVERGING_COLORS[2])
  })
})
