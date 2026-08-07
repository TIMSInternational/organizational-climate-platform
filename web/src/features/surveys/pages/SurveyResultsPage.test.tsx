import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import SurveyResultsPage from './SurveyResultsPage'
import { TranslationProvider } from '../../../i18n'
import { LOCALE_STORAGE_KEY } from '../../../i18n/locale'
import { setToken } from '../../../auth/token'
import type { SurveyAnalyticsResponse } from '../api/surveyResults'

function payload(overrides: Partial<SurveyAnalyticsResponse> = {}): SurveyAnalyticsResponse {
  return {
    surveyId: 's1',
    title: 'Q3 climate survey',
    status: 'closed',
    language: 'en',
    resolvedLocale: 'en',
    fallbackFields: [],
    summary: {
      invitedCount: 40,
      responseCount: 26,
      completedCount: 24,
      partialCount: 2,
      participationRate: 60,
      completionRate: 92.31,
      averageCompletionSeconds: 420,
      firstResponseAt: '2026-07-01T09:00:00Z',
      lastResponseAt: '2026-07-14T17:00:00Z',
      byLanguage: [
        { language: 'en', count: 18 },
        { language: 'es', count: 6 },
      ],
    },
    questions: [
      {
        questionId: 'q1',
        order: 1,
        type: 'likert',
        text: 'I feel safe raising concerns',
        category: 'safety',
        answeredCount: 24,
        distribution: [
          { value: '1', label: 'Strongly disagree', count: 2, percentage: 8.33, averageRank: null },
          { value: '4', label: 'Agree', count: 22, percentage: 91.67, averageRank: null },
        ],
        average: 3.7,
        median: 4,
        words: [],
        suppressedWordCount: 0,
      },
      {
        questionId: 'q2',
        order: 2,
        type: 'open_ended',
        text: 'What would you change?',
        category: 'culture',
        answeredCount: 11,
        distribution: [],
        average: null,
        median: null,
        words: [
          { language: 'en', word: 'workload', count: 5, responseCount: 5 },
          { language: 'es', word: 'horario', count: 3, responseCount: 3 },
        ],
        suppressedWordCount: 4,
      },
    ],
    breakdowns: [
      {
        dimension: 'department',
        segments: [
          {
            dimension: 'department',
            key: 'dept-support',
            label: 'Support',
            respondentCount: 9,
            participationRate: 75,
            isSuppressed: false,
            questions: [{ questionId: 'q1', answeredCount: 9, average: 3.1 }],
          },
          {
            dimension: 'department',
            key: 'dept-legal',
            label: 'Legal',
            respondentCount: 0,
            participationRate: null,
            isSuppressed: true,
            questions: [],
          },
        ],
        suppressedSegmentCount: 1,
        suppressedRespondentCount: 3,
        unsegmentedRespondentCount: 12,
      },
      {
        dimension: 'tenure',
        segments: [
          {
            dimension: 'tenure',
            key: '3_to_5_years',
            label: null,
            respondentCount: 10,
            participationRate: null,
            isSuppressed: false,
            questions: [{ questionId: 'q1', answeredCount: 10, average: 4.4 }],
          },
        ],
        suppressedSegmentCount: 0,
        suppressedRespondentCount: 0,
        unsegmentedRespondentCount: 14,
      },
    ],
    isSuppressed: false,
    suppressionReason: null,
    minimumGroupSize: 5,
    generatedAt: '2026-07-15T08:00:00Z',
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/surveys/s1/results']}>
        <Routes>
          <Route path="/surveys/:id/results" element={<SurveyResultsPage />} />
        </Routes>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

describe('SurveyResultsPage', () => {
  beforeEach(() => {
    // Pin the locale so the assertions below are about the page and not about
    // whichever language happy-dom's navigator reports.
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    setToken('header.payload.signature')
    // A fresh Response per call: one shared Response has its body consumed by the
    // first read.
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(payload()))))
  })

  afterEach(() => {
    cleanup()
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('reads the whole page from one request to /analytics', async () => {
    renderPage()
    // The title appears twice on purpose -- as the page heading and as the
    // breadcrumb back to the survey itself.
    await screen.findAllByText('Q3 climate survey')

    // Two requests could return two payloads computed a moment apart, so the
    // participation counter beside the distributions could disagree with the one
    // beside the breakdowns while both were individually correct.
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('undefined/surveys/s1/analytics?lang=en')
  })

  it('shows participation, per-question results and the breakdown', async () => {
    renderPage()

    // More than one match on purpose: the card title, the chart's figcaption and the
    // chart's table fallback all name the question.
    expect((await screen.findAllByText(/I feel safe raising concerns/)).length).toBeGreaterThan(0)
    expect(screen.getByText('Per-question results')).toBeTruthy()
    expect(screen.getByText('Breakdowns')).toBeTruthy()
    // Two rows name it: the breakdown table's, and the heat map's row header.
    expect(screen.getAllByRole('row', { name: /Support/ }).length).toBe(2)
  })

  describe('suppressed segments', () => {
    it('renders a withheld group as withheld, with an explanation', async () => {
      renderPage()
      const row = await screen.findByRole('row', { name: /Legal/ })

      expect(within(row).getByText('Withheld')).toBeTruthy()
      expect(
        within(row).getByText(/fewer than 5 respondents/i),
      ).toBeTruthy()
    })

    it('never prints the withheld group as a zero', async () => {
      // `respondentCount: 0` on a suppressed segment is the absence of a
      // measurement, not a measurement of zero. Printing it claims nobody in Legal
      // responded -- a different and wrong claim, and one a reader could subtract
      // from the totals to recover the real figure.
      renderPage()
      const row = await screen.findByRole('row', { name: /Legal/ })

      expect(within(row).queryByText('0')).toBeNull()
      expect(row.textContent).not.toMatch(/\b0\b/)
    })

    it('says how many groups and how many people were withheld, and how many were unsegmented', async () => {
      renderPage()

      // Withheld and unsegmented are reported separately: one group was measured and
      // hidden, the other was never in a group at all.
      expect(await screen.findByText(/1 groups covering 3 people are withheld/i)).toBeTruthy()
      expect(screen.getByRole('row', { name: /Not recorded/ })).toBeTruthy()
    })

    it('keeps the withheld group out of the heat map entirely', async () => {
      renderPage()
      await screen.findByRole('row', { name: /Legal/ })

      // `HeatMap` writes `"<row>, <column>: <value>"` into every cell's
      // accessible name. Support has a cell; Legal must have none, rather than a
      // bottom-of-ramp cell claiming it scored zero.
      const cells = screen.getAllByLabelText(/Q1: /)
      expect(cells.map((cell) => cell.getAttribute('aria-label'))).toEqual(['Support, Q1: 3.1'])
    })
  })

  describe('a survey below the whole-survey floor', () => {
    beforeEach(() => {
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse(
          payload({
            summary: {
              ...payload().summary,
              invitedCount: 40,
              responseCount: 4,
              completedCount: 4,
              partialCount: 0,
              participationRate: 10,
              completionRate: 100,
            },
            questions: [],
            breakdowns: [],
            isSuppressed: true,
            suppressionReason: 'below_minimum_respondents',
          }),
        ),
      )
    })

    it('explains why there are no per-question results instead of showing an empty section', async () => {
      renderPage()

      expect(await screen.findByText('Per-question results are withheld')).toBeTruthy()
      expect(screen.getByText(/fewer than 5 people have completed this survey/i)).toBeTruthy()
      expect(screen.queryByText('Breakdowns')).toBeNull()
    })

    it('still shows the participation counters, which identify nobody', async () => {
      renderPage()
      await screen.findByText('Per-question results are withheld')

      // "4 of 40 so far" is the number that tells an admin whether to keep chasing.
      expect(screen.getAllByText('Participation').length).toBeGreaterThan(0)
      // Twice: the KPI tile and the participation tracker's own stat.
      expect(screen.getAllByText('Invited').length).toBeGreaterThan(0)
    })
  })

  describe('content language', () => {
    it('says so when the content came back in a language the reader did not ask for', async () => {
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse(payload({ language: 'es', resolvedLocale: 'es', fallbackFields: ['title'] })),
      )
      renderPage()

      expect(await screen.findByText('Language of this content')).toBeTruthy()
      expect(screen.getByText(/Showing content in Spanish because it is not available in English/i)).toBeTruthy()
      expect(screen.getByText(/1 individual fields fell back/i)).toBeTruthy()
    })

    it('stays silent when the content is in the language that was asked for', async () => {
      renderPage()
      await screen.findByText('Per-question results')

      expect(screen.queryByText('Language of this content')).toBeNull()
    })

    it('reports partial fallback even when the payload as a whole is in the right language', async () => {
      // A survey authored in `both` whose third question was never translated:
      // `resolvedLocale` is correct, and only the per-field detail should fire.
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse(payload({ language: 'both', resolvedLocale: 'en', fallbackFields: ['questions[1].text'] })),
      )
      renderPage()

      expect(await screen.findByText('Language of this content')).toBeTruthy()
      expect(screen.queryByText(/Showing content in/i)).toBeNull()
      expect(screen.getByText(/1 individual fields fell back/i)).toBeTruthy()
    })
  })

  describe('open text', () => {
    it('reports the words it withheld rather than dropping them silently', async () => {
      renderPage()
      expect(
        await screen.findByText(/4 words are withheld because they appear in too few answers/i),
      ).toBeTruthy()
    })
  })

  describe('filters and drill-down', () => {
    it('narrows the question list by type', async () => {
      const user = userEvent.setup()
      renderPage()
      await screen.findAllByText(/I feel safe raising concerns/)

      await user.selectOptions(screen.getByLabelText('Question type'), 'open_ended')

      await waitFor(() => expect(screen.queryAllByText(/I feel safe raising concerns/)).toHaveLength(0))
      expect(screen.getAllByText(/What would you change\?/).length).toBeGreaterThan(0)
      // Filtering is client side over a payload the server already suppressed, so it
      // costs no extra request and cannot narrow below a floor.
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
    })

    it('switches the breakdown dimension and clears the drilled-into group', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.click(await screen.findByRole('button', { name: 'Show detail' }))
      expect(screen.getByText('Support compared with the whole survey')).toBeTruthy()

      await user.selectOptions(screen.getByLabelText('Break down by'), 'tenure')

      // A segment key is only meaningful inside its own dimension.
      expect(screen.queryByText('Support compared with the whole survey')).toBeNull()
      // Two rows name the segment: the breakdown table's, and the heat map's row
      // header -- the heat map is a real <table> (#79), which is what gives it row and
      // column semantics for free.
      expect(screen.getAllByRole('row', { name: /3_to_5_years/ }).length).toBeGreaterThan(0)
    })

    it('offers no drill-down for a withheld group', async () => {
      renderPage()
      const row = await screen.findByRole('row', { name: /Legal/ })
      expect(within(row).queryByRole('button')).toBeNull()
    })
  })

  it('offers a retry rather than a blank page when the request fails', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ message: 'Forbidden' }, 403))
    renderPage()

    expect(await screen.findByText('The results could not be loaded.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})
