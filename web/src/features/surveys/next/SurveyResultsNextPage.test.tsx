import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import SurveyResultsNextPage from './SurveyResultsNextPage'
import { TranslationProvider } from '../../../i18n'
import { CompanyContextProvider } from '../../../company-context'
import { setToken } from '../../../auth/token'
import { tokenFor } from '../../../test/jwtFixture'
import { downloadBlobFile } from '../../../lib/downloadBlobFile'
import { downloadTextFile } from '../../../lib/downloadTextFile'
import type { SurveyAnalyticsResponse, SurveyQuestionResult, SurveySegmentResult } from '../api/surveyResults'
import en from '../../../i18n/en.json'

vi.mock('../../../lib/downloadBlobFile', () => ({ downloadBlobFile: vi.fn() }))
// The only part of a CSV export that touches the DOM, stubbed so the assertions can read
// the bytes the page decided to write.
vi.mock('../../../lib/downloadTextFile', () => ({ downloadTextFile: vi.fn() }))

const copy = en.surveyResults.next

function question(id: string, category: string, average: number, low: number): SurveyQuestionResult {
  return {
    questionId: id,
    order: Number(id.slice(1)),
    type: 'likert',
    text: `Question ${id}`,
    category,
    answeredCount: 24,
    distribution: [
      { value: '1', label: null, count: low, percentage: (low / 24) * 100, averageRank: null },
      { value: '4', label: null, count: 24 - low, percentage: ((24 - low) / 24) * 100, averageRank: null },
    ],
    average,
    median: 4,
    scaleMin: 1,
    scaleMax: 5,
    scaleLabelMin: 'never',
    scaleLabelMax: 'always',
    words: [],
    suppressedWordCount: 0,
  }
}

function segment(key: string, label: string, respondents: number, scores: [number, number] | null): SurveySegmentResult {
  return {
    dimension: 'department',
    key,
    label,
    respondentCount: scores ? respondents : 0,
    participationRate: null,
    headcount: null,
    isSuppressed: scores === null,
    questions: scores
      ? [
          { questionId: 'q1', answeredCount: respondents, average: scores[0] },
          { questionId: 'q2', answeredCount: respondents, average: scores[1] },
        ]
      : [],
  }
}

function payload(): SurveyAnalyticsResponse {
  return {
    surveyId: 's1',
    title: 'Q3 climate survey',
    status: 'closed',
    language: 'en',
    resolvedLocale: 'en',
    fallbackFields: [],
    summary: {
      invitedCount: null,
      responseCount: 24,
      completedCount: 24,
      partialCount: 0,
      participationRate: null,
      completionRate: 100,
      averageCompletionSeconds: 300,
      firstResponseAt: '2026-07-01T09:00:00Z',
      lastResponseAt: '2026-08-06T17:00:00Z',
      byLanguage: [{ language: 'en', count: 24 }],
    },
    isSuppressed: false,
    suppressionReason: null,
    minimumGroupSize: 5,
    generatedAt: '2026-08-07T00:00:00Z',
    questions: [question('q1', 'workload', 3.3, 6), question('q2', 'psychological_safety', 3.8, 3)],
    breakdowns: [
      {
        dimension: 'department',
        segments: [
          segment('d-fin', 'Finanzas', 0, null),
          segment('d-eng', 'Ingeniería', 8, [3.7, 4.0]),
          segment('d-ops', 'Operaciones', 10, [2.4, 2.6]),
        ],
        suppressedSegmentCount: 1,
        suppressedRespondentCount: 3,
        unsegmentedRespondentCount: 0,
      },
    ],
  }
}

const plans = {
  actionPlans: [
    {
      id: 'p1',
      title: 'Reducir la carga de trabajo en Operaciones',
      companyId: 'c1',
      departmentId: 'd-ops',
      dueDate: '2026-10-15',
      status: 'in_progress',
      priority: 'high',
      createdAt: '2026-08-10T00:00:00Z',
    },
  ],
}

