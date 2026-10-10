import { describe, expect, it } from 'vitest'
import type { ClimateTrendsResponse } from '../../surveys/api/climateTrends'
import { daysToDue, dueDay, elapsedShare, planFinding, planMove } from './planDetailDerive'

/** The tenant's plan: due 2026-10-15T02:05Z, which the list prints as the 15th. */
const DUE = '2026-10-15T02:05:50.278+00:00'

describe('the due date', () => {
  it('is the UTC calendar day the list prints', () => {
    expect(dueDay(DUE)).toBe('2026-10-15')
  })

  it('counts 35 days from 10 Sep, as the board reads it, and goes negative once passed', () => {
    expect(daysToDue('2026-09-10', DUE)).toBe(35)
    expect(daysToDue('2026-10-18', DUE)).toBe(-3)
  })

  it('places a plan created today at the left end of its timeline, and a late one at the right', () => {
    expect(elapsedShare('2026-09-10T02:05:50Z', '2026-09-10', DUE)).toBe(0)
    expect(elapsedShare('2026-09-10T02:05:50Z', '2026-09-27', DUE)).toBeCloseTo(17 / 35)
    expect(elapsedShare('2026-09-10T02:05:50Z', '2026-11-01', DUE)).toBe(1)
    expect(elapsedShare(null, '2026-09-27', DUE)).toBe(0)
  })
})

const OPS = 'ops'
const SALES = 'sales'

function trends(opsPoint: { respondentCount: number; isSuppressed: boolean; scores: (number | null)[] }): ClimateTrendsResponse {
  return {
    companyId: 'c1',
    groupBy: 'department',
    surveys: [
      { surveyId: 'q2', title: 'Encuesta de Clima Q2', status: 'closed', endDate: '2026-05-13T00:00:00Z', completedCount: 24, isSuppressed: false },
      { surveyId: 'q3', title: 'Encuesta de Clima Q3', status: 'closed', endDate: '2026-08-06T00:00:00Z', completedCount: 24, isSuppressed: false },
    ],
    dimensions: [
      { key: 'trust', surveyCount: 2 },
      { key: 'workload', surveyCount: 2 },
    ],
    groups: [
      {
        key: OPS,
        label: 'Operaciones',
        points: [
          { surveyId: 'q2', respondentCount: 6, isSuppressed: false, scores: [1.1, 1.2] },
          { surveyId: 'q3', ...opsPoint },
        ],
      },
      {
        key: SALES,
        label: 'Ventas',
        points: [
          { surveyId: 'q2', respondentCount: 6, isSuppressed: false, scores: [3.5, 3.6] },
          { surveyId: 'q3', respondentCount: 7, isSuppressed: false, scores: [3.1, 2.9] },
        ],
      },
    ],
    suppressedGroupCount: 0,
    minimumGroupSize: 5,
    generatedAt: '2026-09-10T00:00:00Z',
  }
}

describe('the originating finding', () => {
  it('falls back to the lowest cell of the plan’s row when the plan recorded none', () => {
    const finding = planFinding(trends({ respondentCount: 6, isSuppressed: false, scores: [3.2, 2.4] }), 'q3', OPS)
    expect(finding).toEqual({
      status: 'shown',
      surveyId: 'q3',
      surveyTitle: 'Encuesta de Clima Q3',
      code: 'Q3',
      dimensionKey: 'workload',
      score: 2.4,
      lowestOfMap: true,
      // Nothing was recorded, so the screen chose the cell and must say so.
      proposed: true,
    })
  })

  /**
   * The defect this replaced, measured on production on 2026-10-10: a plan titled
   * "… — Carga de trabajo", whose description says "Seguimiento de Carga de trabajo …
   * Puntaje 2,6", printed "Reconocimiento 2,6" as its origin — because the row tied at 2,6
   * and the screen took the lowest instead of the one the plan recorded.
   */
  it('reads the cell the plan recorded, not the lowest of its row', () => {
    const map = trends({ respondentCount: 6, isSuppressed: false, scores: [3.2, 2.4] })
    const finding = planFinding(map, 'q3', OPS, { sourceSurveyId: 'q3', dimensionKey: 'trust' })
    expect(finding.status === 'shown' && finding.dimensionKey).toBe('trust')
    expect(finding.status === 'shown' && finding.score).toBe(3.2)
    expect(finding.status === 'shown' && finding.proposed).toBe(false)
  })

  it('reads the wave the plan was raised in, not the latest one', () => {
    const map = trends({ respondentCount: 6, isSuppressed: false, scores: [3.2, 2.4] })
    const finding = planFinding(map, 'q3', OPS, { sourceSurveyId: 'q2', dimensionKey: 'trust' })
    expect(finding.status === 'shown' && finding.surveyId).toBe('q2')
    expect(finding.status === 'shown' && finding.score).toBe(1.1)
  })

  it('proposes again, rather than printing a wrong number, when the tag names a dimension this instrument never asked', () => {
    const map = trends({ respondentCount: 6, isSuppressed: false, scores: [3.2, 2.4] })
    const finding = planFinding(map, 'q3', OPS, { sourceSurveyId: 'q3', dimensionKey: 'belonging' })
    expect(finding.status === 'shown' && finding.dimensionKey).toBe('workload')
    expect(finding.status === 'shown' && finding.proposed).toBe(true)
  })

  it('says when the plan’s cell is not the lowest of the whole map', () => {
    const finding = planFinding(trends({ respondentCount: 6, isSuppressed: false, scores: [3.2, 3.0] }), 'q3', OPS)
    expect(finding.status === 'shown' && finding.lowestOfMap).toBe(false)
  })

  it('yields no number for a row the server withheld — never the lowest of an empty row', () => {
    const finding = planFinding(trends({ respondentCount: 0, isSuppressed: true, scores: [null, null] }), 'q3', OPS)
    expect(finding).toEqual({ status: 'protected', surveyId: 'q3', surveyTitle: 'Encuesta de Clima Q3', code: 'Q3', proposed: true })
  })

  it('protects a row under the floor even when the server sent its scores', () => {
    const finding = planFinding(trends({ respondentCount: 4, isSuppressed: false, scores: [3.2, 2.4] }), 'q3', OPS)
    expect(finding.status).toBe('protected')
  })

  it('finds nothing for a department the map does not have', () => {
    expect(planFinding(trends({ respondentCount: 6, isSuppressed: false, scores: [3.2, 2.4] }), 'q3', 'unknown')).toEqual({
      status: 'none',
    })
  })

  it('falls back to the latest closed wave the map carries when no survey is named', () => {
    const finding = planFinding(trends({ respondentCount: 6, isSuppressed: false, scores: [3.2, 2.4] }), null, OPS)
    expect(finding.status === 'shown' && finding.surveyId).toBe('q3')
  })
})

