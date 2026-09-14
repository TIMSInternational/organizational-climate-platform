import { describe, it, expect } from 'vitest'
import { ANONYMITY_FLOOR } from '../../../../components/charts'
import { parseReportDocument } from '../../reportDocument'
import type {
  ReportDemographicBreakdown,
  ReportSurveySection,
} from '../../reportDocument'
import {
  CLIMATE_TARGET,
  dimensionRowsOf,
  groupCountOf,
  groupRowsOf,
  hasOpenTextOf,
  mapOf,
  onScale,
  participationOf,
  sectionOf,
  viewOf,
} from './derive'

/**
 * The refusals this module owes the most exposed page in the product, each tested against
 * a payload that is trying to defeat it.
 *
 * Every fixture below is **hostile on purpose**: a suppressed group that still carries its
 * scores and its headcount, a survey below the floor that still carries its dimensions and
 * its questions, a document whose floor is missing. None of those shapes reaches a browser
 * today — `SurveyAggregation.cs:604`/`:677` zero and empty a sub-floor group before
 * anything is stored, `PublicReportProjection` withholds the sub-floor headcount from the
 * wire, and `reportDocument.ts` zeroes and empties again at the parser. That is exactly
 * why they are worth testing here: this module is the last layer, and a test that only
 * fed it well-formed input would prove that the three layers above it work, not that this
 * one does.
 */

/** A minimal section, well-formed, that each test bends in one direction. */
function section(overrides: Partial<ReportSurveySection> = {}): ReportSurveySection {
  return {
    surveyId: 's1',
    title: 'Encuesta de clima Q3',
    status: 'closed',
    resolvedLocale: 'es',
    participation: {
      invitedCount: 248,
      responseCount: 187,
      completedCount: 175,
      partialCount: 12,
      participationRate: 70.6,
      completionRate: 93.58,
      averageCompletionSeconds: 486,
      firstResponseAt: null,
      lastResponseAt: null,
      byLanguage: [],
    },
    questions: [],
    dimensions: [
      { dimension: 'psychological_safety', questionCount: 4, answeredCount: 170, averageScore: 3.9 },
    ],
    departments: [],
    suppressedDepartmentCount: 0,
    unsegmentedRespondentCount: 0,
    demographics: [],
    isSuppressed: false,
    suppressionReason: null,
    minimumGroupSize: 5,
    ...overrides,
  }
}

/**
 * A breakdown whose withheld group is **lying**: it says it is suppressed and still
 * carries a headcount and a full row of scores.
 *
 * This is the shape a generator regression or a hand-edited `report_output` column
 * produces, and it is the one a renderer must not pass on.
 */
function hostileBreakdown(): ReportDemographicBreakdown {
  return {
    dimension: 'antigüedad',
    segments: [
      {
        key: '2-5',
        label: 'Entre uno y cinco años',
        respondentCount: 88,
        isSuppressed: false,
        dimensions: [
          { dimension: 'psychological_safety', averageScore: 4.02 },
          { dimension: 'workload', averageScore: 3.05 },
        ],
      },
      {
        key: '10+',
        label: 'Más de diez años',
        // Both of these are the figures the floor exists to hide.
        respondentCount: 3,
        isSuppressed: true,
        dimensions: [
          { dimension: 'psychological_safety', averageScore: 2.1 },
          { dimension: 'workload', averageScore: 1.4 },
        ],
      },
    ],
    suppressedSegmentCount: 1,
    unsegmentedRespondentCount: 20,
  }
}

