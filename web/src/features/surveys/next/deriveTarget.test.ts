import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ActionPlan } from '../../action-plans/api/actionPlans'
import type { ClimateTrendsResponse } from '../api/climateTrends'
import type { SurveyAnalyticsResponse } from '../api/surveyResults'
import { composeResultsModel, previousSurveyOf, risesInARow, type PreviousPayloads } from './compose'
import {
  CLIMATE_TARGET,
  belowTarget,
  cellDetail,
  companyDelta,
  companyMean,
  printedMean,
  companyScores,
  dimensionDeltas,
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
  // The two the page makes for the previous wave, fetched the same way on 10 Sep.
  'GET /surveys/climate-trends': ClimateTrendsResponse
  'GET /surveys/7321a9bb-9e83-465a-a31d-73bdc186d626/analytics': SurveyAnalyticsResponse
}

const FIN = 'bff21fd0-422b-4f3b-8c89-d6bfbf5f19e9'
const ENG = '5bfdb04e-8847-4baa-89c8-d4411654a129'
const OPS = '0a9d7637-814c-4d4a-8407-45cfbca3f4e7'
const VEN = '07f5a4d4-27d8-4df0-afdc-b50db1371062'
const OPS_PLAN = '4f973f47-4ab2-4a5b-9606-af5db05670b8'

const Q2 = '7321a9bb-9e83-465a-a31d-73bdc186d626'
const Q3 = '38b2002f-66da-468d-b136-ec112ba3204b'
const trends = () => fixture['GET /surveys/climate-trends']
const q2 = () => structuredClone(fixture['GET /surveys/7321a9bb-9e83-465a-a31d-73bdc186d626/analytics'])
const Q1 = trends().surveys.find((survey) => survey.title === 'Encuesta de Clima Q1')!.surveyId

/** The previous wave as the hook hands it over: Q2, named by the trends window. */
function loaded(analytics: SurveyAnalyticsResponse = q2()): PreviousPayloads {
  const survey = trends().surveys.find((candidate) => candidate.surveyId === Q2)!
  return { status: 'loaded', trends: trends(), survey, analytics }
}

const real = () =>
  composeResultsModel(fixture['GET /surveys/*/analytics'], fixture['GET /action-plans'].actionPlans, null, loaded())