describe('did the plan move the number', () => {
  const raisedInQ2 = { sourceSurveyId: 'q2', dimensionKey: 'trust' } as const

  it('reads the same cell in a wave that closed after the plan was raised', () => {
    const map = trends({ respondentCount: 6, isSuppressed: false, scores: [3.2, 2.4] })
    const finding = planFinding(map, 'q3', OPS, raisedInQ2)
    // Operaciones, trust: 1.1 when the plan was raised in Q2, 3.2 in Q3.
    expect(planMove(map, finding, OPS)).toEqual({
      status: 'moved',
      fromCode: 'Q2',
      from: 1.1,
      toCode: 'Q3',
      to: 3.2,
      surveyId: 'q3',
    })
  })

  it('says nothing has closed since, rather than nothing at all, for a plan raised in the latest wave', () => {
    const map = trends({ respondentCount: 6, isSuppressed: false, scores: [3.2, 2.4] })
    const finding = planFinding(map, 'q3', OPS, { sourceSurveyId: 'q3', dimensionKey: 'trust' })
    expect(planMove(map, finding, OPS)).toEqual({ status: 'awaiting', code: 'Q3' })
  })

  /**
   * The floor, on the one surface where a reader is looking for a number and would read an
   * absent one as progress. The later wave withheld the group, so there is no score to
   * difference and the screen says which wave withheld it, never a figure.
   */
  it('refuses a number when the later wave withholds the group', () => {
    const map = trends({ respondentCount: 0, isSuppressed: true, scores: [null, null] })
    const finding = planFinding(map, 'q3', OPS, raisedInQ2)
    expect(planMove(map, finding, OPS)).toEqual({ status: 'protected', code: 'Q2' })
  })

  /**
   * The guard with teeth. The wave above is `isSuppressed` AND scoreless, so either half of
   * the check would stop it; this one is a group the server did NOT mark but whose count is
   * under the floor, with real scores on the payload — only the count check refuses it.
   * `SurveyClimateTrendsDtos` says why both exist: the server applies its own floor, and a
   * company may raise it, so a client that trusted the flag alone would print a number the
   * tenant had asked to be withheld.
   */
  it('refuses a number when the later wave is under the floor but the payload still carries its scores', () => {
    const map = trends({ respondentCount: 6, isSuppressed: false, scores: [3.2, 2.4] })
    const ops = map.groups.find((group) => group.key === OPS)!
    ops.points[1] = { surveyId: 'q3', respondentCount: 4, isSuppressed: false, scores: [3.2, 2.4] }
    const finding = planFinding(map, 'q3', OPS, raisedInQ2)
    expect(planMove(map, finding, OPS)).toEqual({ status: 'protected', code: 'Q2' })
  })

  it('refuses a number when the later wave is over the floor but the server sent no score for the cell', () => {
    const map = trends({ respondentCount: 6, isSuppressed: false, scores: [null, 2.4] })
    const finding = planFinding(map, 'q3', OPS, raisedInQ2)
    expect(planMove(map, finding, OPS)).toEqual({ status: 'protected', code: 'Q2' })
  })

  it('has nothing to say about a finding the screen proposed: that would difference today against itself', () => {
    const map = trends({ respondentCount: 6, isSuppressed: false, scores: [3.2, 2.4] })
    const proposed = planFinding(map, 'q3', OPS)
    expect(proposed.status === 'shown' && proposed.proposed).toBe(true)
    expect(planMove(map, proposed, OPS)).toEqual({ status: 'none' })
  })
})
