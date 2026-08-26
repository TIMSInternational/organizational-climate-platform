import { describe, it, expect } from 'vitest'
import { parseReportDocument } from './reportDocument'

/** A section as `ReportGeneration` writes one, with every field the server sends. */
function section(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    surveyId: '44444444-4444-4444-4444-444444444444',
    title: 'Encuesta de clima Q3',
    status: 'closed',
    participation: {
      invitedCount: 248,
      responseCount: 187,
      completedCount: 175,
      partialCount: 12,
      participationRate: 70.6,
      completionRate: 93.58,
      averageCompletionSeconds: 486,
      firstResponseAt: '2026-07-06T08:12:00Z',
      lastResponseAt: '2026-07-24T18:40:00Z',
      byLanguage: [{ language: 'es', count: 118 }],
    },
    dimensions: [
      { dimension: 'psychological_safety', questionCount: 4, answeredCount: 170, averageScore: 3.9 },
    ],
    departments: [
      {
        departmentId: 'd1',
        name: 'Operaciones',
        respondentCount: 42,
        participationRate: 84,
        isSuppressed: false,
      },
    ],
    suppressedDepartmentCount: 0,
    suppressedRespondentCount: 0,
    unsegmentedRespondentCount: 3,
    isSuppressed: false,
    suppressionReason: null,
    minimumGroupSize: 5,
    ...overrides,
  }
}

function documentJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    generationNote: '',
    surveys: [section()],
    aiInsights: [],
    ...overrides,
  })
}

describe('parseReportDocument', () => {
  it('carries a well-formed document across field for field', () => {
    const parsed = parseReportDocument(documentJson())

    expect(parsed?.surveys).toHaveLength(1)
    const [first] = parsed?.surveys ?? []
    expect(first.title).toBe('Encuesta de clima Q3')
    expect(first.participation.completedCount).toBe(175)
    expect(first.participation.participationRate).toBe(70.6)
    expect(first.dimensions[0]).toEqual({
      dimension: 'psychological_safety',
      questionCount: 4,
      answeredCount: 170,
      averageScore: 3.9,
    })
    expect(first.departments[0].respondentCount).toBe(42)
    expect(first.minimumGroupSize).toBe(5)
  })

  it('returns null for the shapes the column can actually hold', () => {
    expect(parseReportDocument(null)).toBeNull()
    expect(parseReportDocument(undefined)).toBeNull()
    expect(parseReportDocument('')).toBeNull()
    expect(parseReportDocument('   ')).toBeNull()
    expect(parseReportDocument('not json at all')).toBeNull()
    // The pre-#88 placeholder: valid JSON, and not a document.
    expect(parseReportDocument('"Report generation is stubbed"')).toBeNull()
    expect(parseReportDocument('[1,2,3]')).toBeNull()
  })

  it('renders a document with no surveys rather than throwing on a missing array', () => {
    const parsed = parseReportDocument(JSON.stringify({ generationNote: 'partial' }))

    expect(parsed).not.toBeNull()
    expect(parsed?.surveys).toEqual([])
    expect(parsed?.aiInsights).toEqual([])
    expect(parsed?.generationNote).toBe('partial')
  })

  /**
   * The safe default. A section whose `isSuppressed` did not survive serialisation must
   * be read as suppressed, not as public: the alternative publishes scores the server may
   * have withheld, which is the one failure this document shape exists to prevent.
   */
  it('treats a section with no suppression flag as suppressed, and drops its scores', () => {
    const raw = section()
    delete raw.isSuppressed
    const parsed = parseReportDocument(documentJson({ surveys: [raw] }))

    expect(parsed?.surveys[0].isSuppressed).toBe(true)
    expect(parsed?.surveys[0].dimensions).toEqual([])
    // Participation survives: the server's own rule is that a count identifies nobody.
    expect(parsed?.surveys[0].participation.completedCount).toBe(175)
  })

  it('drops the scores of a section the server marked suppressed', () => {
    const parsed = parseReportDocument(
      documentJson({ surveys: [section({ isSuppressed: true, suppressionReason: 'below_minimum_respondents' })] }),
    )

    expect(parsed?.surveys[0].dimensions).toEqual([])
    expect(parsed?.surveys[0].suppressionReason).toBe('below_minimum_respondents')
  })

  /**
   * A department row that arrives suppressed AND carrying a headcount is a server bug or
   * a hand-edited column, and it is exactly the row a client must not pass on. The count
   * is zeroed and the rate nulled here as well as there.
   */
  it('zeroes a suppressed department that still carries a headcount', () => {
    const parsed = parseReportDocument(
      documentJson({
        surveys: [
          section({
            departments: [
              {
                departmentId: 'd2',
                name: 'Dirección',
                respondentCount: 3,
                participationRate: 60,
                isSuppressed: true,
              },
            ],
          }),
        ],
      }),
    )

    const [department] = parsed?.surveys[0].departments ?? []
    expect(department.isSuppressed).toBe(true)
    expect(department.respondentCount).toBe(0)
    expect(department.participationRate).toBeNull()
    // The name stays: a withheld group is still shown as a row, so the reader is not
    // invited to work out which department disappeared.
    expect(department.name).toBe('Dirección')
  })

  it('treats a department row with no flag as suppressed', () => {
    const parsed = parseReportDocument(
      documentJson({
        surveys: [section({ departments: [{ departmentId: 'd3', respondentCount: 9 }] })],
      }),
    )

    expect(parsed?.surveys[0].departments[0].isSuppressed).toBe(true)
    expect(parsed?.surveys[0].departments[0].respondentCount).toBe(0)
  })

  it('rejects non-finite numbers rather than printing NaN as a count', () => {
    const parsed = parseReportDocument(
      JSON.stringify({
        surveys: [
          section({
            participation: { responseCount: 'lots', completedCount: null, invitedCount: 'many' },
            dimensions: [{ dimension: 'workload', averageScore: 'high' }],
          }),
        ],
      }),
    )

    expect(parsed?.surveys[0].participation.responseCount).toBe(0)
    expect(parsed?.surveys[0].participation.completedCount).toBe(0)
    expect(parsed?.surveys[0].participation.invitedCount).toBeNull()
    expect(parsed?.surveys[0].dimensions[0].averageScore).toBeNull()
  })

  it('keeps an insight whole, including the 0-100 confidence #152 was about', () => {
    const parsed = parseReportDocument(
      documentJson({
        aiInsights: [
          {
            id: 'i1',
            type: 'risk',
            category: 'workload',
            title: 'Carga de trabajo en Operaciones',
            description: 'La carga percibida subió dos puntos.',
            confidenceScore: 87,
            priority: 'high',
            affectedSegments: ['Operaciones'],
            recommendedActions: ['Revisar la distribución de turnos'],
            isAcknowledged: false,
          },
        ],
      }),
    )

    expect(parsed?.aiInsights[0].confidenceScore).toBe(87)
    expect(parsed?.aiInsights[0].recommendedActions).toEqual(['Revisar la distribución de turnos'])
    expect(parsed?.aiInsights[0].isAcknowledged).toBe(false)
  })
})
