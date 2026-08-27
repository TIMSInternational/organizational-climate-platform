import { describe, it, expect } from 'vitest'
import { buildClimateTrendMap, trendRowLabel } from './climateTrendsMap'
import type {
  ClimateTrendGroup,
  ClimateTrendPoint,
  ClimateTrendsResponse,
  ClimateTrendSurvey,
} from './api/climateTrends'

/**
 * The model between the trends payload and `ClimateMap`.
 *
 * What these pin is the seam where a privacy guarantee could be lost silently: the server
 * withholds a reading, and this module has to carry that withholding into a shape whose
 * `scores` array has no representation for a missing cell. Getting that wrong does not
 * throw — it prints a number.
 */

const ISO_JAN = '2026-01-31T00:00:00+00:00'
const ISO_JUN = '2026-06-30T00:00:00+00:00'

/** Deterministic, so a row label assertion does not depend on the runner's timezone or ICU. */
const formatDate = (iso: string) => iso.slice(0, 7)

function survey(id: string, endDate: string, title: string | null = 'Wave'): ClimateTrendSurvey {
  return { surveyId: id, title, status: 'closed', endDate, completedCount: 20, isSuppressed: false }
}

function point(surveyId: string, scores: (number | null)[], respondentCount = 20): ClimateTrendPoint {
  return { surveyId, respondentCount, isSuppressed: false, scores }
}

function suppressedPoint(surveyId: string, width: number): ClimateTrendPoint {
  return {
    surveyId,
    respondentCount: 0,
    isSuppressed: true,
    scores: Array.from({ length: width }, () => null),
  }
}

function payloadOf(
  surveys: ClimateTrendSurvey[],
  dimensionKeys: string[],
  group: ClimateTrendGroup,
  overrides: Partial<ClimateTrendsResponse> = {},
): ClimateTrendsResponse {
  return {
    companyId: 'company-1',
    groupBy: null,
    surveys,
    dimensions: dimensionKeys.map((key) => ({ key, surveyCount: surveys.length })),
    groups: [group],
    suppressedGroupCount: 0,
    minimumGroupSize: 5,
    generatedAt: ISO_JUN,
    ...overrides,
  }
}

