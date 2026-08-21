import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import SurveyCreatePage from './SurveyCreatePage'
import { TranslationProvider } from '../../../i18n'
import { LOCALE_STORAGE_KEY } from '../../../i18n/locale'
import { setToken, clearToken } from '../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../company-context'

/**
 * #115's third acceptance criterion: **verified working in the survey wizard.**
 *
 * A separate file from `SurveyCreatePage.test.tsx` because that one drives the
 * autosave feature under `vi.useFakeTimers()`, and the picker's own awaits are real
 * promises off real fetches. Mixing the two would make each test's failure mode the
 * other's timer configuration.
 *
 * What is asserted is the whole path, not the seam: open the library from the
 * questions step, pick a multiple-choice item, and find its OPTIONS on the POST body
 * — options that exist nowhere in the list projection the picker first reads.
 */

function tokenFor(claims: Record<string, unknown>): string {
  const body = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `header.${body}.signature`
}

const LIST_ROW = {
  id: 'lib-choice',
  companyId: null,
  questionCategoryId: 'cat-1',
  textEn: 'How often do you meet your manager?',
  textEs: '¿Con qué frecuencia te reúnes con tu jefe?',
  type: 'multiple_choice',
  dimension: 'psychological_safety',
  usageCount: 5,
  lastUsedAt: null,
  isActive: true,
  version: 1,
  tags: ['cadence'],
}

/** Only the DETAIL carries options. That asymmetry is the point of this test. */
const DETAIL = {
  ...LIST_ROW,
  language: 'both',
  scaleMin: null,
  scaleMax: null,
  scaleLabelMinEn: null,
  scaleLabelMinEs: null,
  scaleLabelMaxEn: null,
  scaleLabelMaxEs: null,
  previousVersionId: null,
  createdAt: '2026-05-02T09:00:00Z',
  updatedAt: '2026-05-02T09:00:00Z',
  options: [
    { order: 0, value: 'weekly', labelEn: 'Weekly', labelEs: 'Semanalmente' },
    { order: 1, value: 'monthly', labelEn: 'Monthly', labelEs: 'Mensualmente' },
  ],
}

const posted: unknown[] = []

function routeFetch() {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'

    // `createSurvey` appends `?lang=`, so an `endsWith('/surveys')` match silently
    // never fires and the POST body is never captured.
    if (method === 'POST' && /\/surveys(\?|$)/.test(url)) {
      posted.push(JSON.parse(String(init?.body)))
      return Promise.resolve(new Response(JSON.stringify({ id: 's-new' }), { status: 201 }))
    }
    if (url.includes('/surveys/drafts/latest')) {
      return Promise.resolve(new Response(JSON.stringify({ draft: null }), { status: 200 }))
    }
    if (url.includes('/admin/question-categories')) {
      return Promise.resolve(new Response(JSON.stringify({ categories: [] }), { status: 200 }))
    }
    if (url.endsWith('/admin/question-library/lib-choice')) {
      return Promise.resolve(new Response(JSON.stringify(DETAIL), { status: 200 }))
    }
    if (url.includes('/admin/question-library')) {
      return Promise.resolve(new Response(JSON.stringify({ items: [LIST_ROW] }), { status: 200 }))
    }
    if (url.includes('/admin/departments')) {
      return Promise.resolve(new Response(JSON.stringify({ departments: [] }), { status: 200 }))
    }
    if (url.includes('/survey-templates')) {
      return Promise.resolve(new Response(JSON.stringify({ templates: [] }), { status: 200 }))
    }
    return Promise.resolve(new Response('{}', { status: 200 }))
  })
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/surveys/new']}>
        <CompanyContextProvider>
          <Routes>
            <Route path="/surveys/new" element={<SurveyCreatePage />} />
            <Route path="/surveys/:id" element={<p>Survey page</p>} />
          </Routes>
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

async function typeInto(label: RegExp, value: string) {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
  })
}

async function press(name: string | RegExp) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}

/** Basics and schedule, the only two steps that gate reaching the questions step. */
async function reachQuestionsStep() {
  await typeInto(/^Title/, 'Q3 climate')
  await press('Next')
  await typeInto(/Start Date/, '2026-09-01T09:00')
  await typeInto(/End Date/, '2026-09-15T17:00')
  await press('Next')
  await press('Next')
}

beforeEach(() => {
  localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
  setToken(tokenFor({ role: 'company_admin', companyId: 'company-1' }))
  posted.length = 0
  vi.stubGlobal('fetch', vi.fn())
  routeFetch()
})

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('the shared question picker, inside the survey wizard', () => {
  it('opens from the questions step and puts a picked question into the draft', async () => {
    renderPage()
    await reachQuestionsStep()

    await press('Add from library')
    expect(await screen.findByText('How often do you meet your manager?')).toBeTruthy()

    await press(/Add "How often do you meet your manager\?"/)
    // Quick-add deliberately leaves the library open, so close it before reading the
    // wizard behind it.
    await press('Cancel')

    // The question is now an editable card in the wizard, with the library's text in
    // the wizard's own field.
    await waitFor(() =>
      expect((screen.getByLabelText(/Question Text/i) as HTMLInputElement).value).toBe(
        'How often do you meet your manager?',
      ),
    )
  })

  it('sends the library options on the POST, which the list projection never carried', async () => {
    renderPage()
    await reachQuestionsStep()

    await press('Add from library')
    await screen.findByText('How often do you meet your manager?')
    await press(/Add "How often do you meet your manager\?"/)
    await press('Cancel')
    await waitFor(() => expect(screen.getByLabelText(/Question Text/i)).toBeTruthy())

    await press('Next')
    await press(/Create survey/i)

    await waitFor(() => expect(posted).toHaveLength(1))
    const body = posted[0] as { questions: { options?: { label: unknown }[]; category?: string }[] }
    expect(body.questions[0].options).toEqual([
      { label: 'Weekly' },
      { label: 'Monthly' },
    ])
    // And the library's dimension arrives as the raw category key the climate map
    // groups on.
    expect(body.questions[0].category).toBe('psychological_safety')
  })
})
