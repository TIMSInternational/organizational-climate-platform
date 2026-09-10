import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ActionPlan } from '../../action-plans/api/actionPlans'
import type { SurveyAnalyticsResponse } from '../api/surveyResults'
import { composeResultsModel } from './compose'
import {
  CLIMATE_TARGET,
  belowTarget,
  cellDetail,
  companyMean,
  companyScores,
  groupRows,
  targetBand,
  whereToLookFirst,
  type TargetBand,
} from './derive'

/**
 * The demo tenant's REAL payloads: `GET /surveys/{id}/analytics?lang=es`, `GET
 * /surveys/{id}` and `GET /action-plans?companyId=` for Grupo Meridiano's Q3, fetched
 * read-only from the local API on 10 Sep as the company administrator and written to
 * the shot fixture unmodified. #468's drill-in was tested only on a hand-made payload;
 * these tests pin every derived figure against the payload the tenant actually serves.
 */
const FIXTURE = join(process.cwd(), 'scripts', 'shot-fixtures', 'survey-results-meridiano.json')
const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
  'GET /surveys/*/analytics': SurveyAnalyticsResponse
  'GET /action-plans': { actionPlans: ActionPlan[] }
}

const FIN = 'bff21fd0-422b-4f3b-8c89-d6bfbf5f19e9'
const ENG = '5bfdb04e-8847-4baa-89c8-d4411654a129'
const OPS = '0a9d7637-814c-4d4a-8407-45cfbca3f4e7'
const VEN = '07f5a4d4-27d8-4df0-afdc-b50db1371062'
const OPS_PLAN = '4f973f47-4ab2-4a5b-9606-af5db05670b8'

const real = () =>
  composeResultsModel(fixture['GET /surveys/*/analytics'], fixture['GET /action-plans'].actionPlans, null)

