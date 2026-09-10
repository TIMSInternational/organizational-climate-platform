import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import SurveyResultsNextPage from './SurveyResultsNextPage'
import { TranslationProvider } from '../../../i18n'
import { CompanyContextProvider } from '../../../company-context'
import { setToken } from '../../../auth/token'
import { tokenFor } from '../../../test/jwtFixture'
import { downloadBlobFile } from '../../../lib/downloadBlobFile'
import type { SurveyAnalyticsResponse, SurveyQuestionResult, SurveySegmentResult } from '../api/surveyResults'
import en from '../../../i18n/en.json'

vi.mock('../../../lib/downloadBlobFile', () => ({ downloadBlobFile: vi.fn() }))

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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

function renderAt(claims: Record<string, unknown>) {
  setToken(tokenFor({ sub: 'u1', companyId: 'c1', nodoId: '', ...claims }))
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/surveys/s1/results/next']}>
        <CompanyContextProvider>
          <Routes>
            <Route path="/surveys/:id/results/next" element={<SurveyResultsNextPage />} />
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
    expect(screen.getByRole('heading', { level: 2, name: new RegExp(copy.whereHeading) })).toBeTruthy()
    const findings = screen.getAllByRole('listitem').filter((item) => within(item).queryByText(copy.viewQuestion))
    expect(findings.length).toBeGreaterThan(0)
    expect(findings[0].textContent).toContain('Operaciones')
    expect(findings[0].textContent).toContain('2.4')
    expect(within(findings[0]).getByText(copy.planCovers)).toBeTruthy()

    // The sample chip is on the page: the deltas are not a measurement yet.
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
})
