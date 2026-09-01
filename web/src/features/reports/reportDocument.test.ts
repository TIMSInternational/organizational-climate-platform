import { describe, it, expect } from 'vitest'
import { parseReportDocument } from './reportDocument'

/** One question's results as the section carries them — `SurveyQuestionResult`, verbatim. */
function question(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    questionId: '99999999-9999-9999-9999-999999999999',
    order: 0,
    type: 'likert',
    text: '¿Qué tanto apoyo sientes de tu jefatura?',
    category: 'leadership',
    answeredCount: 7,
    distribution: [
      { value: '1', label: 'Nunca', count: 2, percentage: 28.57, averageRank: null },
      { value: '4', label: 'Casi siempre', count: 5, percentage: 71.43, averageRank: null },
    ],
    average: 3.14,
    median: 4,
    scaleMin: 1,
    scaleMax: 5,
    scaleLabelMin: 'Nunca',
    scaleLabelMax: 'Siempre',
    words: [],
    suppressedWordCount: 0,
    ...overrides,
  }
}

/** A section as `ReportGeneration` writes one, with every field the server sends. */
function section(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    surveyId: '44444444-4444-4444-4444-444444444444',
    title: 'Encuesta de clima Q3',
    status: 'closed',
    resolvedLocale: 'es',
    questions: [question()],
    demographics: [
      {
        dimension: 'tenure',
        segments: [
          {
            key: '2-5',
            label: '2-5 años',
            respondentCount: 5,
            isSuppressed: false,
            dimensions: [{ dimension: 'leadership', averageScore: 4 }],
          },
        ],
        suppressedSegmentCount: 0,
        suppressedRespondentCount: 0,
        unsegmentedRespondentCount: 0,
      },
    ],
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

/** One benchmark as the document carries it — `ReportBenchmarkComparison`. */
function benchmark(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    benchmarkId: '88888888-8888-8888-8888-888888888888',
    name: '2026 Engagement',
    category: 'engagement',
    type: 'industry',
    companyId: '11111111-1111-1111-1111-111111111111',
    priorPeriodStatus: 'linked',
    metrics: [
      {
        id: 'm1',
        metricName: 'engagement',
        value: 74,
        unit: 'percent',
        percentile: null,
        sampleSize: null,
      },
    ],
    priorPeriod: {
      id: '99999999-0000-0000-0000-000000000000',
      name: '2025 Engagement',
      metrics: [
        {
          metricName: 'engagement',
          value: 74,
          unit: 'percent',
          priorValue: 70,
          priorUnit: 'percent',
          delta: 4,
          changeRatio: 4 / 70,
        },
      ],
    },
    ...overrides,
  }
}

function documentJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    generationNote: '',
    surveys: [section()],
    aiInsights: [],
    benchmarks: [benchmark()],
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

  it('carries a question’s distribution and its resolved locale across', () => {
    const parsed = parseReportDocument(documentJson())
    const [first] = parsed?.surveys ?? []

    expect(first.resolvedLocale).toBe('es')
    const [only] = first.questions
    expect(only.text).toBe('¿Qué tanto apoyo sientes de tu jefatura?')
    expect(only.answeredCount).toBe(7)
    expect(only.distribution.map((bucket) => [bucket.value, bucket.count])).toEqual([
      ['1', 2],
      ['4', 5],
    ])
    expect(only.scaleMax).toBe(5)
  })

  /**
   * THE open-text rule, at the layer that can enforce it.
   *
   * The server tokenises on whitespace and sentence punctuation, so a legitimate cloud
   * entry is a single token and nothing else. An entry carrying a phrase did not come
   * from that tokeniser — a generator regression, a hand-edited `report_output`, a
   * document from somewhere this client did not expect — and it is exactly the value a
   * renderer must never print, because a phrase from one open answer names the person
   * who wrote it to a colleague who recognises the phrasing. That is the guarantee
   * "Voices" was closed on.
   *
   * Dropped rather than trimmed, and **counted onto `suppressedWordCount`**: a list that
   * silently shortened itself tells the reader they are seeing everything that was said.
   */
  it('drops a word-cloud entry that is a phrase, and counts it as withheld', () => {
    const parsed = parseReportDocument(
      documentJson({
        surveys: [
          section({
            questions: [
              question({
                type: 'open_ended',
                distribution: [],
                words: [
                  { language: 'es', word: 'carga', count: 9, responseCount: 6 },
                  // Not a word. Every way a sentence could arrive: spaces, and the
                  // punctuation the tokeniser also splits on.
                  { language: 'es', word: 'el trámite de la visa es estresante', count: 1, responseCount: 1 },
                  { language: 'es', word: 'renovación,visa', count: 1, responseCount: 1 },
                  { language: 'en', word: 'workload', count: 4, responseCount: 3 },
                ],
                suppressedWordCount: 5,
              }),
            ],
          }),
        ],
      }),
    )

    const [only] = parsed?.surveys[0].questions ?? []
    expect(only.words.map((word) => word.word)).toEqual(['carga', 'workload'])
    // 5 the server withheld, plus the 2 this parser refused to pass on.
    expect(only.suppressedWordCount).toBe(7)
  })

  it('keeps a real word cloud whole — word, language and both counts', () => {
    const parsed = parseReportDocument(
      documentJson({
        surveys: [
          section({
            questions: [
              question({
                words: [{ language: 'es', word: 'carga', count: 9, responseCount: 6 }],
                suppressedWordCount: 3,
              }),
            ],
          }),
        ],
      }),
    )

    expect(parsed?.surveys[0].questions[0].words).toEqual([
      { language: 'es', word: 'carga', count: 9, responseCount: 6 },
    ])
    expect(parsed?.surveys[0].questions[0].suppressedWordCount).toBe(3)
  })

  /**
   * The same safe default the section and the department rows take, one level down. A
   * demographic group whose flag did not survive serialisation is read as withheld, so
   * a malformed document cannot publish a group's size or its scores.
   */
  it('treats a demographic group with no suppression flag as suppressed', () => {
    const parsed = parseReportDocument(
      documentJson({
        surveys: [
          section({
            demographics: [
              {
                dimension: 'tenure',
                segments: [
                  {
                    key: '0-1',
                    label: 'Menos de un año',
                    respondentCount: 2,
                    dimensions: [{ dimension: 'leadership', averageScore: 1 }],
                  },
                ],
                suppressedSegmentCount: 1,
                suppressedRespondentCount: 2,
                unsegmentedRespondentCount: 0,
              },
            ],
          }),
        ],
      }),
    )

    const [group] = parsed?.surveys[0].demographics[0].segments ?? []
    expect(group.isSuppressed).toBe(true)
    expect(group.respondentCount).toBe(0)
    expect(group.dimensions).toEqual([])
    // The name stays: a withheld group is still a row.
    expect(group.label).toBe('Menos de un año')
  })

  it('zeroes a suppressed demographic group that still carries a count and a score', () => {
    const parsed = parseReportDocument(
      documentJson({
        surveys: [
          section({
            demographics: [
              {
                dimension: 'tenure',
                segments: [
                  {
                    key: '0-1',
                    label: 'Menos de un año',
                    respondentCount: 2,
                    isSuppressed: true,
                    dimensions: [{ dimension: 'leadership', averageScore: 1 }],
                  },
                ],
                suppressedSegmentCount: 1,
                suppressedRespondentCount: 2,
                unsegmentedRespondentCount: 0,
              },
            ],
          }),
        ],
      }),
    )

    const [group] = parsed?.surveys[0].demographics[0].segments ?? []
    expect(group.respondentCount).toBe(0)
    expect(group.dimensions).toEqual([])
  })

  /**
   * `ReportSurveySection` says Questions, Dimensions and Demographics are all empty when
   * the survey is below the floor. The parser makes that a property of the document a
   * renderer receives rather than a promise it has to trust — and a suppressed section
   * is the case where those three lists ARE the withheld data.
   */
  it('drops the questions and demographics of a suppressed section', () => {
    const parsed = parseReportDocument(
      documentJson({
        surveys: [
          section({
            isSuppressed: true,
            suppressionReason: 'below_minimum_respondents',
            // A malformed document that kept them. The server empties them; this proves
            // the client does not depend on that.
            questions: [question()],
          }),
        ],
      }),
    )

    expect(parsed?.surveys[0].questions).toEqual([])
    expect(parsed?.surveys[0].demographics).toEqual([])
    expect(parsed?.surveys[0].dimensions).toEqual([])
    // Participation still survives — a count identifies nobody.
    expect(parsed?.surveys[0].participation.completedCount).toBe(175)
  })

  it('carries a benchmark and its year-over-year reading across', () => {
    const parsed = parseReportDocument(documentJson())
    const [only] = parsed?.benchmarks ?? []

    expect(only.name).toBe('2026 Engagement')
    expect(only.priorPeriodStatus).toBe('linked')
    expect(only.metrics[0].value).toBe(74)
    expect(only.priorPeriod?.name).toBe('2025 Engagement')
    expect(only.priorPeriod?.metrics[0].delta).toBe(4)
    expect(only.priorPeriod?.metrics[0].changeRatio).toBeCloseTo(4 / 70, 10)
  })

  /**
   * A global benchmark — the rows every tenant compares against — carries a null
   * `companyId`, and the three no-prior-period cases are told apart by
   * `priorPeriodStatus` alone. A parser that defaulted the status to a string of its own
   * would make a renderer state a reason the server never gave.
   */
  it('keeps a global benchmark’s null company and its prior-period status', () => {
    const parsed = parseReportDocument(
      documentJson({
        benchmarks: [
          benchmark({ companyId: null, priorPeriodStatus: 'none', priorPeriod: null }),
        ],
      }),
    )

    expect(parsed?.benchmarks[0].companyId).toBeNull()
    expect(parsed?.benchmarks[0].priorPeriodStatus).toBe('none')
    expect(parsed?.benchmarks[0].priorPeriod).toBeNull()
  })

  /**
   * The change is the server's, or it is absent. `BuildChanges` withholds the delta when
   * the two periods recorded the metric in different units — 1.2 seconds against 1200
   * milliseconds is the same reading twice — and a parser that filled the gap by
   * subtracting the two values beside it would print exactly the confidently wrong
   * number #89 exists to avoid.
   */
  it('leaves a withheld delta withheld rather than differencing the two values', () => {
    const parsed = parseReportDocument(
      documentJson({
        benchmarks: [
          benchmark({
            priorPeriod: {
              id: 'p1',
              name: '2025 Latency',
              metrics: [
                {
                  metricName: 'latency',
                  value: 1.2,
                  unit: 's',
                  priorValue: 1200,
                  priorUnit: 'ms',
                  delta: null,
                  changeRatio: null,
                },
              ],
            },
          }),
        ],
      }),
    )

    const [change] = parsed?.benchmarks[0].priorPeriod?.metrics ?? []
    expect(change.delta).toBeNull()
    expect(change.changeRatio).toBeNull()
    // Both units survive, because the renderer owes the reader a reason.
    expect(change.unit).toBe('s')
    expect(change.priorUnit).toBe('ms')
  })

  it('renders a document with no benchmarks rather than throwing on a missing array', () => {
    const parsed = parseReportDocument(JSON.stringify({ surveys: [] }))

    expect(parsed?.benchmarks).toEqual([])
  })
})
