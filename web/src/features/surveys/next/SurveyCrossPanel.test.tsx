import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SurveyCrossPanel from './SurveyCrossPanel'
import { crossFieldsOf, crossKeyOf, labelFor, selectorsOf } from './crossOptions'
import { TranslationProvider } from '../../../i18n'
import * as resultsApi from '../api/surveyResults'
import type { SurveyAnalyticsResponse, SurveyBreakdown, SurveySegmentResult } from '../api/surveyResults'
import en from '../../../i18n/en.json'

vi.mock('../api/surveyResults', async (importOriginal) => ({
  ...(await importOriginal<typeof resultsApi>()),
  getSurveyAnalytics: vi.fn(),
}))

const copy = en.surveyResults.cross

function segment(key: string, label: string | null, count: number, suppressed = false): SurveySegmentResult {
  return {
    dimension: 'x',
    key,
    label,
    respondentCount: suppressed ? 0 : count,
    participationRate: null,
    headcount: null,
    isSuppressed: suppressed,
    questions: [],
  }
}

function breakdown(dimension: string, segments: SurveySegmentResult[]): SurveyBreakdown {
  return { dimension, segments, suppressedSegmentCount: 0, suppressedRespondentCount: 0, unsegmentedRespondentCount: 0 }
}

function payload(overrides: Partial<SurveyAnalyticsResponse> = {}): SurveyAnalyticsResponse {
  return {
    surveyId: 's1',
    title: 'Clima 2026',
    status: 'closed',
    language: 'es',
    resolvedLocale: 'es',
    fallbackFields: [],
    summary: {
      invitedCount: 40,
      responseCount: 30,
      completedCount: 30,
      partialCount: 0,
      participationRate: 75,
      completionRate: 100,
      averageCompletionSeconds: 300,
      firstResponseAt: null,
      lastResponseAt: null,
      byLanguage: [],
    },
    questions: [],
    dimensions: [],
    breakdowns: [
      breakdown('department', [segment('d1', 'Finanzas', 9), segment('d2', 'Ventas', 8)]),
      breakdown('puesto', [segment('gerencia', null, 0, true), segment('operativo', 'Operativo', 17)]),
    ],
    isSuppressed: false,
    suppressionReason: null,
    minimumGroupSize: 5,
    filter: [],
    generatedAt: '2026-10-08T00:00:00Z',
    ...overrides,
  }
}

function renderPanel(given: SurveyAnalyticsResponse | null = payload()) {
  return render(
    <TranslationProvider initialLocale="en">
      <SurveyCrossPanel surveyId="s1" payload={given} baseUrl="http://api.test" />
    </TranslationProvider>,
  )
}

beforeEach(() => vi.mocked(resultsApi.getSurveyAnalytics).mockReset())
afterEach(cleanup)

describe('crossOptions', () => {
  it('offers every value a breakdown already lists, suppressed ones included', () => {
    const fields = crossFieldsOf(payload())
    expect(fields.map((f) => f.field)).toEqual(['department', 'puesto'])
    // A suppressed segment carries no label, so the stable key stands in for it rather
    // than the row vanishing — hiding it would leave the reader guessing what exists.
    expect(fields[1]!.values.map((v) => v.label)).toEqual(['gerencia', 'Operativo'])
  })

  it('leaves out a field that offers no choice', () => {
    const one = payload({ breakdowns: [breakdown('pais', [segment('cr', 'Costa Rica', 30)])] })
    expect(crossFieldsOf(one)).toEqual([])
    expect(crossFieldsOf(null)).toEqual([])
  })

  it('turns the chosen values into selectors in the order the fields were offered', () => {
    const fields = crossFieldsOf(payload())
    const selectors = selectorsOf(fields, { puesto: 'operativo', department: 'd1' })
    expect(selectors).toEqual([
      { field: 'department', value: 'd1' },
      { field: 'puesto', value: 'operativo' },
    ])
    expect(crossKeyOf(selectors)).toBe('department:d1|puesto:operativo')

    // An unchosen field contributes nothing, and neither does one cleared back to blank.
    expect(selectorsOf(fields, { department: '' })).toEqual([])
    expect(labelFor(fields, { field: 'department', value: 'd1' })).toBe('Finanzas')
    expect(labelFor(fields, { field: 'department', value: 'gone' })).toBe('gone')
  })
})

