import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import SurveyResultsPage from './SurveyResultsPage'
import { downloadTextFile } from '../../../lib/downloadTextFile'
import { TranslationProvider } from '../../../i18n'
import { LOCALE_STORAGE_KEY } from '../../../i18n/locale'
import { setToken } from '../../../auth/token'
import type { SurveyAnalyticsResponse } from '../api/surveyResults'

// The only part of the export that touches the DOM. Stubbed so the assertions
// below can read the bytes the page decided to write.
vi.mock('../../../lib/downloadTextFile', () => ({ downloadTextFile: vi.fn() }))

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
    // The download stub is module scoped, so a call recorded by one test would
    // otherwise be the "last call" another test reads.
    vi.mocked(downloadTextFile).mockClear()
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
    // Three rows name it: the breakdown table's, the per-question heat map's row
    // header, and the climate map's row header.
    expect(screen.getAllByRole('row', { name: /Support/ }).length).toBe(3)
  })

  /** The breakdown table, which is the only surface that lists every group. */
  function breakdownTable(): HTMLElement {
    return screen.getByRole('table', {
      name: /including the ones whose answers are withheld/i,
    })
  }

  describe('suppressed segments', () => {
    it('renders a withheld group as withheld, with an explanation', async () => {
      renderPage()
      await screen.findAllByRole('row', { name: /Legal/ })
      // Scoped to the breakdown table: the group also keeps a row in the climate
      // map above, which is the subject of its own test below.
      const row = within(breakdownTable()).getByRole('row', { name: /Legal/ })

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
      const rows = await screen.findAllByRole('row', { name: /Legal/ })

      // Every surface that shows the group, not just the table: the climate map
      // row is built from the same `respondentCount: 0`.
      for (const row of rows) {
        expect(within(row).queryByText('0')).toBeNull()
        expect(row.textContent).not.toMatch(/\b0\b/)
      }
    })

    it('says how many groups were withheld and how many were unsegmented', async () => {
      renderPage()

      // Withheld and unsegmented are reported separately: one group was measured and
      // hidden, the other was never in a group at all.
      expect(await screen.findByText(/Withheld groups: 1/i)).toBeTruthy()
      expect(screen.getByRole('row', { name: /Not recorded/ })).toBeTruthy()
    })

    it('never announces how many people are behind the withheld group', async () => {
      // `suppressedRespondentCount` is 3 here, and 24 responses completed. The page
      // used to print both "1 groups covering 3 people are withheld" and "Showing 21
      // of 24 completed responses" -- the second discloses the same 3 by subtraction,
      // which is the inference the floor exists to block.
      renderPage()
      await screen.findByText(/Withheld groups: 1/i)

      const text = document.body.textContent ?? ''
      expect(text).not.toMatch(/covering 3 people/i)
      expect(text).not.toMatch(/\b21 of 24\b/)
      // Nothing anywhere on the page pairs the completed total with a smaller
      // "shown" figure, whatever the wording.
      expect(text).not.toMatch(/\b\d+ of 24 completed/i)
    })

    it('keeps the withheld group out of the heat map entirely', async () => {
      renderPage()
      await screen.findAllByRole('row', { name: /Legal/ })

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

    it('offers no export, which could only download an empty file', async () => {
      renderPage()
      await screen.findByText('Per-question results are withheld')

      // `questions` and `breakdowns` are both empty here, so either export would
      // produce a header row and nothing else -- which reads as data lost rather
      // than data withheld.
      expect(screen.queryByRole('button', { name: /Export/ })).toBeNull()
    })

    it('still shows the participation counters, which identify nobody', async () => {
      renderPage()
      await screen.findByText('Per-question results are withheld')

      // "4 of 40 so far" is the number that tells an admin whether to keep chasing.
      expect(screen.getByText('Participation')).toBeTruthy()
      expect(screen.getByText('Invited')).toBeTruthy()
      expect(screen.getByText('36 still to respond')).toBeTruthy()
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
      // Twice: once under the themes summary, which totals the withheld count
      // across every open-ended question, and once on the question card itself.
      expect(
        await screen.findAllByText(/4 words are withheld because they appear in too few answers/i),
      ).toHaveLength(2)
    })
  })

  /**
   * The redesign's above-the-fold half: the climate map, the findings it produces
   * and the dimension ranking under them.
   *
   * The shared `payload()` has one scale question and one disclosed group, which
   * is deliberately the degenerate case — every cell equals the target, so there
   * are no findings and no ranking to see. These tests use a payload with two
   * dimensions and two disclosed groups, which is the shape the panels are for.
   */
  describe('the climate map and its findings', () => {
    function twoDimensionPayload(): SurveyAnalyticsResponse {
      const base = payload()
      return {
        ...base,
        questions: [
          base.questions[0],
          {
            questionId: 'q3',
            order: 3,
            type: 'likert',
            text: 'My workload is manageable',
            category: 'workload',
            answeredCount: 24,
            distribution: [],
            average: 2.8,
            median: 3,
            words: [],
            suppressedWordCount: 0,
          },
          base.questions[1],
          {
            questionId: 'q5',
            order: 5,
            type: 'open_ended',
            text: 'Anything else?',
            category: null,
            answeredCount: 7,
            distribution: [],
            average: null,
            median: null,
            words: [{ language: 'en', word: 'workload', count: 4, responseCount: 4 }],
            suppressedWordCount: 0,
          },
        ],
        breakdowns: [
          {
            ...base.breakdowns[0],
            segments: [
              {
                dimension: 'department',
                key: 'dept-ops',
                label: 'Operations',
                respondentCount: 20,
                participationRate: 80,
                isSuppressed: false,
                questions: [
                  { questionId: 'q1', answeredCount: 20, average: 4.3 },
                  { questionId: 'q3', answeredCount: 20, average: 3.5 },
                ],
              },
              {
                ...base.breakdowns[0].segments[0],
                questions: [
                  { questionId: 'q1', answeredCount: 9, average: 3.1 },
                  { questionId: 'q3', answeredCount: 9, average: 2.1 },
                ],
              },
              base.breakdowns[0].segments[1],
            ],
          },
          base.breakdowns[1],
        ],
      }
    }

    beforeEach(() => {
      vi.mocked(fetch).mockImplementation(() =>
        Promise.resolve(jsonResponse(twoDimensionPayload())),
      )
    })

    it('says what the colours are relative to, rather than leaving the reader to guess', async () => {
      renderPage()
      // (4.3 + 3.5 + 3.1 + 2.1) / 4 = 3.25, rounded to the cells' own precision.
      expect(
        await screen.findByText(/a target of 3\.3 — this survey's own average/),
      ).toBeTruthy()
    })

    it('draws a row per group and a column per dimension', async () => {
      renderPage()
      // Scoped to the climate section: the per-question heat map below it is a
      // table with the same generic caption.
      const map = within(
        await screen.findByRole('region', { name: 'Climate by group and dimension' }),
      ).getByRole('table', { name: 'Chart data as a table' })

      expect(within(map).getByRole('columnheader', { name: 'safety' })).toBeTruthy()
      expect(within(map).getByRole('columnheader', { name: 'workload' })).toBeTruthy()
      expect(within(map).getByRole('rowheader', { name: 'Operations' })).toBeTruthy()
      expect(within(map).getByRole('rowheader', { name: 'Legal' })).toBeTruthy()
    })

    it('keeps a withheld group in the map as protected, and never says how few answered', async () => {
      renderPage()
      const cells = await screen.findAllByLabelText(/^Legal, /)

      // One per dimension, hatched and locked -- not an empty row, which reads as
      // missing data rather than as a guarantee being enforced.
      expect(cells).toHaveLength(2)
      for (const cell of cells) {
        const label = cell.getAttribute('aria-label') ?? ''
        expect(label).toMatch(/protected — withheld below 5 responses/)
        // The floor may be published; the count behind the cell may not. Two
        // published sub-threshold counts can be differenced to re-identify people.
        expect(label).not.toMatch(/\b[034]\b/)
      }
    })

    it('names the cell furthest below the average as the first finding', async () => {
      renderPage()
      await screen.findByText('Where to look first')

      const findings = screen.getAllByRole('button', { name: /below the survey average/ })
      // Support/workload at 2.1 is 1.2 under the average of 3.3; Support/safety at
      // 3.1 is 0.2 under it. Operations is above on both and is not a finding.
      expect(findings[0].textContent).toContain('Support — workload')
      expect(findings[0].textContent).toContain('1.2 below the survey average')
      expect(findings.map((finding) => finding.textContent)).not.toContain(
        expect.stringContaining('Operations'),
      )
    })

    it('drills into the group a finding came from when it is opened', async () => {
      const user = userEvent.setup()
      renderPage()
      await screen.findByText('Where to look first')

      expect(screen.queryByText('Support compared with the whole survey')).toBeNull()
      await user.click(screen.getAllByRole('button', { name: /below the survey average/ })[0])

      // The finding names the group; opening it shows that group's answers.
      expect(screen.getByText('Support compared with the whole survey')).toBeTruthy()
    })

    it('ranks the dimensions lowest first, with a word beside the colour', async () => {
      renderPage()
      const table = await screen.findByRole('table', {
        name: /Score for each dimension across the whole survey/i,
      })
      const rows = within(table).getAllByRole('row').slice(1)

      // workload 2.8 then safety 3.7, against their own mean of 3.3 -- a baseline
      // separate from the map's, and named as such.
      expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual([
        'workload',
        'safety',
      ])
      expect(within(rows[0]).getByText('Below')).toBeTruthy()
      expect(within(rows[1]).getByText('Above')).toBeTruthy()
    })

    it('gathers open text into one themes cloud, keeping the languages apart', async () => {
      renderPage()
      expect(await screen.findByText('Themes in open text')).toBeTruthy()

      // The merge is the point: "workload" is written 5 times in one open-ended
      // question and 4 in another, and the themes cloud is the only place it
      // reads 9. The per-question clouds still show 5 and 4.
      const themes = screen.getByRole('region', { name: 'Themes in open text' })
      expect(within(themes).getByLabelText('workload, 9 occurrences')).toBeTruthy()
      expect(screen.getAllByLabelText('workload, 5 occurrences').length).toBeGreaterThan(0)
      expect(screen.getAllByLabelText('workload, 4 occurrences').length).toBeGreaterThan(0)

      // Spanish is counted apart -- you cannot write "the Spanish" of a sentence
      // somebody typed in English, so the two never merge into one entry.
      expect(within(themes).getByLabelText('horario, 3 occurrences')).toBeTruthy()
    })
  })

  /**
   * The floor taking *every* group, which is the case the section used to vanish
   * on: `{climate && ...}` had no else and `buildClimateMap` returned null, so the
   * H2, the map and the findings panel all left the DOM while the breakdown table
   * six hundred pixels below still listed the same groups as withheld.
   */
  describe('every group below the segment floor', () => {
    function allWithheldPayload(): SurveyAnalyticsResponse {
      const base = payload()
      return {
        ...base,
        breakdowns: [
          {
            ...base.breakdowns[0],
            segments: base.breakdowns[0].segments.map((segment) => ({
              ...segment,
              respondentCount: 0,
              participationRate: null,
              isSuppressed: true,
              questions: [],
            })),
            suppressedSegmentCount: 2,
            suppressedRespondentCount: 7,
          },
          base.breakdowns[1],
        ],
      }
    }

    beforeEach(() => {
      vi.mocked(fetch).mockImplementation(() =>
        Promise.resolve(jsonResponse(allWithheldPayload())),
      )
    })

    it('still renders the climate section, with every group protected', async () => {
      renderPage()
      const map = within(
        await screen.findByRole('region', { name: 'Climate by group and dimension' }),
      ).getByRole('table', { name: 'Chart data as a table' })

      // The rows are still there -- the groups exist and were measured.
      expect(within(map).getByRole('rowheader', { name: 'Support' })).toBeTruthy()
      expect(within(map).getByRole('rowheader', { name: 'Legal' })).toBeTruthy()
      // And every cell is the padlock, not a blank and not a colour.
      const cells = within(map).getAllByLabelText(/protected — withheld below 5 responses/)
      expect(cells).toHaveLength(2)
    })

    it('says the floor is what is holding the readings back, and prints no target', async () => {
      renderPage()
      await screen.findByRole('region', { name: 'Climate by group and dimension' })

      expect(
        screen.getByText(/every reading below is protected and none is shown/i),
      ).toBeTruthy()
      // There is no disclosed cell to average, so no "target of x" may be claimed.
      expect(screen.queryByText(/this survey's own average, which is what the scale/)).toBeNull()
    })

    it('keeps the findings panel and says why it is empty', async () => {
      renderPage()

      expect(await screen.findByText('Where to look first')).toBeTruthy()
      // "No group sits below the survey average" would be a claim about the
      // organisation; this is the floor being enforced, which is a different fact.
      expect(screen.getByText(/every group's reading is protected/i)).toBeTruthy()
      expect(screen.queryByText(/No group sits below the survey average/i)).toBeNull()
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
      await screen.findAllByRole('row', { name: /Legal/ })
      const row = within(breakdownTable()).getByRole('row', { name: /Legal/ })
      expect(within(row).queryByRole('button')).toBeNull()
    })
  })

  describe('the header exports', () => {
    it('writes every question, not the subset the filters two thousand pixels below left visible', async () => {
      // The button sits in the header, where nothing is beside it to say the
      // download was narrowed. So it must not be: filtering to open-ended hides Q1
      // from the page, and the file still has to carry it.
      const user = userEvent.setup()
      renderPage()
      await screen.findAllByText(/I feel safe raising concerns/)

      await user.selectOptions(screen.getByLabelText('Question type'), 'open_ended')
      await waitFor(() =>
        expect(screen.queryAllByText(/I feel safe raising concerns/)).toHaveLength(0),
      )

      await user.click(screen.getByRole('button', { name: 'Export questions (CSV)' }))

      const [, , contents] = vi.mocked(downloadTextFile).mock.calls.at(-1)!
      expect(contents).toContain('I feel safe raising concerns')
      expect(contents).toContain('What would you change?')
    })

    it('writes every dimension of the breakdown, not just the selected one', async () => {
      const user = userEvent.setup()
      renderPage()
      await screen.findAllByText(/I feel safe raising concerns/)

      await user.click(screen.getByRole('button', { name: 'Export breakdown (CSV)' }))

      const [, , contents] = vi.mocked(downloadTextFile).mock.calls.at(-1)!
      expect(contents).toContain('department')
      expect(contents).toContain('tenure')
    })
  })

  it('offers a retry rather than a blank page when the request fails', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ message: 'Forbidden' }, 403))
    renderPage()

    expect(await screen.findByText('The results could not be loaded.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})