/** An open-ended question: no distribution, no mean, word frequencies per language. */
function openQuestion(
  id: string,
  text: string,
  category: string | null,
  words: SurveyQuestionResult['words'],
  suppressedWordCount: number,
): SurveyQuestionResult {
  return {
    questionId: id,
    order: Number(id.slice(1)),
    type: 'open_ended',
    text,
    category,
    answeredCount: 11,
    distribution: [],
    average: null,
    median: null,
    scaleMin: null,
    scaleMax: null,
    scaleLabelMin: null,
    scaleLabelMax: null,
    words,
    suppressedWordCount,
  }
}

/**
 * The payload plus two open-ended questions. "workload" is written 5 times in one
 * and 4 in the other, so the merged themes cloud is the only place it reads 9; the
 * Spanish word never merges with an English one; 4 + 3 words were withheld.
 */
function withOpenText(): SurveyAnalyticsResponse {
  const base = payload()
  return {
    ...base,
    questions: [
      ...base.questions,
      openQuestion(
        'q3',
        'What would you change?',
        'culture',
        [
          { language: 'en', word: 'workload', count: 5, responseCount: 5 },
          { language: 'es', word: 'horario', count: 3, responseCount: 3 },
        ],
        4,
      ),
      openQuestion('q4', 'Anything else?', null, [{ language: 'en', word: 'workload', count: 4, responseCount: 4 }], 3),
    ],
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

/** The two requests the page makes, answered with the given analytics payload. */
function fetching(analytics: SurveyAnalyticsResponse) {
  return (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/analytics')) return Promise.resolve(jsonResponse(analytics))
    if (url.includes('/action-plans')) return Promise.resolve(jsonResponse(plans))
    return Promise.resolve(new Response('{}', { status: 404 }))
  }
}

function renderAt(claims: Record<string, unknown>) {
  setToken(tokenFor({ sub: 'u1', companyId: 'c1', nodoId: '', ...claims }))
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/surveys/s1/results']}>
        <CompanyContextProvider>
          <Routes>
            <Route path="/surveys/:id/results" element={<SurveyResultsNextPage />} />
            <Route path="/dashboard" element={<div data-testid="home" />} />
          </Routes>
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

describe('SurveyResultsNextPage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem('preferredLocale', 'en')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/analytics')) return Promise.resolve(jsonResponse(payload()))
        if (url.includes('/action-plans')) return Promise.resolve(jsonResponse(plans))
        return Promise.resolve(new Response('{}', { status: 404 }))
      }),
    )
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.mocked(downloadBlobFile).mockClear()
    vi.mocked(downloadTextFile).mockClear()
    window.localStorage.clear()
  })

  it('draws the redesigned results for a company administrator, from the real payload', async () => {
    renderAt({ role: 'company_admin' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Results of Q3 climate survey' })).toBeTruthy()
    // Both requests went through the existing clients, in one round trip each.
    const urls = vi.mocked(fetch).mock.calls.map((call) => String(call[0]))
    expect(urls.some((url) => /\/surveys\/s1\/analytics\?lang=en$/.test(url))).toBe(true)
    expect(urls.some((url) => /\/action-plans\?companyId=c1&lang=en$/.test(url))).toBe(true)

    // "Where to look first": the worst disclosed cell is Operaciones, and a plan covers it.
    // The heading is the words alone: the count lives in the subtitle beside it, once.
    expect(screen.getByRole('heading', { level: 2, name: copy.whereHeading })).toBeTruthy()
    const findings = screen.getAllByRole('listitem').filter((item) => within(item).queryByText(copy.viewQuestion))
    expect(findings.length).toBeGreaterThan(0)
    expect(findings[0].textContent).toContain('Operaciones')
    expect(findings[0].textContent).toContain('2.4')
    expect(within(findings[0]).getByText(copy.planCovers)).toBeTruthy()

    // The sample chip is on the page: the opened group's 1–5 distribution is not a
    // measurement (the deltas are; without the trends payload this mock has none).
    expect(screen.getAllByText(en.dashboard.next.sampleChip).length).toBeGreaterThan(0)
  })

  it('never prints a number for a protected group, in any panel', async () => {
    renderAt({ role: 'company_admin' })
    await screen.findByRole('heading', { level: 1 })

    const protectedRow = screen.getByTestId('group-row-d-fin')
    expect(protectedRow.textContent).toContain('Finanzas')
    expect(protectedRow.textContent).not.toMatch(/\d/)
    const disclosedRow = screen.getByTestId('group-row-d-eng')
    expect(disclosedRow.textContent).toMatch(/3\.9/)

    // The worst cell opens by itself; closing it and reopening it from the finding is the same panel.
    expect(screen.getByRole('heading', { level: 2, name: /Operaciones/ })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: en.common.close }))
    expect(screen.queryByRole('heading', { level: 2, name: /Operaciones/ })).toBeNull()
    await userEvent.click(screen.getAllByRole('button', { name: new RegExp(copy.viewQuestion) })[0])
    expect(await screen.findByRole('heading', { level: 2, name: /Operaciones/ })).toBeTruthy()
    expect(screen.getByTestId('other-d-fin').textContent).not.toMatch(/\d/)
    expect(screen.getByTestId('other-d-eng').textContent).toMatch(/3\.7/)
    // The plan that covers the group, by department id.
    expect(screen.getByText(/Reducir la carga de trabajo en Operaciones/)).toBeTruthy()
    expect(screen.getByRole('link', { name: copy.openPlan }).getAttribute('href')).toBe('/action-plans/p1')
  })

  it('offers the exports to an administrator and sends the PDF through fetch + Blob', async () => {
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/analytics')) return Promise.resolve(jsonResponse(payload()))
      if (url.includes('/action-plans')) return Promise.resolve(jsonResponse(plans))
      if (url.includes('/export/pdf')) return Promise.resolve(new Response(new Blob(['%PDF']), { status: 200 }))
      return Promise.resolve(new Response('{}', { status: 404 }))
    })
    renderAt({ role: 'company_admin' })
    await screen.findByRole('heading', { level: 1 })
    await userEvent.click(screen.getByRole('button', { name: copy.exportPdf }))
    await waitFor(() => expect(vi.mocked(downloadBlobFile)).toHaveBeenCalledTimes(1))
    expect(vi.mocked(downloadBlobFile).mock.calls[0][0]).toBe('survey-s1-results.pdf')
    // The request carries the reader's locale, so the document's chrome comes back in
    // the language they are reading — the same guarantee the page it replaced carried.
    const requested = vi.mocked(fetch).mock.calls.map((call) => String(call[0]))
    expect(requested.some((url) => /\/surveys\/s1\/export\/pdf\?lang=en$/.test(url))).toBe(true)
  })

  it('reports a failed PDF download instead of doing nothing', async () => {
    // A download button that silently no-ops reads as a broken build, and an admin who
    // cannot tell "refused" from "nothing happened" will retry rather than escalate.
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/analytics')) return Promise.resolve(jsonResponse(payload()))
      if (url.includes('/action-plans')) return Promise.resolve(jsonResponse(plans))
      if (url.includes('/export/pdf'))
        return Promise.resolve(new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403 }))
      return Promise.resolve(new Response('{}', { status: 404 }))
    })
    renderAt({ role: 'company_admin' })
    await screen.findByRole('heading', { level: 1 })
    await userEvent.click(screen.getByRole('button', { name: copy.exportPdf }))
    expect(await screen.findByText('Forbidden')).toBeTruthy()
    expect(vi.mocked(downloadBlobFile)).not.toHaveBeenCalled()
  })

  it('writes every question to the questions CSV, whatever the page shows', async () => {
    renderAt({ role: 'company_admin' })
    await screen.findByRole('heading', { level: 1 })
    await userEvent.click(screen.getByRole('button', { name: copy.exportCsv }))
    await userEvent.click(await screen.findByRole('menuitem', { name: en.surveyResults.exportQuestions }))
    const [fileName, , contents] = vi.mocked(downloadTextFile).mock.calls.at(-1)!
    expect(fileName).toBe('survey-s1-questions.csv')
    expect(contents).toContain('Question q1')
    expect(contents).toContain('Question q2')
  })

  it('writes every dimension to the breakdown CSV, not only the one the map is drawn from', async () => {
    // The map draws the department breakdown; the file must still carry the others,
    // because nothing beside the button says the download was narrowed.
    const tenure = {
      dimension: 'tenure',
      segments: [segment('t-new', 'Under a year', 12, [3.5, 3.9])],
      suppressedSegmentCount: 0,
      suppressedRespondentCount: 0,
      unsegmentedRespondentCount: 12,
    }
    const twoBreakdowns: SurveyAnalyticsResponse = { ...payload(), breakdowns: [...payload().breakdowns, tenure] }
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/analytics')) return Promise.resolve(jsonResponse(twoBreakdowns))
      if (url.includes('/action-plans')) return Promise.resolve(jsonResponse(plans))
      return Promise.resolve(new Response('{}', { status: 404 }))
    })
    renderAt({ role: 'company_admin' })
    await screen.findByRole('heading', { level: 1 })
    await userEvent.click(screen.getByRole('button', { name: copy.exportCsv }))
    await userEvent.click(await screen.findByRole('menuitem', { name: en.surveyResults.exportBreakdown }))
    const [fileName, , contents] = vi.mocked(downloadTextFile).mock.calls.at(-1)!
    expect(fileName).toBe('survey-s1-breakdown.csv')
    expect(contents).toContain('department')
    expect(contents).toContain('tenure')
    // A withheld group is withheld in the file too: its name, never a count or a mean.
    const finanzas = contents.split('\n').filter((line) => line.includes('Finanzas'))
    expect(finanzas.length).toBeGreaterThan(0)
    for (const line of finanzas) expect(line).not.toMatch(/\d/)
  })

  it('offers a retry rather than a blank page when the request fails', async () => {
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403 })),
    )
    renderAt({ role: 'company_admin' })
    expect(await screen.findByText(en.surveyResults.loadFailed)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.common.retry })).toBeTruthy()
  })

  it('offers no export and draws no map when the whole survey is under the floor', async () => {
    // The server's shape below the whole-survey floor: `questions` and `breakdowns`
    // arrive empty (surveyResults.ts:123). A download of that would be a header row.
    const suppressed: SurveyAnalyticsResponse = {
      ...payload(),
      isSuppressed: true,
      suppressionReason: 'below_minimum_group_size',
      questions: [],
      breakdowns: [],
    }
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/analytics')) return Promise.resolve(jsonResponse(suppressed))
      if (url.includes('/action-plans')) return Promise.resolve(jsonResponse(plans))
      return Promise.resolve(new Response('{}', { status: 404 }))
    })
    renderAt({ role: 'company_admin' })
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByText(en.surveyResults.suppressedTitle)).toBeTruthy()
    expect(screen.queryByRole('button', { name: copy.exportPdf })).toBeNull()
    expect(screen.queryByRole('button', { name: copy.exportCsv })).toBeNull()
    expect(screen.queryByRole('heading', { level: 2, name: copy.mapHeading })).toBeNull()
    expect(screen.queryByTestId('group-row-d-eng')).toBeNull()
    expect(vi.mocked(fetch).mock.calls.some((call) => String(call[0]).includes('/export/pdf'))).toBe(false)
  })

  it('is what the real route renders: /surveys/:id/results mounts this page and no /next sibling remains', () => {
    // `router.tsx` builds its routes inline for `createBrowserRouter`, so the swap is
    // pinned at the source: the route the sidebar links to names this component, and
    // the `/next` sibling the redesign first mounted beside the old page is gone.
    const source = readFileSync(join(process.cwd(), 'src', 'app', 'router.tsx'), 'utf8')
    expect(source).toMatch(/path: '\/surveys\/:id\/results',\s*element: <SurveyResultsNextPage \/>/)
    expect(source).not.toContain("'/surveys/:id/results/next'")
    expect(source).not.toMatch(/element: <SurveyResultsPage \/>/)
  })

  it.each(['leader', 'supervisor', 'employee'])('sends a %s to /dashboard without fetching', async (role) => {
    renderAt({ role })
    expect(await screen.findByTestId('home')).toBeTruthy()
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('sends a super administrator with no company chosen to /dashboard', async () => {
    renderAt({ role: 'super_admin', companyId: '' })
    expect(await screen.findByTestId('home')).toBeTruthy()
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  /**
   * Three things the page this one replaced rendered and the artboard did not draw
   * — the artboard's survey had one scale question per dimension, in the reader's
   * language, with no open text. They are kept on the real route, and each case here
   * is the guarantee the swap must not lose (`docs/decisions/survey-results-route-swap.md`).
   */
  describe('what the replaced page rendered beyond the artboard', () => {
    it('says so when the content came back in a language the reader did not ask for', async () => {
      // An English reader, a Spanish-only survey: every field fell back, and the
      // reader is told before quoting a question they could not read.
      vi.mocked(fetch).mockImplementation(
        fetching({ ...payload(), language: 'es', resolvedLocale: 'es', fallbackFields: ['title'] }),
      )
      renderAt({ role: 'company_admin' })
      expect(await screen.findByText(en.surveyResults.languageNoticeTitle)).toBeTruthy()
      expect(screen.getByText(/Showing content in Spanish because it is not available in English/)).toBeTruthy()
      expect(screen.getByText(/1 individual fields fell back/)).toBeTruthy()
    })

    it('stays silent when the content is in the language that was asked for', async () => {
      renderAt({ role: 'company_admin' })
      await screen.findByRole('heading', { level: 1 })
      expect(screen.queryByText(en.surveyResults.languageNoticeTitle)).toBeNull()
    })

    it('gathers open text into one themes cloud, per language, and says what it withheld', async () => {
      vi.mocked(fetch).mockImplementation(fetching(withOpenText()))
      renderAt({ role: 'company_admin' })
      const themes = await screen.findByRole('region', { name: en.surveyResults.themesTitle })
      // Merged across the two questions: the only place "workload" reads 9.
      expect(within(themes).getByLabelText('workload, 9 occurrences')).toBeTruthy()
      // Spanish is counted apart — never folded into an English word.
      expect(within(themes).getByLabelText('horario, 3 occurrences')).toBeTruthy()
      expect(within(themes).getByText(/7 words are withheld/)).toBeTruthy()
    })

    it('keeps the themes section when every word fell under the word floor, and says so', async () => {
      // Withheld is not absent: the survey HAS an open-text question, so the section
      // stays and the withheld count is its content.
      const base = withOpenText()
      const allWithheld: SurveyAnalyticsResponse = {
        ...base,
        questions: [base.questions[0], base.questions[1], openQuestion('q3', 'What would you change?', 'culture', [], 9)],
      }
      vi.mocked(fetch).mockImplementation(fetching(allWithheld))
      renderAt({ role: 'company_admin' })
      const themes = await screen.findByRole('region', { name: en.surveyResults.themesTitle })
      expect(within(themes).getByText(/9 words are withheld/)).toBeTruthy()
    })

    it('renders no themes section for a survey with no open-text question', async () => {
      renderAt({ role: 'company_admin' })
      await screen.findByRole('heading', { level: 1 })
      expect(screen.queryByRole('region', { name: en.surveyResults.themesTitle })).toBeNull()
    })

    it('lists every question under the map, and narrows the list by type without a request', async () => {
      vi.mocked(fetch).mockImplementation(fetching(withOpenText()))
      renderAt({ role: 'company_admin' })
      const list = await screen.findByTestId('question-list')
      // Both scale questions and both open-ended ones: the open-ended pair has no
      // other on-screen surface, since the map is drawn from scale questions only.
      expect(within(list).getByText('Question q1')).toBeTruthy()
      expect(within(list).getByText('Question q2')).toBeTruthy()
      // `getAll`: an open-ended card names its question in the heading and again in
      // the cloud's own caption.
      expect(within(list).getAllByText(/What would you change\?/).length).toBeGreaterThan(0)
      expect(within(list).getAllByText(/Anything else\?/).length).toBeGreaterThan(0)
      const requests = vi.mocked(fetch).mock.calls.length

      await userEvent.selectOptions(screen.getByLabelText(en.surveyResults.filterType), 'open_ended')

      await waitFor(() => expect(within(screen.getByTestId('question-list')).queryByText('Question q1')).toBeNull())
      expect(within(screen.getByTestId('question-list')).getAllByText(/What would you change\?/).length).toBeGreaterThan(0)
      // Client side, over a payload the server already floored: no request, so no
      // filter can narrow the data below the floor.
      expect(vi.mocked(fetch).mock.calls.length).toBe(requests)
    })
  })
})