describe('shared report derive — the floor', () => {
  it('gives a withheld group a null in every cell, even when the payload carries its scores', () => {
    const breakdown = hostileBreakdown()
    const columns = ['psychological_safety', 'workload']

    const rows = groupRowsOf(breakdown, columns)
    const withheld = rows.find((row) => row.id === '10+')

    expect(withheld?.protected).toBe(true)
    expect(withheld?.scores).toEqual([null, null])
    // And the row carries no headcount field at all for a later edit to reach for.
    expect(Object.keys(withheld ?? {})).toEqual(['id', 'name', 'protected', 'scores'])
    // The disclosed row is untouched: this is a refusal, not a blanket.
    expect(rows.find((row) => row.id === '2-5')?.scores).toEqual([4.02, 3.05])
  })

  it('builds the columns from the disclosed groups only', () => {
    const breakdown: ReportDemographicBreakdown = {
      ...hostileBreakdown(),
      segments: [
        {
          key: '2-5',
          label: 'Entre uno y cinco años',
          respondentCount: 88,
          isSuppressed: false,
          dimensions: [{ dimension: 'psychological_safety', averageScore: 4.02 }],
        },
        {
          key: '10+',
          label: 'Más de diez años',
          respondentCount: 3,
          isSuppressed: true,
          // A dimension NO disclosed group has. A header built from every row would
          // publish the existence of a measurement only the withheld group has.
          dimensions: [{ dimension: 'compensation', averageScore: 1.9 }],
        },
      ],
    }

    expect(mapOf(breakdown)?.columns).toEqual(['psychological_safety'])
  })

  it('draws no map at all when no disclosed group carries a score', () => {
    const breakdown: ReportDemographicBreakdown = {
      ...hostileBreakdown(),
      segments: [
        {
          key: '10+',
          label: 'Más de diez años',
          respondentCount: 3,
          isSuppressed: true,
          dimensions: [{ dimension: 'psychological_safety', averageScore: 2.1 }],
        },
      ],
    }

    // An empty grid of hatches states nothing the sentence under it does not, and the
    // one thing it could state is which dimension the withheld group was measured on.
    expect(mapOf(breakdown)).toBeNull()
  })

  it('counts groups and names the withheld ones, and carries no headcount for them', () => {
    const counted = groupCountOf(
      section({
        departments: [
          { departmentId: 'd1', name: 'Operaciones', respondentCount: 62, participationRate: 84.9, isSuppressed: false },
          { departmentId: 'd2', name: 'Dirección General', respondentCount: 0, participationRate: null, isSuppressed: true },
        ],
        demographics: [hostileBreakdown()],
      }),
    )

    expect(counted).toEqual({
      readable: 2,
      total: 4,
      withheldNames: ['Dirección General', 'Más de diez años'],
    })
    // The hostile breakdown's withheld group claims 3 respondents. Nothing counted it.
    expect(JSON.stringify(counted)).not.toContain('3')
  })

  it('reports no participation rate rather than a zero when there was no invitation list', () => {
    const noList = participationOf(
      section({
        participation: { ...section().participation, invitedCount: null, participationRate: null },
      }),
    )

    expect(noList).toEqual({ kind: 'not-computed' })
    // The classic leak: an absent denominator printed as 0, which reads "nobody answered".
    expect(JSON.stringify(noList)).not.toContain('0')
  })

  it('refuses a rate whose denominator did not arrive with it', () => {
    // A rate with no invited count is a number the reader cannot check, and the
    // aggregation publishes neither half without the other.
    expect(
      participationOf(
        section({ participation: { ...section().participation, invitedCount: null } }),
      ),
    ).toEqual({ kind: 'not-computed' })
  })

  it('empties a suppressed survey, whatever the payload still carries', () => {
    const suppressed = sectionOf(
      section({
        isSuppressed: true,
        suppressionReason: 'below_minimum_respondents',
        // All three of these are the withheld data itself.
        dimensions: [
          { dimension: 'psychological_safety', questionCount: 4, answeredCount: 4, averageScore: 2.2 },
        ],
        demographics: [hostileBreakdown()],
        questions: [
          {
            questionId: 'q1',
            order: 0,
            type: 'open_ended',
            text: '¿Algo más?',
            category: 'open',
            answeredCount: 4,
            distribution: [],
            average: null,
            median: null,
            scaleMin: null,
            scaleMax: null,
            scaleLabelMin: null,
            scaleLabelMax: null,
            words: [{ language: 'es', word: 'renuncia', count: 3, responseCount: 3 }],
            suppressedWordCount: 0,
          },
        ],
      }),
    )

    expect(suppressed.dimensions).toEqual([])
    expect(suppressed.maps).toEqual([])
    expect(suppressed.questions).toEqual([])
    expect(suppressed.hasOpenText).toBe(false)
    // The counters survive: "a count of responses identifies nobody" is the server's own
    // rule, and they are what tells a reader the section is a real survey being withheld.
    expect(suppressed.responses).toBe(187)
  })

  /**
   * The hole this test closed.
   *
   * The first cut of `sectionOf` emptied a suppressed section's dimensions, maps and
   * questions — and passed its **department rows** through untouched, because the
   * server's own rule says participation counters survive below the floor ("a count of
   * responses identifies nobody"). That rule is about the WHOLE SURVEY's counters. A
   * department inside a survey with four complete responses holds at most four people,
   * which is under the segment floor as well, and the aggregation accordingly produces no
   * breakdowns at all for such a survey. So the rows can only ever arrive from a
   * hand-edited column or an older generator — exactly the document this page must refuse.
   */
  it('drops a suppressed survey’s department rows, counters and all', () => {
    const suppressed = sectionOf(
      section({
        isSuppressed: true,
        suppressionReason: 'below_minimum_respondents',
        departments: [
          { departmentId: 'd1', name: 'Operaciones', respondentCount: 4, participationRate: 66.7, isSuppressed: false },
        ],
        suppressedDepartmentCount: 2,
      }),
    )

    expect(suppressed.departments).toEqual([])
    expect(suppressed.withheldDepartments).toBe(0)
    // And nothing counts them as readable groups either: a survey whose per-question
    // results are withheld in full has no readable group by definition.
    expect(suppressed.groups).toEqual({ readable: 0, total: 0, withheldNames: [] })
  })

  it('reads the platform floor when the document carries none', () => {
    // `minimumGroupSize` defaults to 0 at the parser for a document that has no such
    // field. Printing "umbral de 0 aplicado" on this page would advertise that nothing
    // was withheld.
    expect(sectionOf(section({ minimumGroupSize: 0 })).floor).toBe(ANONYMITY_FLOOR)
    expect(sectionOf(section({ minimumGroupSize: 10 })).floor).toBe(10)
  })
})

