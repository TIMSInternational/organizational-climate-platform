import { describe, it, expect } from 'vitest'
import type { SurveyBreakdown, SurveyQuestionResult } from './api/surveyResults'
import { buildBreakdownCsv, buildQuestionResultsCsv, resultsFileName, type CsvLabels } from './surveyResultsCsv'

const labels: CsvLabels = {
  questionOrder: 'Question number',
  questionText: 'Question',
  questionType: 'Question type',
  optionValue: 'Option value',
  optionLabel: 'Option',
  count: 'Responses',
  percentage: 'Percentage',
  average: 'Average',
  dimension: 'Breakdown',
  segment: 'Group',
  respondents: 'Respondents',
  participationRate: 'Participation',
  withheld: 'Withheld',
  notApplicable: 'n/a',
  unsegmented: 'Not recorded',
}

function question(overrides: Partial<SurveyQuestionResult> = {}): SurveyQuestionResult {
  return {
    questionId: 'q1',
    order: 1,
    type: 'likert',
    text: 'I feel safe',
    category: null,
    answeredCount: 3,
    distribution: [],
    average: null,
    median: null,
    scaleMin: null,
    scaleMax: null,
    scaleLabelMin: null,
    scaleLabelMax: null,
    words: [],
    suppressedWordCount: 0,
    ...overrides,
  }
}

function rowsOf(csv: string): string[] {
  return csv.split('\r\n')
}

describe('buildQuestionResultsCsv', () => {
  it('writes one row per bucket, with the stable value beside the label', () => {
    const csv = buildQuestionResultsCsv(
      [
        question({
          average: 3.5,
          distribution: [
            { value: 'agree', label: 'Agree', count: 2, percentage: 66.67, averageRank: null },
            { value: 'disagree', label: 'Disagree', count: 1, percentage: 33.33, averageRank: null },
          ],
        }),
      ],
      labels,
    )

    const rows = rowsOf(csv)
    expect(rows[0]).toBe('Question number,Question,Question type,Option value,Option,Responses,Percentage,Average')
    expect(rows[1]).toBe('1,I feel safe,likert,agree,Agree,2,66.67,3.5')
    expect(rows[2]).toBe('1,I feel safe,likert,disagree,Disagree,1,33.33,3.5')
  })

  it('still emits a row for a question with no distribution, so the export does not lose it', () => {
    const csv = buildQuestionResultsCsv(
      [question({ type: 'open_ended', answeredCount: 7, distribution: [] })],
      labels,
    )

    expect(rowsOf(csv)[1]).toBe('1,I feel safe,open_ended,,,7,,n/a')
  })

  it('quotes and escapes a field containing a comma, a quote or a newline', () => {
    const csv = buildQuestionResultsCsv(
      [
        question({
          text: 'Do you feel "heard", day to day?\nBe honest',
          distribution: [{ value: 'yes', label: 'Yes', count: 1, percentage: 100, averageRank: null }],
        }),
      ],
      labels,
    )

    expect(rowsOf(csv)[1]).toContain('"Do you feel ""heard"", day to day?\nBe honest"')
  })

  it('neutralises a field a spreadsheet would run as a formula', () => {
    // Question text and option labels are authored by users, so `=HYPERLINK(...)`
    // genuinely reaches this code. The leading apostrophe is consumed by Excel and
    // Sheets and shows the literal text.
    const csv = buildQuestionResultsCsv(
      [
        question({
          text: '=HYPERLINK("http://evil.example","click")',
          distribution: [{ value: 'yes', label: '+1', count: 1, percentage: 100, averageRank: null }],
        }),
      ],
      labels,
    )

    expect(rowsOf(csv)[1]).toContain(`"'=HYPERLINK(""http://evil.example"",""click"")"`)
    expect(rowsOf(csv)[1]).toContain(`'+1`)
  })
})

describe('buildBreakdownCsv', () => {
  const breakdown: SurveyBreakdown = {
    dimension: 'department',
    segments: [
      {
        dimension: 'department',
        key: 'd1',
        label: 'Support',
        respondentCount: 8,
        participationRate: 80,
        headcount: 10,
        isSuppressed: false,
        questions: [],
      },
      {
        dimension: 'department',
        key: 'd2',
        label: 'Legal',
        respondentCount: 0,
        participationRate: null,
        headcount: null,
        isSuppressed: true,
        questions: [],
      },
    ],
    suppressedSegmentCount: 1,
    suppressedRespondentCount: 3,
    unsegmentedRespondentCount: 2,
  }

  it('writes a withheld segment as the marker and never as its zero', () => {
    // `respondentCount: 0` on a suppressed segment is the absence of a measurement.
    // A `0` in this column would state that nobody in Legal responded, and an empty
    // cell would let a spreadsheet recover the withheld headcount by subtraction.
    const rows = rowsOf(buildBreakdownCsv([breakdown], labels))

    expect(rows[1]).toBe('department,Support,8,80')
    expect(rows[2]).toBe('department,Legal,Withheld,Withheld')
    expect(rows[2]).not.toContain(',0')
  })

  it('writes the unsegmented remainder as its own row so the column reconciles', () => {
    expect(rowsOf(buildBreakdownCsv([breakdown], labels))[3]).toBe('department,Not recorded,2,n/a')
  })

  it('falls back to the stable segment key when the dimension has no label', () => {
    const rows = rowsOf(
      buildBreakdownCsv(
        [
          {
            dimension: 'tenure',
            segments: [
              {
                dimension: 'tenure',
                key: '3_to_5_years',
                label: null,
                respondentCount: 6,
                participationRate: null,
                headcount: null,
                isSuppressed: false,
                questions: [],
              },
            ],
            suppressedSegmentCount: 0,
            suppressedRespondentCount: 0,
            unsegmentedRespondentCount: 0,
          },
        ],
        labels,
      ),
    )

    expect(rows[1]).toBe('tenure,3_to_5_years,6,n/a')
  })
})

describe('resultsFileName', () => {
  it('names the file after the survey id, not its title', () => {
    expect(
      resultsFileName(
        {
          surveyId: '11111111-2222-3333-4444-555555555555',
        } as Parameters<typeof resultsFileName>[0],
        'questions',
      ),
    ).toBe('survey-11111111-2222-3333-4444-555555555555-questions.csv')
  })
})
