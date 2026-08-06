import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import tokensCss from './tokens.css?raw'
import { measureSeqInkContrast } from '../test/seqInkContrast'

/**
 * #208. Every `(--admin-chart-seq-N, --admin-chart-seq-N-ink)` pairing clears
 * WCAG AA for small text, **in both themes**, measured rather than eyeballed.
 *
 * The value inside a `HeatMap` cell is painted on the ramp swatch, so the ramp
 * *is* the background for that text. Before the ink tokens existed a single ink
 * measured 1.56:1 against dark-mode `seq-7` — text you cannot see — and 3 of 11
 * rendered cells were under 3:1.
 *
 * ## Why this checks both themes, loudly
 *
 * A contrast failure in one theme only is this repo's recurring blind spot: #80's
 * browser verification found four WCAG AA failures that were **light-mode only**,
 * while the dark palette passed all four. Asserting a single aggregate "worst
 * ratio" would let one theme's regression hide behind the other's headroom, so
 * every one of the fourteen pairings is asserted by name, per theme.
 *
 * ## Why it shells out
 *
 * `scripts/check-seq-contrast.mjs` is the instrument a human runs when changing a
 * hex. If this file reimplemented the WCAG formula, the two could drift and both
 * be wrong while agreeing with each other. Running the script means CI verifies
 * the same numbers a developer sees, and that the script still runs at all.
 */

/** Writes a tokens-shaped stylesheet with the given ramp/ink values. */
function fixture(light: [string, string][], dark: [string, string][]): string {
  const block = (pairs: [string, string][]) =>
    pairs
      .flatMap(([fill, ink], index) => [
        `  --admin-chart-seq-${index + 1}: ${fill};`,
        `  --admin-chart-seq-${index + 1}-ink: ${ink};`,
      ])
      .join('\n')

  const path = join(mkdtempSync(join(tmpdir(), 'seq-ink-')), 'tokens.css')
  writeFileSync(
    path,
    `/* a comment { with a brace } so the block matcher is exercised */\n` +
      `:root {\n${block(light)}\n}\n\n` +
      `:root[data-admin-theme='dark'] {\n${block(dark)}\n}\n`,
  )
  return path
}

/** Seven safe pairings, used as the padding around a deliberately-bad one. */
const SAFE: [string, string][] = Array.from({ length: 7 }, () => ['#ffffff', '#000000'])

const report = measureSeqInkContrast()
const rowsByTheme = (theme: 'light' | 'dark') => report.rows.filter((row) => row.theme === theme)

