import { describe, it, expect } from 'vitest'
import type { AdminDashboardModel, DimensionSeries } from './model'
import { latestAverage, mean, previousAverage, printedMove, waveAverage } from './derive'

/**
 * The app-wide mean, and why these inputs and not rounder ones.
 *
 * Ruled 2026-09-14 (`docs/decisions/app-wide-mean.md`): the figure is the mean of the
 * UNROUNDED dimension means, never the mean of the one-decimal readings drawn beside it.
 *
 * A test whose dimension values are already at one decimal cannot tell those two rules
 * apart — both give the same answer — which is why the `waveMean` case in
 * `surveys/next/trends/derive.test.ts` passed for months without pinning anything. These
 * are Grupo Meridiano's real Q1/Q2/Q3 company rows from
 * `scripts/shot-fixtures/redesign-meridiano.json`, chosen because they DO separate them:
 *
 *   Q3  4 · 3,79 · 3,75 · 3,38 · 3,67 · 3,33
 *       unrounded   21,92 / 6 = 3,6533  -> 3,65   <- the rule
 *       as printed  22,0  / 6 = 3,6667  -> 3,67   <- the artboards' figure, rejected
 */
const Q1 = [3.33, 3.17, 3.17, 2.79, 2.96, 2.75]
const Q2 = [3.67, 3.54, 3.5, 3.08, 3.33, 3.04]
const Q3 = [4, 3.79, 3.75, 3.38, 3.67, 3.33]

const KEYS = ['belonging', 'growth', 'psychological_safety', 'recognition', 'trust', 'workload']

/** Only `dimensions` is read by the functions under test; the rest of the model is not. */
function modelOf(waves: readonly (readonly number[])[]): AdminDashboardModel {
  const dimensions: DimensionSeries[] = KEYS.map((key, row) => ({
    key,
    name: key,
    values: waves.map((wave) => wave[row] as number),
  }))
  return { dimensions } as unknown as AdminDashboardModel
}

describe('the app-wide climate mean', () => {
  it('averages the unrounded dimension means, not the readings as printed', () => {
    const model = modelOf([Q1, Q2, Q3])

    // 21,92 / 6. The rejected rule would give 3,6667 and round to 3,67.
    expect(latestAverage(model)).toBeCloseTo(3.6533, 4)
    expect(Number(latestAverage(model)?.toFixed(2))).toBe(3.65)

    // The discriminator, stated outright: averaging the printed readings is a different
    // number, and it is the one the artboards draw.
    const asPrinted = mean(Q3.map((value) => Number(value.toFixed(1))))
    expect(Number(asPrinted?.toFixed(2))).toBe(3.67)
    expect(Number(latestAverage(model)?.toFixed(2))).not.toBe(Number(asPrinted?.toFixed(2)))
  })

  it('reads each wave in place, oldest first', () => {
    const model = modelOf([Q1, Q2, Q3])
    expect(waveAverage(model, 0)).toBeCloseTo(3.0283, 4)
    expect(waveAverage(model, 1)).toBeCloseTo(3.36, 4)
    expect(waveAverage(model, 2)).toBeCloseTo(3.6533, 4)
    expect(previousAverage(model)).toBeCloseTo(3.36, 4)
  })

  it('prints the move as the difference of the two means AS PRINTED, at two decimals', () => {
    const model = modelOf([Q1, Q2, Q3])
    const latest = latestAverage(model) as number
    const previous = previousAverage(model) as number

    // 3,65 - 3,36 = +0,29, the number a reader gets by subtracting what is on screen.
    // The raw difference is 0,2933; the artboards print +0,32, which is the printed-average
    // rule's delta (3,67 - 3,35) and is rejected with it.
    expect(printedMove(latest, previous, 2)).toBeCloseTo(0.29, 10)
  })

  it('leaves a wave no dimension disclosed without a mean', () => {
    expect(mean([])).toBeNull()
  })
})