describe('buildClimateTrendMap', () => {
  it('makes one row per survey, oldest first, with the dimensions as columns', () => {
    const payload = payloadOf(
      [survey('s1', ISO_JAN, 'January'), survey('s2', ISO_JUN, 'June')],
      ['trust', 'wellbeing'],
      {
        key: '__company__',
        label: null,
        points: [point('s1', [3.0, 4.0]), point('s2', [3.5, 4.5])],
      },
    )

    const model = buildClimateTrendMap(payload, payload.groups[0], formatDate)!

    expect(model.rows.map((row) => row.label)).toEqual(['January', 'June'])
    expect(model.dimensions.map((d) => d.key)).toEqual(['trust', 'wellbeing'])
    expect(model.rows.map((row) => row.scores)).toEqual([
      [3.0, 4.0],
      [3.5, 4.5],
    ])
  })

  /**
   * THE property. A withheld wave must reach `ClimateMap` as a row it will hatch — which
   * means `responses` below the threshold and no scores. Emitting the scores array the
   * server sent (all nulls) would put nulls into a dense `number[]`, and `formatMetric`
   * renders those as something.
   */
  it('carries a withheld wave through as a hatchable row with no scores', () => {
    const payload = payloadOf(
      [survey('s1', ISO_JAN), survey('s2', ISO_JUN)],
      ['trust'],
      {
        key: 'sales',
        label: 'Sales',
        points: [suppressedPoint('s1', 1), point('s2', [4.0])],
      },
    )

    const model = buildClimateTrendMap(payload, payload.groups[0], formatDate)!

    expect(model.rows[0].scores).toEqual([])
    expect(model.rows[0].responses).toBe(0)
    // Under the threshold is exactly what makes ClimateMap render it protected.
    expect(model.rows[0].responses).toBeLessThan(model.threshold)
    expect(model.rows[1].scores).toEqual([4.0])
  })

  /**
   * A floor of 0 would make `isSuppressed(0, 0)` false, and the row would try to read
   * scores it does not have. `minimumGroupSize` of 0 is not hypothetical: it is what a
   * payload missing the field deserialises to.
   */
  it('never lets the threshold fall to zero', () => {
    const payload = payloadOf([survey('s1', ISO_JAN)], ['trust'], {
      key: 'sales',
      label: 'Sales',
      points: [suppressedPoint('s1', 1)],
    }, { minimumGroupSize: 0 })

    const model = buildClimateTrendMap(payload, payload.groups[0], formatDate)!

    expect(model.threshold).toBeGreaterThanOrEqual(1)
    expect(model.rows[0].responses).toBeLessThan(model.threshold)
  })

  /**
   * A dimension the earlier wave never asked about cannot be a gap, because `scores` is
   * dense. It is dropped and named, so the page can say so rather than quietly drawing a
   * narrower grid.
   */
  it('drops a dimension no wave scored in common, and names it', () => {
    const payload = payloadOf(
      [survey('s1', ISO_JAN), survey('s2', ISO_JUN)],
      ['trust', 'wellbeing'],
      {
        key: '__company__',
        label: null,
        points: [point('s1', [3.0, null]), point('s2', [3.5, 4.5])],
      },
    )

    const model = buildClimateTrendMap(payload, payload.groups[0], formatDate)!

    expect(model.dimensions.map((d) => d.key)).toEqual(['trust'])
    expect(model.omittedDimensions).toEqual(['wellbeing'])
    expect(model.rows.map((row) => row.scores)).toEqual([[3.0], [3.5]])
  })

  /**
   * A suppressed wave has all-null scores, and must not therefore veto every column — the
   * completeness test is over DISCLOSED waves only. Getting this wrong empties the grid
   * for any company with one small wave, which is most of them.
   */
  it('does not let a withheld wave delete every column', () => {
    const payload = payloadOf(
      [survey('s1', ISO_JAN), survey('s2', ISO_JUN)],
      ['trust'],
      {
        key: 'sales',
        label: 'Sales',
        points: [suppressedPoint('s1', 1), point('s2', [4.0])],
      },
    )

    const model = buildClimateTrendMap(payload, payload.groups[0], formatDate)!

    expect(model.dimensions.map((d) => d.key)).toEqual(['trust'])
    expect(model.omittedDimensions).toEqual([])
  })

  it('is the mean of the visible cells that the colours are relative to', () => {
    const payload = payloadOf(
      [survey('s1', ISO_JAN), survey('s2', ISO_JUN)],
      ['trust'],
      {
        key: '__company__',
        label: null,
        points: [point('s1', [3.0]), point('s2', [4.0])],
      },
    )

    const model = buildClimateTrendMap(payload, payload.groups[0], formatDate)!

    expect(model.target).toBe(3.5)
    expect(model.extremeAt).toBeCloseTo(0.5)
    expect(model.deadBandAt).toBeCloseTo(0.1)
  })

  /**
   * Every wave withheld means no cell to average. `target: null` is what tells
   * `ClimateMap` there is nothing to colour against, and the rows still render protected.
   */
  it('has no target when every wave is withheld', () => {
    const payload = payloadOf(
      [survey('s1', ISO_JAN), survey('s2', ISO_JUN)],
      ['trust'],
      {
        key: 'sales',
        label: 'Sales',
        points: [suppressedPoint('s1', 1), suppressedPoint('s2', 1)],
      },
    )

    const model = buildClimateTrendMap(payload, payload.groups[0], formatDate)!

    expect(model.target).toBeNull()
    expect(model.rows).toHaveLength(2)
    expect(model.rows.every((row) => row.responses < model.threshold)).toBe(true)
  })

  /**
   * A series shorter than the survey list would shift every reading one column left and
   * print one wave's number under another wave's heading. The server pads to prevent it;
   * this refuses to draw rather than trust that.
   */
  it('refuses to draw a series that does not line up with the surveys', () => {
    const payload = payloadOf(
      [survey('s1', ISO_JAN), survey('s2', ISO_JUN)],
      ['trust'],
      { key: '__company__', label: null, points: [point('s1', [3.0])] },
    )

    expect(buildClimateTrendMap(payload, payload.groups[0], formatDate)).toBeNull()
  })

  it('draws nothing when there is no survey or no dimension', () => {
    const noSurveys = payloadOf([], ['trust'], { key: 'x', label: null, points: [] })
    expect(buildClimateTrendMap(noSurveys, noSurveys.groups[0], formatDate)).toBeNull()

    const noDimensions = payloadOf([survey('s1', ISO_JAN)], [], {
      key: 'x',
      label: null,
      points: [point('s1', [])],
    })
    expect(buildClimateTrendMap(noDimensions, noDimensions.groups[0], formatDate)).toBeNull()
  })
})

describe('trendRowLabel', () => {
  it('uses the title when there is one', () => {
    expect(trendRowLabel(survey('s1', ISO_JAN, 'Q1 Pulse'), formatDate)).toBe('Q1 Pulse')
  })

  /**
   * Four surveys in the local stack have null titles today. A blank row heading reads as a
   * rendering fault; the close date is the honest fallback and the row is what it dates.
   */
  it('falls back to the close date rather than leaving the row blank', () => {
    expect(trendRowLabel(survey('s1', ISO_JAN, null), formatDate)).toBe('2026-01')
    expect(trendRowLabel(survey('s1', ISO_JAN, '   '), formatDate)).toBe('2026-01')
  })
})