describe('shared report derive — the scale', () => {
  it('judges a 1-to-5 reading against the target and leaves an off-scale one unjudged', () => {
    const rows = dimensionRowsOf(
      section({
        dimensions: [
          { dimension: 'workload', questionCount: 3, answeredCount: 168, averageScore: 3.1 },
          // eNPS is recorded 0 to 10. `CLIMATE_TARGET` is 3,7 OF 5.
          { dimension: 'enps', questionCount: 1, answeredCount: 172, averageScore: 7.8 },
        ],
      }),
    )

    expect(rows[0]).toMatchObject({ average: 3.1, band: 'below', offScale: false })
    expect(rows[1]).toMatchObject({ average: 7.8, band: null, offScale: true })
    expect(onScale(CLIMATE_TARGET)).toBe(true)
    expect(onScale(7.8)).toBe(false)
  })

  it('carries a missing average across as missing, never as a zero', () => {
    const rows = dimensionRowsOf(
      section({
        dimensions: [
          { dimension: 'workload', questionCount: 3, answeredCount: 0, averageScore: null },
        ],
      }),
    )

    expect(rows[0].average).toBeNull()
    expect(rows[0].band).toBeNull()
    expect(rows[0].offScale).toBe(false)
  })
})

describe('shared report derive — open text', () => {
  it('answers only whether a frequency map exists, never what is in it', () => {
    const withWords = section({
      questions: [
        {
          questionId: 'q1',
          order: 0,
          type: 'open_ended',
          text: '¿Qué cambiarías?',
          category: 'open',
          answeredCount: 96,
          distribution: [],
          average: null,
          median: null,
          scaleMin: null,
          scaleMax: null,
          scaleLabelMin: null,
          scaleLabelMax: null,
          words: [{ language: 'es', word: 'turnos', count: 41, responseCount: 29 }],
          suppressedWordCount: 118,
        },
      ],
    })

    expect(hasOpenTextOf(withWords)).toBe(true)
    // A question whose whole cloud was withheld still counts: the reader is entitled to
    // know the report HAS an open-text section before being told it is empty.
    expect(
      hasOpenTextOf(
        section({
          questions: [{ ...withWords.questions[0], words: [], suppressedWordCount: 7 }],
        }),
      ),
    ).toBe(true)
    expect(
      hasOpenTextOf(
        section({
          questions: [{ ...withWords.questions[0], words: [], suppressedWordCount: 0 }],
        }),
      ),
    ).toBe(false)
  })
})

describe('shared report derive — the whole chain', () => {
  /**
   * The parser and this module together, from the wire shape the endpoint actually
   * returns: `reports.report_output` is a TEXT column holding JSON, handed back as a
   * string. A fixture that nested the object would exercise a shape this API does not
   * have.
   */
  it('publishes no sub-floor figure from a document that carries them', () => {
    const raw = JSON.stringify({
      generationNote: '',
      surveys: [
        {
          ...section({ demographics: [hostileBreakdown()] }),
          departments: [
            {
              departmentId: 'd2',
              name: 'Dirección General',
              // The hidden headcount and the rate that divides it.
              respondentCount: 3,
              participationRate: 60,
              isSuppressed: true,
            },
          ],
          suppressedDepartmentCount: 1,
        },
      ],
      aiInsights: [],
      benchmarks: [],
    })

    const view = viewOf(parseReportDocument(raw)!, '2026-08-01T10:00:00Z')
    const flattened = JSON.stringify(view)

    // 3 is the withheld headcount in both the department and the demographic group;
    // 60 is the rate that recovers it; 2.1 and 1.4 are the withheld group's scores.
    expect(flattened).not.toContain('2.1')
    expect(flattened).not.toContain('1.4')
    expect(flattened).not.toContain('60')
    expect(view.sections[0].departments[0].respondentCount).toBe(0)
    expect(view.sections[0].departments[0].participationRate).toBeNull()
    expect(view.sections[0].maps[0].rows[1].scores).toEqual([null, null])
  })
})
