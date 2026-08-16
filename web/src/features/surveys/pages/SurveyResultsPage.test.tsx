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
        scaleMin: 1,
        scaleMax: 5,
        scaleLabelMin: 'Strongly disagree',
        scaleLabelMax: 'Strongly agree',
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
        scaleMin: null,
        scaleMax: null,
        scaleLabelMin: null,
        scaleLabelMax: null,
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
            headcount: 12,
            isSuppressed: false,
            questions: [{ questionId: 'q1', answeredCount: 9, average: 3.1 }],
          },
          {
            dimension: 'department',
            key: 'dept-legal',
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
            headcount: null,
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
    // Path and query, not the whole URL: pinning the base made this fail whenever
    // VITE_API_BASE_URL was set, which is the normal state of a configured dev machine.
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toMatch(/\/surveys\/s1\/analytics\?lang=en$/)
  })

  it('shows participation, per-question results and the breakdown', async () => {
    renderPage()

    // More than one match on purpose: the card title, the chart's figcaption and the
    // chart's table fallback all name the question.
    expect((await screen.findAllByText(/I feel safe raising concerns/)).length).toBeGreaterThan(0)
    expect(screen.getByText('Per-question results')).toBeTruthy()
    expect(screen.getByText('Breakdowns')).toBeTruthy()
    // Two rows name it: the breakdown table's and the climate map's row header.
    // Exactly two — a third would be the dropped sequential heat strip coming back.
    expect(screen.getAllByRole('row', { name: /Support/ }).length).toBe(2)
  })

  /** The breakdown table, which is the only surface that lists every group. */
  function breakdownTable(): HTMLElement {
    return screen.getByRole('table', {
      name: /including the ones whose answers are withheld/i,
    })
  }

  describe('suppressed segments', () => {
    it('renders a withheld group in the protected grammar: hatched box, the word, the sentence', async () => {
      renderPage()
      await screen.findAllByRole('row', { name: /Legal/ })
      // Scoped to the breakdown table: the group also keeps a row in the climate
      // map above, which is the subject of its own test below.
      const row = within(breakdownTable()).getByRole('row', { name: /Legal/ })

      // The same ProtectedCell mark the climate map hatches this group's row
      // with — "protected" is learned once and read twice.
      expect(within(row).getByRole('img', { name: /Legal: protected/i })).toBeTruthy()
      expect(within(row).getByText('Protected')).toBeTruthy()
      expect(
        within(row).getByText(/fewer than 5 respondents/i),
      ).toBeTruthy()
    })

    it("withholds a withheld group's participation with it — no rate, no denominator", async () => {
      // The footnote's reason: a percentage over a known headcount publishes the
      // count. So the row must carry neither the rate nor the "of N people" half
      // it would be divided by.
      renderPage()
      await screen.findAllByRole('row', { name: /Legal/ })
      const row = within(breakdownTable()).getByRole('row', { name: /Legal/ })

      expect(row.textContent).not.toContain('%')
      expect(row.textContent).not.toMatch(/of \d+ people/i)
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

    it('renders no sequential heat strip beside the diverging climate map', async () => {
      // The admin round DROPPED the "Average score by department and question"
      // grid: the climate map already answers group × dimension, and one page
      // must not carry two encodings of one comparison. `HeatMap` writes
      // `"<row>, <column>: <value>"` into every cell's accessible name, so its
      // absence is checkable by the naming pattern it would reintroduce.
      renderPage()
      await screen.findAllByRole('row', { name: /Legal/ })

      expect(screen.queryAllByLabelText(/, Q\d+: /)).toEqual([])
    })

    it('never gives a protected group a distribution row', async () => {
      // The per-question strips are whole-survey aggregates. A strip labelled
      // with a group's name — any group's, but a withheld one above all — would
      // be a per-group distribution, which is exactly the surface the segment
      // floor exists to deny. Mutation-proved: rendering a strip per breakdown
      // segment turns this red on both names.
      renderPage()
      const section = await screen.findByRole('region', { name: 'Per-question results' })

      expect(within(section).queryByText(/Legal/)).toBeNull()
      expect(within(section).queryByText(/Support/)).toBeNull()
    })
  })

  describe('the participation strip', () => {
    it('states the anonymity floor as a reading, groups withheld never omitted', async () => {
      renderPage()

      expect(await screen.findByText('Anonymity floor')).toBeTruthy()
      expect(screen.getByText('Groups under it are withheld, never omitted')).toBeTruthy()
      // The reading is the server's own minimumGroupSize, not a client constant.
      const tile = screen.getByText('Anonymity floor').closest('[data-slot="kpi-tile"]')!
      expect(within(tile as HTMLElement).getByText('5')).toBeTruthy()
    })
  })

  describe('the distribution strips', () => {
    it('renders a scale question as one strip row: dimension chip, n, mean, standing, scale ends', async () => {
      renderPage()
      const section = await screen.findByRole('region', { name: 'Per-question results' })

      // The dimension chip is the category, raw — the author's own vocabulary.
      // `getAllByText` because the category filter's <option> shares the word;
      // the chip is the pill-shaped one.
      const chips = within(section).getAllByText('safety')
      expect(chips.some((chip) => chip.className.includes('rounded-full'))).toBe(true)
      // n and the mean, at the page's one-decimal precision.
      expect(within(section).getByText('24')).toBeTruthy()
      expect(within(section).getByText('3.7')).toBeTruthy()
      // The scale ends in the author's words, with the bound beside them.
      expect(within(section).getByText('1 · Strongly disagree')).toBeTruthy()
      expect(within(section).getByText('5 · Strongly agree')).toBeTruthy()
    })

    it('colours the strip on the climate map ramp, by scale position', async () => {
      renderPage()
      const section = await screen.findByRole('region', { name: 'Per-question results' })

      // Bucket "1" (2 answers) sits at the red end, bucket "4" (22) on the
      // near-blue step — position decides, not render order. (The thin-segment
      // tooltip rule is DistributionStrip's own test.)
      const disagree = within(section).getByRole('img', { name: 'Strongly disagree: 2 of 24' })
      const agree = within(section).getByRole('img', { name: 'Agree: 22 of 24' })
      expect(disagree.style.backgroundColor).toBe('var(--admin-chart-div-neg-2)')
      expect(agree.style.backgroundColor).toBe('var(--admin-chart-div-pos-1)')
      expect(agree.textContent).toBe('22')
      expect(disagree.getAttribute('title')).toBe('Strongly disagree: 2 of 24')
    })

    it('keeps the full card for an open-ended question, which has no scale to paint', async () => {
      renderPage()
      const section = await screen.findByRole('region', { name: 'Per-question results' })

      // The word cloud card, not a strip: red-to-blue over words would claim an
      // order nobody authored.
      expect(within(section).getAllByText(/What would you change\?/).length).toBeGreaterThan(0)
      expect(within(section).queryByRole('img', { name: /workload: \d+ of/ })).toBeNull()
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

    it('renders no themes section for a survey with no open-text question', async () => {
      // A section that would always be empty for this survey is not drawn as if
      // it had content (the prototype's note 08).
      const base = payload()
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse(payload({ questions: [base.questions[0]] })),
      )
      renderPage()
      await screen.findByText('Per-question results')

      expect(screen.queryByText('Themes in open text')).toBeNull()
    })

    it('keeps the section when every word fell under the word floor, and says so', async () => {
      // Withheld is not absent: the survey HAS open-text questions, so the
      // section stays and the withheld count is the content.
      const base = payload()
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse(
          payload({
            questions: [
              base.questions[0],
              { ...base.questions[1], words: [], suppressedWordCount: 9 },
            ],
          }),
        ),
      )
      renderPage()

      expect(await screen.findByText('Themes in open text')).toBeTruthy()
      expect(
        screen.getAllByText(/9 words are withheld because they appear in too few answers/i)
          .length,
      ).toBeGreaterThan(0)
    })
  })

  describe('the breakdown table', () => {
    it("prints a disclosed group's participation with its denominator", async () => {
      renderPage()
      await screen.findAllByRole('row', { name: /Support/ })
      const row = within(breakdownTable()).getByRole('row', { name: /Support/ })

      // "75% of 12 people" — the rate and the headcount it is a rate of. The
      // denominator comes only from the server's `headcount` field, which is
      // nulled for withheld groups; see the suppressed-segments tests.
      expect(within(row).getByText('75%')).toBeTruthy()
      expect(within(row).getByText(/of 12 people/)).toBeTruthy()
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
            scaleMin: 1,
            scaleMax: 5,
            scaleLabelMin: null,
            scaleLabelMax: null,
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
            scaleMin: null,
            scaleMax: null,
            scaleLabelMin: null,
            scaleLabelMax: null,
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
                headcount: 25,
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