describe('sequential ramp ink contrast', () => {
  it('measures every step of both themes', () => {
    // Guard the guard: an empty report would make every assertion below pass
    // vacuously, which is exactly how a contrast guard silently stops guarding.
    expect(report.rows).toHaveLength(14)
    expect(rowsByTheme('light').map((row) => row.step)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(rowsByTheme('dark').map((row) => row.step)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(report.threshold).toBe(4.5)
  })

  it('exits zero, so a red script is a red build', () => {
    expect(report.status, report.stderr).toBe(0)
  })

  describe.each(['light', 'dark'] as const)('%s theme', (theme) => {
    // Named per step rather than as one aggregate: a single "worst ratio"
    // assertion lets one theme's regression hide behind the other's headroom,
    // and a one-theme failure is the exact bug #80 shipped four of.
    it.each([1, 2, 3, 4, 5, 6, 7])(`seq-%i clears 4.5:1`, (step) => {
      const row = rowsByTheme(theme).find((candidate) => candidate.step === step)!
      expect(
        row.ratio,
        `${theme} seq-${step}: ${row.ink} on ${row.fill} is ${row.ratio.toFixed(2)}:1. ` +
          'Re-measure with `node scripts/check-seq-contrast.mjs` rather than adjusting by eye.',
      ).toBeGreaterThanOrEqual(4.5)
    })
  })

  it('reads the ramp and the ink out of the real stylesheet', () => {
    // Ties the measured numbers to tokens.css, so the script cannot be measuring
    // some other file's colours.
    for (const row of report.rows) {
      expect(tokensCss).toContain(`--admin-chart-seq-${row.step}: ${row.fill};`)
      expect(tokensCss).toContain(`--admin-chart-seq-${row.step}-ink: ${row.ink};`)
    }
  })

  it('flips the ink at a different step in each theme', () => {
    // The reason a paired token is needed at all rather than one ink and a rule
    // of thumb: the ramp is *selected* per theme rather than flipped, so the step
    // where black stops working is not the same step in both.
    const inks = (theme: 'light' | 'dark') => rowsByTheme(theme).map((row) => row.ink)
    const flipAt = (theme: 'light' | 'dark') =>
      inks(theme).findIndex((ink, index) => index > 0 && ink !== inks(theme)[index - 1])
    expect(flipAt('light')).toBe(6)
    expect(flipAt('dark')).toBe(4)
  })
})

describe('the measurement itself', () => {
  it('agrees with the WCAG reference values', () => {
    // Black on white is 21:1 and white on white is 1:1 by definition. If the
    // formula is wrong these are the two numbers that say so.
    const rows = measureSeqInkContrast(
      fixture(
        [['#ffffff', '#000000'], ...SAFE.slice(1)],
        [['#ffffff', '#ffffff'], ...SAFE.slice(1)],
      ),
    ).rows
    expect(rows.find((row) => row.theme === 'light' && row.step === 1)!.ratio).toBeCloseTo(21, 5)
    expect(rows.find((row) => row.theme === 'dark' && row.step === 1)!.ratio).toBeCloseTo(1, 5)
  })

  it('is symmetric — ink on fill measures the same as fill on ink', () => {
    const rows = measureSeqInkContrast(
      fixture([['#0f766e', '#f0fdfa'], ...SAFE.slice(1)], [['#f0fdfa', '#0f766e'], ...SAFE.slice(1)]),
    ).rows
    const light = rows.find((row) => row.theme === 'light' && row.step === 1)!.ratio
    const dark = rows.find((row) => row.theme === 'dark' && row.step === 1)!.ratio
    expect(light).toBeCloseTo(dark, 10)
  })
})

describe('the guard detects what it is meant to detect', () => {
  it('fails a pairing below the threshold', () => {
    // The exact pairing #208 was filed about: the old single ink on dark seq-7.
    const bad = measureSeqInkContrast(fixture(SAFE, [...SAFE.slice(0, 6), ['#2dd4bf', '#ebebeb']]))
    const row = bad.rows.find((candidate) => candidate.theme === 'dark' && candidate.step === 7)!
    expect(row.ratio).toBeCloseTo(1.56, 2)
    expect(row.passes).toBe(false)
    expect(bad.status).toBe(1)
  })

  it('fails a light-mode-only regression, not just a dark-mode one', () => {
    // The blind spot in the prompt and in #80: a guard that only ever gets
    // exercised against dark-mode failures can be blind to light-mode ones.
    const bad = measureSeqInkContrast(fixture([...SAFE.slice(0, 5), ['#0d9488', '#042f2e'], SAFE[6]], SAFE))
    expect(bad.rows.filter((row) => !row.passes).map((row) => `${row.theme}-${row.step}`)).toEqual([
      'light-6',
    ])
    expect(bad.status).toBe(1)
  })

  it('fails rather than passes vacuously when an ink token is missing', () => {
    // A regex that silently matches nothing would otherwise report an empty,
    // passing table -- the most dangerous failure mode a guard has.
    const path = join(mkdtempSync(join(tmpdir(), 'seq-ink-')), 'tokens.css')
    writeFileSync(path, `:root {\n  --admin-chart-seq-1: #ffffff;\n}\n`)
    const missing = measureSeqInkContrast(path)
    expect(missing.status).toBe(1)
    expect(missing.rows).toEqual([])
    expect(missing.error).toContain('--admin-chart-seq-1-ink')
  })

  it('passes a stylesheet where every pairing is safe', () => {
    // The counterpart: a guard that rejects everything is not a guard.
    const good = measureSeqInkContrast(fixture(SAFE, SAFE))
    expect(good.status).toBe(0)
    expect(good.rows.every((row) => row.passes)).toBe(true)
  })
})
