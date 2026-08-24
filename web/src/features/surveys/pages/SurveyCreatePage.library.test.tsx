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

/**
 * A second item, and deliberately one whose scale is NOT the product default: an eNPS
 * question is answered 0–10, and `respondAnswers.ts` reads a null bound as 1–5.
 */
const LIKERT_ROW = {
  id: 'lib-likert',
  companyId: null,
  questionCategoryId: 'cat-1',
  textEn: 'How likely are you to recommend working here?',
  textEs: '¿Qué tan probable es que recomiendes trabajar aquí?',
  type: 'likert',
  dimension: 'psychological_safety',
  usageCount: 2,
  lastUsedAt: null,
  isActive: true,
  version: 1,
  tags: ['enps'],
}

const LIKERT_DETAIL = {
  ...LIKERT_ROW,
  language: 'both',
  scaleMin: 0,
  scaleMax: 10,
  scaleLabelMinEn: 'Not at all likely',
  scaleLabelMinEs: 'Nada probable',
  scaleLabelMaxEn: 'Extremely likely',
  scaleLabelMaxEs: 'Extremadamente probable',
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
    if (url.endsWith('/admin/question-library/lib-likert')) {
      return Promise.resolve(new Response(JSON.stringify(LIKERT_DETAIL), { status: 200 }))
    }
    if (url.includes('/admin/question-library')) {
      return Promise.resolve(
        new Response(JSON.stringify({ items: [LIST_ROW, LIKERT_ROW] }), { status: 200 }),
      )
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

  /**
   * The scale is one fact, and half of it is worse than none.
   *
   * An eNPS item is authored 0–10. The wizard collected its four scale-END WORDS from
   * the day the picker shipped and dropped the two BOUNDS, and a dropped bound is not
   * absent: `respondAnswers.ts` answers null with `DEFAULT_SCALE_MIN`/`MAX` (1 and 5)
   * and `SurveyAnswerValidation` does the same server-side. So the survey went out as
   * a five-point scale still labelled "Not at all likely … Extremely likely", every
   * answer stored against a scale nobody chose, and nothing anywhere said so.
   *
   * Asserted on the POST body rather than on the mapper, because the drop could have
   * happened at either of two places — `questionFromLibrary` not carrying them, or
   * `buildCreateInput` not sending them — and the wizard is only correct if neither
   * does.
   */
  it('sends the picked scale BOUNDS, not just the words at its ends', async () => {
    renderPage()
    await reachQuestionsStep()

    await press('Add from library')
    await screen.findByText(LIKERT_ROW.textEn)
    await press(/Add "How likely are you to recommend working here\?"/)
    await press('Cancel')
    await waitFor(() => expect(screen.getByLabelText(/Question Text/i)).toBeTruthy())

    // Visible on the card too: nothing in this wizard edits a bound, so without a
    // line naming it the difference between a 1–5 question and a 0–10 one is
    // invisible while its words sit in the boxes underneath.
    expect(screen.getByText(/Answered on a 0–10 scale/)).toBeTruthy()

    await press('Next')
    await press(/Create survey/i)

    await waitFor(() => expect(posted).toHaveLength(1))
    const body = posted[0] as {
      questions: {
        scaleMin?: number
        scaleMax?: number
        scaleLabelMin?: unknown
        scaleLabelMax?: unknown
      }[]
    }
    expect(body.questions[0].scaleMin).toBe(0)
    expect(body.questions[0].scaleMax).toBe(10)
    // The words that made the drop invisible, still there — the point is that both
    // halves travel, not that one replaced the other.
    expect(body.questions[0].scaleLabelMin).toBe('Not at all likely')
    expect(body.questions[0].scaleLabelMax).toBe('Extremely likely')
  })

  /**
   * Acceptance criterion 2 is multi-SELECT, and multi-select is the only path in this
   * wizard that mints more than one React key in a single event.
   *
   * `takeKeys` exists for that and says why in its own docstring: `makeKey()` reads
   * `nextKey` out of the render closure, so N calls in one handler all return the
   * same string. A shared key is not merely a React warning here — `patchQuestion`
   * finds a question BY KEY, so every edit to one card lands on all of its twins, and
   * the card an author is typing into is not the only card changing.
   *
   * Driving the wizard with one picked item can never see it, which is why every
   * other test in this file could pass with `takeKeys` returning the same key twice.
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
