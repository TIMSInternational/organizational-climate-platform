import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import MicroclimateCreatePage from './MicroclimateCreatePage'
import { TranslationProvider } from '../../../i18n'
import { LOCALE_STORAGE_KEY } from '../../../i18n/locale'
import { setToken, clearToken } from '../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../company-context'
import { tokenFor } from '../../../test/jwtFixture'

/**
 * #115's fourth acceptance criterion: **verified working in the microclimate
 * wizard** — the half the issue warns will be skipped ("verify in both before
 * closing, not just one").
 *
 * The sibling of `features/surveys/pages/SurveyCreatePage.library.test.tsx`, driving
 * the SAME component through the other wizard, and asserting the thing that differs:
 * a microclimate question shape has no dimension and no scale-end labels, so what
 * must arrive intact is the text, the type and the OPTIONS.
 */

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

/** A second item, so the multi-select half of the picker can be driven at all. */
const LIKERT_ROW = {
  id: 'lib-likert',
  companyId: null,
  questionCategoryId: 'cat-1',
  textEn: 'I know what is expected of me this week',
  textEs: 'Sé qué se espera de mí esta semana',
  type: 'likert',
  dimension: 'psychological_safety',
  usageCount: 2,
  lastUsedAt: null,
  isActive: true,
  version: 1,
  tags: ['clarity'],
}

const LIKERT_DETAIL = {
  ...LIKERT_ROW,
  language: 'both',
  scaleMin: 1,
  scaleMax: 5,
  scaleLabelMinEn: 'Never',
  scaleLabelMinEs: 'Nunca',
  scaleLabelMaxEn: 'Always',
  scaleLabelMaxEs: 'Siempre',
  previousVersionId: null,
  createdAt: '2026-05-02T09:00:00Z',
  updatedAt: '2026-05-02T09:00:00Z',
  options: [],
}

const posted: unknown[] = []

function routeFetch() {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'

    if (method === 'POST') {
      posted.push(JSON.parse(String(init?.body)))
      return Promise.resolve(new Response(JSON.stringify({ id: 'm-new' }), { status: 201 }))
    }
    if (url.includes('/microclimate-templates')) {
      return Promise.resolve(new Response(JSON.stringify({ templates: [] }), { status: 200 }))
    }
    if (url.includes('/admin/question-categories')) {
      return Promise.resolve(new Response(JSON.stringify({ categories: [] }), { status: 200 }))
    }
    if (url.endsWith('/admin/question-library/lib-choice')) {
      return Promise.resolve(new Response(JSON.stringify(DETAIL), { status: 200 }))
    }
    if (url.endsWith('/admin/question-library/lib-likert')) {
      return Promise.resolve(new Response(JSON.stringify(LIKERT_DETAIL), { status: 200 }))
    }
    if (url.includes('/admin/question-library')) {
      return Promise.resolve(
        new Response(JSON.stringify({ items: [LIST_ROW, LIKERT_ROW] }), { status: 200 }),
      )
    }
    return Promise.resolve(new Response('{}', { status: 200 }))
  })
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/microclimates/new']}>
        <CompanyContextProvider>
          <Routes>
            <Route path="/microclimates/new" element={<MicroclimateCreatePage />} />
            <Route path="/microclimates/:id" element={<p>Session page</p>} />
          </Routes>
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

function typeInto(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

async function press(name: string | RegExp) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}

async function reachQuestionsStep() {
  typeInto(/Title/, 'Team pulse')
  await press('Next')
  typeInto('Start Time', '2026-08-07T10:00')
  typeInto('End Time', '2026-08-07T10:20')
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

describe('the shared question picker, inside the microclimate wizard', () => {
  it('opens from the questions step and puts a picked question into the session', async () => {
    renderPage()
    await reachQuestionsStep()

    await press('Add from library')
    expect(await screen.findByText('How often do you meet your manager?')).toBeTruthy()

    await press(/Add "How often do you meet your manager\?"/)
    await press('Cancel')

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
    await press(/Create microclimate/i)

    await waitFor(() => expect(posted).toHaveLength(1))
    const body = posted[0] as { questions: { type: string; options?: { label: unknown }[] }[] }
    expect(body.questions[0].type).toBe('multiple_choice')
    // Two options, so `multiple_choice` clears the wizard's own minimum-of-two rule
    // and the server's. A picked question that arrived with none would have failed
    // the step it was added on.
    expect(body.questions[0].options).toEqual([{ label: 'Weekly' }, { label: 'Monthly' }])
  })

  /**
   * The microclimate half of acceptance criterion 2 — the half the issue warns will
   * be skipped.
   *
   * This page's `nextKey` is ref-backed, so calling it once per picked item is
   * correct where the survey wizard's closure-read `makeKey` would not be. That is a
   * claim about a counter nothing tested: every other test here adds ONE question, and
   * one item cannot collide with itself. `onChange` here rebuilds the question list by
   * matching `candidate.key === question.key`, so two questions sharing a key means a
   * keystroke in one card rewrites both.
   */
  it('gives each question of one multi-add its own key, so editing one leaves the other alone', async () => {
    renderPage()
    await reachQuestionsStep()

    await press('Add from library')
    await screen.findByText(LIST_ROW.textEn)
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: LIST_ROW.textEn }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: LIKERT_ROW.textEn }))
    })
    await press('Add 2 selected')

    const texts = () =>
      screen
        .getAllByLabelText(/Question Text/i)
        .map((field) => (field as HTMLInputElement).value)

    await waitFor(() => expect(texts()).toEqual([LIST_ROW.textEn, LIKERT_ROW.textEn]))

    await act(async () => {
      fireEvent.change(screen.getAllByLabelText(/Question Text/i)[0], {
        target: { value: 'Rewritten by the author' },
      })
    })

    expect(texts()).toEqual(['Rewritten by the author', LIKERT_ROW.textEn])
  })
})