describe('SurveyCrossPanel', () => {
  it('does not render at all when the survey offers nothing to cross', () => {
    renderPanel(null)
    expect(screen.queryByText(copy.title)).toBeNull()
  })

  it('asks the server for the cross and shows the score per category', async () => {
    vi.mocked(resultsApi.getSurveyAnalytics).mockResolvedValue(
      payload({
        filter: [{ field: 'department', value: 'd1' }],
        summary: { ...payload().summary, completedCount: 9, participationRate: null },
        dimensions: [
          { dimension: 'Comunicación', questionCount: 4, answeredCount: 36, averageScore: 4.8 },
          { dimension: 'Relaciones de autoridad', questionCount: 3, answeredCount: 27, averageScore: 3.8 },
        ],
      }),
    )

    renderPanel()
    await userEvent.click(screen.getByRole('combobox', { name: copy.department }))
    await userEvent.click(await screen.findByRole('option', { name: 'Finanzas' }))
    await userEvent.click(screen.getByRole('button', { name: copy.run }))

    await waitFor(() => expect(screen.getByText('4.80')).toBeTruthy())
    expect(screen.getByText('Comunicación')).toBeTruthy()
    expect(screen.getByText('3.80')).toBeTruthy()

    // The cross went to the server rather than being sliced out of what was on screen.
    const [, , , segments] = vi.mocked(resultsApi.getSurveyAnalytics).mock.calls[0]!
    expect(segments).toEqual([{ field: 'department', value: 'd1' }])
  })

  it('reports a refused cross without ever printing how small it is', async () => {
    vi.mocked(resultsApi.getSurveyAnalytics).mockResolvedValue(
      payload({
        isSuppressed: true,
        suppressionReason: 'below_minimum_segment_respondents',
        filter: [{ field: 'puesto', value: 'gerencia' }],
        // The server sends the SURVEY's counters here, never the cohort's.
        summary: { ...payload().summary, completedCount: 30 },
        dimensions: [],
      }),
    )

    renderPanel()
    await userEvent.click(screen.getByRole('combobox', { name: 'puesto' }))
    await userEvent.click(await screen.findByRole('option', { name: 'gerencia' }))
    await userEvent.click(screen.getByRole('button', { name: copy.run }))

    await waitFor(() => expect(screen.getByText(copy.tooSmall.replace('{floor}', '5'))).toBeTruthy())
    // No cohort line, and in particular no count: for a cross the size is the disclosure.
    expect(screen.queryByText(copy.cohort.replace('{count}', '30'))).toBeNull()
    expect(screen.queryByText('30')).toBeNull()
  })

  it('believes the filter the server echoes, not the one that was clicked', async () => {
    // A payload that came back unfiltered must not be labelled as a cross: presenting
    // everyone's numbers as one department's is the failure this echo exists to prevent.
    vi.mocked(resultsApi.getSurveyAnalytics).mockResolvedValue(
      payload({ filter: [], dimensions: [{ dimension: 'Clima', questionCount: 1, answeredCount: 30, averageScore: 4 }] }),
    )

    renderPanel()
    await userEvent.click(screen.getByRole('combobox', { name: copy.department }))
    await userEvent.click(await screen.findByRole('option', { name: 'Finanzas' }))
    await userEvent.click(screen.getByRole('button', { name: copy.run }))

    await waitFor(() => expect(screen.getByText(copy.wholeSurvey)).toBeTruthy())
    expect(screen.queryByText('Finanzas', { selector: 'p' })).toBeNull()
  })

  // NOT COVERED HERE: the panel's network-failure branch. Every way of handing the mock a
  // rejected promise -- mockRejectedValue, a deferred rejection, one with a no-op catch
  // attached -- is reported by the runner as an unhandled rejection and fails the file, even
  // though the component's own try/catch takes it. Left as a stated gap rather than a test
  // that passes for the wrong reason; the branch itself is three lines and is read above.

  it('cannot run a cross with nothing chosen', () => {
    renderPanel()
    expect((screen.getByRole('button', { name: copy.run }) as HTMLButtonElement).disabled).toBe(true)
  })
})