describe('against the climate target, on the tenant’s real payload', () => {
  it('is the Panel de Control’s target, 3.7', () => {
    expect(CLIMATE_TARGET).toBe(3.7)
  })

  it('bands a reading the way the artboard tints it', () => {
    // The SurveyResults artboard's cells, value -> colour, read off its .dc.html.
    const table: [number, TargetBand][] = [
      [2.4, 'far-below'],
      [2.6, 'far-below'],
      [2.7, 'far-below'],
      [2.8, 'below'],
      [3.4, 'below'],
      [3.5, 'on'],
      [3.6, 'on'],
      [3.7, 'on'],
      [3.8, 'above'],
      [4.0, 'above'],
      [4.2, 'far-above'],
      [4.4, 'far-above'],
    ]
    for (const [value, band] of table) expect(targetBand(value), `${value}`).toBe(band)
  })

  it('tints every disclosed cell of the real map as the artboard does, and hatches Finanzas', () => {
    const bands = Object.fromEntries(
      groupRows(real()).map((row) => [row.name, row.isProtected ? 'protected' : row.scores.map((s) => targetBand(s as number))]),
    )
    expect(bands).toEqual({
      Finanzas: 'protected',
      Ingeniería: ['above', 'on', 'above', 'on', 'far-above', 'far-above'],
      Operaciones: ['far-below', 'far-below', 'below', 'below', 'below', 'below'],
      Personas: ['far-above', 'above', 'above', 'on', 'far-above', 'far-above'],
      Ventas: ['above', 'below', 'above', 'on', 'above', 'above'],
    })
  })

  it('gives every group its mean, and the protected one none — never 0', () => {
    const rows = groupRows(real())
    expect(rows.map((row) => [row.name, row.mean])).toEqual([
      ['Finanzas', null],
      ['Ingeniería', 3.9],
      ['Operaciones', 2.8],
      ['Personas', 4.1],
      ['Ventas', 3.8],
    ])
    expect(rows[0].scores.every((score) => score === null)).toBe(true)
  })

  it('reads the whole company per dimension and averages the unrounded means, as the dashboard does', () => {
    const model = real()
    expect(companyScores(model)).toEqual([3.8, 3.3, 3.7, 3.4, 3.8, 4.0])
    // 3,65 — the mean of the six unrounded means (21.92 / 6), which is the figure the
    // Panel de Control prints for Q3 (`latestAverage` over the trends scores). The
    // artboard's 3,67 is the mean of the six ROUNDED cells; printing it here would put
    // two numbers for one survey on two screens.
    expect(companyMean(model)).toBe(3.65)
  })

  it('names the dimensions under the target, worst first', () => {
    expect(belowTarget(real())).toEqual([
      { key: 'workload', score: 3.3 },
      { key: 'recognition', score: 3.4 },
    ])
  })

  it('picks the artboard’s three cells, with the breadth rule and a derived reason each', () => {
    const findings = whereToLookFirst(real())
    expect(
      findings.map((f) => ({ row: f.rowId, key: f.dimensionKey, score: f.score, shortfall: f.shortfall, reason: f.reason })),
    ).toEqual([
      { row: OPS, key: 'workload', score: 2.4, shortfall: 1.3, reason: 'lowest' },
      { row: OPS, key: 'psychological_safety', score: 2.6, shortfall: 1.1, reason: 'second-same-group' },
      // Operaciones' recognition (2,8) is lower, but a third Operaciones cell would say
      // nothing about the rest of the organisation: the slot goes outside the group.
      { row: VEN, key: 'workload', score: 3.4, shortfall: 0.3, reason: 'only-red-outside' },
    ])
    expect(findings[2].outsideOf).toBe('Operaciones')
    // Plans match by GROUP (an ActionPlan carries a department, not a dimension).
    expect(findings[0].plan?.id).toBe(OPS_PLAN)
    expect(findings[1].plan?.id).toBe(OPS_PLAN)
    expect(findings[2].plan).toBeNull()
  })

  it('measures the findings against the target, not the survey’s own mean', () => {
    // The tenant's payload with every group lifted 1.3: every cell now clears 3,7,
    // while the map's own mean (what #468 measured against) climbs past 4.
    const payload = structuredClone(fixture['GET /surveys/*/analytics'])
    for (const segment of payload.breakdowns[0].segments) {
      for (const entry of segment.questions) entry.average = Math.min(5, (entry.average ?? 0) + 1.3)
    }
    const lifted = composeResultsModel(payload, [], null)
    expect(lifted.climate!.target).toBeGreaterThan(4)
    // Half the cells sit under that mean; none sits under the target.
    expect(whereToLookFirst(lifted)).toEqual([])
  })

  it('says "plans could not be loaded" rather than "no plan" when the plans request failed', () => {
    const model = composeResultsModel(fixture['GET /surveys/*/analytics'], null, null)
    expect(whereToLookFirst(model).every((f) => f.plan === undefined)).toBe(true)
  })

  it('opens the lowest cell on the real payload — the drill-in #468 never showed', () => {
    const detail = cellDetail(real(), { rowId: OPS, dimensionKey: 'workload' })
    expect(detail).not.toBeNull()
    expect(detail).toMatchObject({
      rowName: 'Operaciones',
      score: 2.4,
      band: 'far-below',
      shortfall: 1.3,
      isLowest: true,
      questionCount: 1,
      oneQuestionPerDimension: true,
      plan: { id: OPS_PLAN, name: 'Reducir la carga de trabajo en Operaciones', status: 'not_started' },
    })
    const [question] = detail!.questions
    expect(question).toMatchObject({
      text: 'Mi carga de trabajo es sostenible a largo plazo.',
      groupScore: 2.4,
      groupAnswered: 5,
      surveyScore: 3.33,
      surveyAnswered: 24,
      scaleMin: 1,
      scaleMax: 5,
      scaleLabelMin: 'Muy en desacuerdo',
      scaleLabelMax: 'Muy de acuerdo',
    })
    expect(question.surveyDistribution.map((point) => point.percentage)).toEqual([0, 16.67, 37.5, 41.67, 4.17])
    expect(detail!.others).toEqual([
      { id: FIN, name: 'Finanzas', isProtected: true, score: null, band: null },
      { id: ENG, name: 'Ingeniería', isProtected: false, score: 3.7, band: 'on' },
      { id: 'aac7e1b9-5af4-4e04-872b-c11df8f1d4bd', name: 'Personas', isProtected: false, score: 4, band: 'above' },
      { id: VEN, name: 'Ventas', isProtected: false, score: 3.4, band: 'below' },
    ])
  })

  it('opens every disclosed cell of the real map, and never the protected group’s', () => {
    const model = real()
    for (const row of groupRows(model)) {
      for (const dimension of model.climate!.dimensions) {
        const detail = cellDetail(model, { rowId: row.id, dimensionKey: dimension.key })
        if (row.isProtected) expect(detail, `${row.name} ${dimension.key}`).toBeNull()
        else expect(detail?.questions.length, `${row.name} ${dimension.key}`).toBe(1)
      }
    }
  })
})