/** The tenant's Q3 against a doctored previous wave. */
const against = (analytics: SurveyAnalyticsResponse) =>
  composeResultsModel(fixture['GET /surveys/*/analytics'], [], null, loaded(analytics))

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
      // 4,0: its printed cells 4,0 · 3,7 · 4,0 · 3,5 · 4,2 · 4,3 average 3,95.
      ['Ingeniería', 4],
      ['Operaciones', 2.8],
      ['Personas', 4.1],
      ['Ventas', 3.8],
    ])
    expect(rows[0].scores.every((score) => score === null)).toBe(true)
  })

  it('reads the whole company per dimension, and its mean is the mean of the six printed cells', () => {
    const model = real()
    expect(companyScores(model)).toEqual([3.8, 3.3, 3.7, 3.4, 3.8, 4.0])
    // 3,67 — the six cells as printed, 22,0 / 6. The unrounded per-question means give
    // 3,6533 (3,65), the figure the Panel de Control prints off the trends scores; a mean
    // beside these six cells that their own average cannot reach is a number the page
    // cannot defend.
    expect(companyMean(model)).toBe(3.67)
  })

  it('averages the cells as printed, in whole tenths, so float noise cannot decide a half', () => {
    // 237 tenths over six cells is 39,5: 4,0. Summing the floats gives 3,9499… and 3,9.
    expect(printedMean([4.0, 3.7, 4.0, 3.5, 4.2, 4.3], 1)).toBe(4)
    // Each reading is rounded to its cell first: 3,75 prints 3,8 and 3,33 prints 3,3.
    expect(printedMean([3.75, 3.33, 3.67, 3.38, 3.79, 4.0], 2)).toBe(3.67)
    expect(printedMean([], 2)).toBeNull()
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
    const lifted = composeResultsModel(payload, [], null, { status: 'none' })
    expect(lifted.climate!.target).toBeGreaterThan(4)
    // Half the cells sit under that mean; none sits under the target.
    expect(whereToLookFirst(lifted)).toEqual([])
  })

  it('says "plans could not be loaded" rather than "no plan" when the plans request failed', () => {
    const model = composeResultsModel(fixture['GET /surveys/*/analytics'], null, null, { status: 'none' })
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

describe('against the previous wave, on the tenant’s real payloads', () => {
  it('names Q2 as the wave before Q3, as the Panel de Control does, and gives Q1 none', () => {
    // Q4's archived copy sits after Q3 in the window and is neither closed nor disclosed.
    expect(previousSurveyOf(trends(), Q3, null)?.surveyId).toBe(Q2)
    expect(previousSurveyOf(trends(), Q1, null)).toBeNull()
    // Outside the window (still open, say), the last comparable wave that closed before it.
    expect(previousSurveyOf(trends(), 'not-in-the-window', '2026-06-01T00:00:00Z')?.surveyId).toBe(Q2)
    expect(previousSurveyOf(trends(), 'not-in-the-window', null)).toBeNull()
  })

  it('counts the rises the way the dashboard does: Q1 3,03 → Q2 3,36 → Q3 3,65 is two', () => {
    expect(risesInARow(trends(), Q3)).toBe(2)
    expect(risesInARow(trends(), Q2)).toBe(1)
    expect(risesInARow(trends(), Q1)).toBe(0)
  })

  it('measures the company, every dimension and every group against Q2’s own analytics', () => {
    const model = real()
    expect(model.previous).toMatchObject({
      status: 'loaded',
      wave: { surveyId: Q2, code: 'Q2', hasGroupBreakdown: true, risesInARow: 2 },
    })
    // Every change is the difference of the readings AS PRINTED. The tile prints two
    // decimals: 3,67 (the six printed cells) against Q2's 3,35 (its own six: 3,5 · 3,0 ·
    // 3,3 · 3,1 · 3,5 · 3,7) is +0,32. The company row prints one: 3,7 against 3,4, +0,3.
    expect(companyDelta(model, 2)).toBe(0.32)
    expect(companyDelta(model, 1)).toBe(0.3)
    // Seguridad psicológica, Carga de trabajo, Confianza, Reconocimiento, Desarrollo,
    // Pertenencia. Confianza is 3,67 against 3,33 — printed 3,7 and 3,3 — so +0,4, where
    // the raw +0,34 would have printed +0,3 beside two figures 0,4 apart.
    expect(dimensionDeltas(model)).toEqual([0.3, 0.3, 0.4, 0.3, 0.3, 0.3])
    // Per group, at the one decimal of "Media del grupo": Ventas is 3,77 (3,8) against
    // Q2's 3,43 (3,4), so +0,4 where the raw +0,33 would have printed +0,3.
    expect(Object.fromEntries(groupRows(model).map((row) => [row.name, row.vsPrevious]))).toEqual({
      Finanzas: null,
      // 4,0 against the 3,6 Q2's printed cells average (3,8 · 3,5 · 3,7 · 3,2 · 3,8 · 3,8).
      Ingeniería: 0.4,
      Operaciones: 0.2,
      Personas: 0.2,
      Ventas: 0.4,
    })
  })

  it('gives a group the previous wave withheld no change at all — "sin Q2", never 0', () => {
    const withheld = q2()
    const ventas = withheld.breakdowns[0].segments.find((segment) => segment.key === VEN)!
    Object.assign(ventas, { isSuppressed: true, respondentCount: 0, questions: [] })
    const row = groupRows(against(withheld)).find((candidate) => candidate.id === VEN)!
    expect(row.isProtected).toBe(false)
    expect(row.vsPrevious).toBeNull()
  })

  it('treats a previous group under the floor as withheld, whatever the server flagged', () => {
    const under = q2()
    under.breakdowns[0].segments.find((segment) => segment.key === VEN)!.respondentCount = 4
    const model = against(under)
    expect(model.previous.status === 'loaded' && VEN in model.previous.wave.groupScores).toBe(false)
    expect(groupRows(model).find((candidate) => candidate.id === VEN)!.vsPrevious).toBeNull()
  })

  it('never compares a group this wave protects, even when the previous wave disclosed it', () => {
    const disclosed = q2()
    const segments = disclosed.breakdowns[0].segments
    const fin = segments.find((segment) => segment.key === FIN)!
    const eng = segments.find((segment) => segment.key === ENG)!
    Object.assign(fin, { isSuppressed: false, respondentCount: 6, questions: structuredClone(eng.questions) })
    const model = against(disclosed)
    expect(model.previous.status === 'loaded' && FIN in model.previous.wave.groupScores).toBe(true)
    expect(groupRows(model).find((candidate) => candidate.id === FIN)).toMatchObject({
      isProtected: true,
      mean: null,
      vsPrevious: null,
    })
  })

  it('compares like for like: a dimension only one wave asked cannot move the change', () => {
    const fewer = q2()
    const trust = fewer.questions.find((question) => question.category === 'trust')!.questionId
    fewer.questions = fewer.questions.filter((question) => question.questionId !== trust)
    for (const segment of fewer.breakdowns[0].segments) {
      segment.questions = segment.questions.filter((entry) => entry.questionId !== trust)
    }
    const model = against(fewer)
    // Over the five dimensions both waves carry, and nothing else, as printed: 3,8 · 3,3 ·
    // 3,4 · 3,8 · 4,0 average 3,66 against Q2's 3,5 · 3,0 · 3,1 · 3,5 · 3,7 at 3,36 —
    // +0,30. Over all six of this wave's cells it would be 3,67 − 3,36 = +0,31.
    expect(companyDelta(model, 2)).toBe(0.3)
    expect(dimensionDeltas(model)[2]).toBeNull()
  })

  it('says why there is no comparison rather than printing one: a first wave, a failed request', () => {
    const first = composeResultsModel(fixture['GET /surveys/*/analytics'], [], null, { status: 'none' })
    expect(first.previous).toEqual({ status: 'none' })
    expect(companyDelta(first, 2)).toBeNull()
    expect(dimensionDeltas(first).every((delta) => delta === null)).toBe(true)
    expect(groupRows(first).every((row) => row.vsPrevious === null)).toBe(true)
    const failed = composeResultsModel(fixture['GET /surveys/*/analytics'], [], null, { status: 'failed' })
    expect(failed.previous).toEqual({ status: 'failed' })
    expect(companyDelta(failed, 2)).toBeNull()
  })
})
