import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { TranslationProvider } from '../../../../i18n'
import { setToken, clearToken } from '../../../../auth/token'
import { CompanyContextProvider } from '../../../../company-context'
import { tokenFor } from '../../../../test/jwtFixture'
import { getSurveyQuestionAuthoring, saveSurveyQuestions, type AuthoringQuestion } from '../../api/surveyQuestionAuthoring'
import { duplicateSurvey, getSurvey, type SurveyDetail } from '../../api/surveys'
import { getSurveyTemplate, instantiateSurveyTemplate, type SurveyTemplateDetail } from '../../api/surveyTemplates'
import SurveyQuestionsEditorPage from './SurveyQuestionsEditorPage'
import TemplateDetailNextPage from './TemplateDetailNextPage'
import { compatibleScaleTypes, isEditable, moveQuestion } from './model'
import type { QuestionLibraryItemDetail } from '../../../questions/api/questionLibrary'
import en from '../../../../i18n/en.json'

vi.mock('../../api/surveyQuestionAuthoring', async (orig) => ({
  ...(await orig<typeof import('../../api/surveyQuestionAuthoring')>()),
  getSurveyQuestionAuthoring: vi.fn(),
  saveSurveyQuestions: vi.fn(),
}))
vi.mock('../../api/surveys', async (orig) => ({
  ...(await orig<typeof import('../../api/surveys')>()),
  getSurvey: vi.fn(),
  duplicateSurvey: vi.fn(),
}))
vi.mock('../../api/surveyTemplates', async (orig) => ({
  ...(await orig<typeof import('../../api/surveyTemplates')>()),
  getSurveyTemplate: vi.fn(),
  instantiateSurveyTemplate: vi.fn(),
}))
vi.mock('../../../../company-context/useCompanyName', () => ({
  useCompanyName: () => 'Grupo Meridiano S.A.',
  clearCompanyNameCache: () => {},
}))

// The browser fetches the library itself (its own tests cover that); here it is only the seam
// the editor hands a pick through. Options arrive out of order on purpose.
const { LIBRARY_PICK } = vi.hoisted(() => ({
  LIBRARY_PICK: {
    id: 'lib1', companyId: null, questionCategoryId: 'lead', textEn: 'How often do you get feedback?', textEs: '¿Con qué frecuencia recibe retroalimentación?',
    type: 'multiple_choice', dimension: 'trust', usageCount: 0, lastUsedAt: null, isActive: true, version: 1, tags: [], language: 'both',
    scaleMin: null, scaleMax: null, scaleLabelMinEn: null, scaleLabelMinEs: null, scaleLabelMaxEn: null, scaleLabelMaxEs: null,
    previousVersionId: null, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
    options: [
      { order: 1, value: 'weekly-key', labelEn: 'Weekly', labelEs: 'Semanal' },
      { order: 0, value: 'daily-key', labelEn: 'Daily', labelEs: 'Diario' },
    ],
  } as QuestionLibraryItemDetail,
}))
vi.mock('../../../../components/questions', () => ({
  QuestionLibraryBrowser: ({ open, onAdd }: { open: boolean; onAdd: (items: QuestionLibraryItemDetail[]) => void }) =>
    open ? (
      <button type="button" onClick={() => onAdd([LIBRARY_PICK])}>
        pick-from-library
      </button>
    ) : null,
}))

const a = en.surveys.next.authoring
const tp = en.surveys.next.template
const COMPANY = 'c1'

function q(order: number, textEn: string, category: string | null = 'trust'): AuthoringQuestion {
  const both = (en: string, es: string) => ({ en: { text: en, authored: true }, es: { text: es, authored: true } })
  return {
    id: `q${order}`, type: 'likert', order, category, required: true, commentRequired: false, scaleMin: 1, scaleMax: 5,
    text: both(textEn, `${textEn} (es)`), scaleLabelMin: both('Strongly disagree', 'Muy en desacuerdo'),
    scaleLabelMax: both('Strongly agree', 'Muy de acuerdo'), commentPrompt: { en: { text: '', authored: false }, es: { text: '', authored: false } }, options: null,
  }
}

function arrangeSurvey(status: string, responseCount: number) {
  vi.mocked(getSurveyQuestionAuthoring).mockResolvedValue({ surveyId: 's1', title: 'Q4', language: 'both', status, locales: ['en', 'es'], questions: [q(0, 'First'), q(1, 'Second', 'workload')] })
  vi.mocked(getSurvey).mockResolvedValue({ id: 's1', title: 'Q4 Climate Survey', description: 'Wave five', type: 'periodic', status, responseCount, targetAudienceCount: 24, startDate: '2026-09-03T12:00:00Z', endDate: '2026-10-10T12:00:00Z' } as SurveyDetail)
}

function renderAt(path: string, role = 'company_admin') {
  setToken(tokenFor({ sub: 'u1', nodoId: '', role, companyId: COMPANY }))
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={[path]}>
        <CompanyContextProvider>
          <Routes>
            <Route path="/surveys/:id/questions" element={<SurveyQuestionsEditorPage />} />
            <Route path="/surveys/templates/:id" element={<TemplateDetailNextPage />} />
            <Route path="/surveys/:id" element={<p>survey-detail-sink</p>} />
          </Routes>
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

afterEach(() => {
  cleanup()
  clearToken()
  vi.clearAllMocks()
})

describe('authoring model', () => {
  it('is editable only as a draft or scheduled survey with no response at all', () => {
    expect(isEditable('draft', 0)).toBe(true)
    expect(isEditable('scheduled', 0)).toBe(true)
    expect(isEditable('draft', 1)).toBe(false)
    expect(isEditable('active', 0)).toBe(false)
  })

  it('renumbers order after a move, because the PUT carries order', () => {
    const moved = moveQuestion([q(0, 'A'), q(1, 'B'), q(2, 'C')], 0, 2)
    expect(moved.map((x) => [x.id, x.order])).toEqual([['q1', 0], ['q2', 1], ['q0', 2]])
  })
})

describe('SurveyQuestionsEditorPage — draft', () => {
  it('saves only the questions, in their new order, after a move', async () => {
    arrangeSurvey('draft', 0)
    vi.mocked(saveSurveyQuestions).mockResolvedValue()
    renderAt('/surveys/s1/questions')
    await userEvent.click(await screen.findByRole('button', { name: a.moveDown }))
    await userEvent.click(screen.getByRole('button', { name: a.save }))
    const sent = vi.mocked(saveSurveyQuestions).mock.calls[0][2]
    expect(sent.map((x) => [x.id, x.order])).toEqual([['q1', 0], ['q0', 1]])
    expect(await screen.findByText('survey-detail-sink')).toBeTruthy()
    expect(screen.queryByTestId('locked-banner')).toBeNull()
  })

  it('summarises dimensions and required questions from the list', async () => {
    arrangeSurvey('draft', 0)
    renderAt('/surveys/s1/questions')
    const summary = await screen.findByTestId('questions-summary')
    expect(summary.textContent).toBe(`${a.dimensionsCount.replace('{count}', '2')} · ${a.requiredCount.replace('{count}', '2')} · ${a.bilingual}`)
  })
})

describe('SurveyQuestionsEditorPage — locked', () => {
  it('reads as locked once a response exists, and duplicates into an editable copy', async () => {
    arrangeSurvey('active', 1)
    vi.mocked(duplicateSurvey).mockResolvedValue({ id: 'copy1' } as SurveyDetail)
    renderAt('/surveys/s1/questions')
    const banner = await screen.findByTestId('locked-banner')
    expect(within(banner).getByText(a.lockedHasResponses)).toBeTruthy()
    expect(banner.textContent).toContain(a.arrivedOneOf.replace('{target}', '24'))
    expect(screen.queryByRole('button', { name: a.save })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: a.duplicateAndEdit }))
    expect(vi.mocked(duplicateSurvey).mock.calls[0][1]).toBe('s1')
    await waitFor(() => expect(vi.mocked(getSurveyQuestionAuthoring).mock.calls.some((call) => call[1] === 'copy1')).toBe(true))
  })

  it('offers a leader nothing to duplicate', async () => {
    arrangeSurvey('active', 1)
    renderAt('/surveys/s1/questions', 'leader')
    await screen.findByTestId('locked-banner')
    expect(screen.queryByRole('button', { name: a.duplicateAndEdit })).toBeNull()
  })
})

describe('TemplateDetailNextPage', () => {
  function template(lang: string): SurveyTemplateDetail {
    const text = (en: string, es: string) => (lang === 'es' ? es : en)
    return {
      id: 't1', name: text('Standard instrument', 'Instrumento estándar'), description: '', category: 'climate', industry: null, companySize: null,
      isPublic: true, companyId: COMPANY, isGlobal: false, tags: [], usageCount: 0, rating: 0, language: 'both', resolvedLocale: lang, fallbackFields: [],
      questions: [
        { id: 'a', text: text('I feel safe', 'Me siento seguro'), type: 'likert', options: null, scaleMin: 1, scaleMax: 5, scaleLabelMin: text('Strongly disagree', 'Muy en desacuerdo'), scaleLabelMax: text('Strongly agree', 'Muy de acuerdo'), required: true, commentRequired: false, commentPrompt: null, order: 0, category: 'psychological_safety' },
        { id: 'b', text: text('My workload is fine', 'Mi carga está bien'), type: 'likert', options: null, scaleMin: 1, scaleMax: 5, scaleLabelMin: null, scaleLabelMax: null, required: true, commentRequired: false, commentPrompt: null, order: 1, category: 'workload' },
      ],
      sourceSurveyId: null, lastUsed: null, createdAt: '2026-09-09T12:00:00Z', updatedAt: '2026-09-09T12:00:00Z',
    }
  }

  it('shows each question in both authored languages and uses the template into its questions', async () => {
    vi.mocked(getSurveyTemplate).mockImplementation(async (_b, _id, lang) => template(lang ?? 'en'))
    vi.mocked(instantiateSurveyTemplate).mockResolvedValue({ id: 's9' } as SurveyDetail)
    renderAt('/surveys/templates/t1')
    const rows = await screen.findAllByTestId('template-question')
    expect(rows[0].textContent).toContain('I feel safe')
    expect(rows[0].textContent).toContain('Me siento seguro')
    expect(screen.getByTestId('scale-strip').textContent).toContain(tp.allRequired)
    await userEvent.click(screen.getByRole('button', { name: tp.use }))
    expect(vi.mocked(instantiateSurveyTemplate).mock.calls[0][2]).toEqual({ companyId: COMPANY })
    await waitFor(() => expect(vi.mocked(getSurveyQuestionAuthoring).mock.calls.some((call) => call[1] === 's9')).toBe(true))
  })

  it('prints the short scale name on the chip and in the Ficha, as the board does', async () => {
    vi.mocked(getSurveyTemplate).mockImplementation(async (_b, _id, lang) => template(lang ?? 'en'))
    renderAt('/surveys/templates/t1')
    await screen.findAllByTestId('template-question')
    expect(screen.getByText(`${a.scaleName.likert} 1–5`)).toBeTruthy()
    expect(screen.getByText(tp.scaleFact.replace('{type}', a.scaleName.likert).replace('{min}', '1').replace('{max}', '5').replace('{count}', '2'))).toBeTruthy()
  })

  it('offers a leader no way to use a template', async () => {
    vi.mocked(getSurveyTemplate).mockImplementation(async (_b, _id, lang) => template(lang ?? 'en'))
    renderAt('/surveys/templates/t1', 'leader')
    await screen.findAllByTestId('template-question')
    expect(screen.queryByRole('button', { name: tp.use })).toBeNull()
  })

  it("sets the two columns and the Ficha / 'Al usarla' stack 16px apart, under 20px headings", async () => {
    vi.mocked(getSurveyTemplate).mockImplementation(async (_b, _id, lang) => template(lang ?? 'en'))
    renderAt('/surveys/templates/t1')
    await screen.findAllByTestId('template-question')
    // TemplateDetail.dc.html: `minmax(0, 1fr) 360px; gap: 16px` and a 16px column; happy-dom has no
    // layout, so the classes are the pin and template-light.png is the evidence.
    expect(screen.getByTestId('template-columns').className.split(' ')).toContain('gap-4')
    expect(screen.getByTestId('template-aside').className.split(' ')).toContain('gap-4')
    expect(screen.getByRole('heading', { name: tp.facts }).className.split(' ')).toContain('text-2xl')
  })
})

describe('SurveyQuestionsEditorPage — scale, library and dimension check', () => {
  it('offers a non-scaled question no scale change at all', () => {
    expect(compatibleScaleTypes({ type: 'open_ended', scaleMin: null, scaleMax: null })).toEqual(['open_ended'])
    expect(compatibleScaleTypes({ type: 'likert', scaleMin: 1, scaleMax: 5 })).toEqual(['likert', 'rating'])
  })

  it("offers the Escala select only the scaled types at the question's own range, and saves the change", async () => {
    arrangeSurvey('draft', 0)
    vi.mocked(saveSurveyQuestions).mockResolvedValue()
    renderAt('/surveys/s1/questions')
    const select = (await screen.findAllByRole('combobox')).find((el) => (el as HTMLSelectElement).value === 'likert') as HTMLSelectElement
    expect([...select.options].map((o) => o.value)).toEqual(['likert', 'rating'])
    await userEvent.selectOptions(select, 'rating')
    await userEvent.click(screen.getByRole('button', { name: a.save }))
    const sent = vi.mocked(saveSurveyQuestions).mock.calls[0][2]
    expect([sent[0].type, sent[0].scaleMin, sent[0].scaleMax]).toEqual(['rating', 1, 5])
    expect(sent[1].type).toBe('likert')
  })

  it("adds a library question with each option's stored key, in the library's order, and saves it", async () => {
    arrangeSurvey('draft', 0)
    vi.mocked(saveSurveyQuestions).mockResolvedValue()
    renderAt('/surveys/s1/questions')
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(`^${a.addQuestion}`) }))
    await userEvent.click(screen.getByRole('button', { name: 'pick-from-library' }))
    expect(screen.getAllByTestId('question-card')).toHaveLength(3)
    await userEvent.click(screen.getByRole('button', { name: a.save }))
    const added = vi.mocked(saveSurveyQuestions).mock.calls[0][2][2]
    expect(added.options?.map((o) => o.value)).toEqual(['daily-key', 'weekly-key'])
    expect(added.text.es).toEqual({ text: '¿Con qué frecuencia recibe retroalimentación?', authored: true })
    expect([added.type, added.category, added.order]).toEqual(['multiple_choice', 'trust', 2])
  })

  it('still adds a blank question beside the library', async () => {
    arrangeSurvey('draft', 0)
    renderAt('/surveys/s1/questions')
    await userEvent.click(await screen.findByRole('button', { name: a.addBlankLink }))
    expect(screen.getAllByTestId('question-card')).toHaveLength(3)
  })

  it('ticks when every dimension still has a question, and names the one a removal emptied', async () => {
    arrangeSurvey('draft', 0)
    renderAt('/surveys/s1/questions')
    expect((await screen.findByTestId('dimension-check')).textContent).toBe(a.everyDimensionCovered)
    // The open question is q0, the only 'trust' question; q1 ('workload') stays.
    await userEvent.click(screen.getByRole('button', { name: a.remove }))
    const check = screen.getByTestId('dimension-check').textContent ?? ''
    expect(check.startsWith(a.dimensionsWithout.split('{')[0])).toBe(true)
    expect(check).not.toBe(a.everyDimensionCovered)
    // It names the dimension the removal emptied, and only that one.
    expect(check).toContain(en.surveyRespond.dimensions.trust)
    expect(check).not.toContain(en.surveyRespond.dimensions.workload)
  })

  it('centres every toggle with the buttons beside it — no label margin in the row', async () => {
    arrangeSurvey('draft', 0)
    renderAt('/surveys/s1/questions')
    const switches = await screen.findAllByRole('switch')
    for (const control of switches) expect(control.closest('label')?.className.split(' ')).toContain('mb-0')
  })

  it('prints the short scale name on the chips, as the board does', async () => {
    arrangeSurvey('active', 1)
    renderAt('/surveys/s1/questions')
    const cards = await screen.findAllByTestId('question-card')
    expect(within(cards[0]).getByText(`${a.scaleName.likert} 1–5`)).toBeTruthy()
  })
})

// The boards' spacing, inks and type (SurveyQuestionsEditor / …Locked .dc.html). happy-dom has no
// layout: the classes are the pin, and draft-light.png / locked-light.png are the evidence.
describe('SurveyQuestionsEditorPage — the boards\' spacing, inks and type', () => {
  it('sets the two columns and the preview stack 16px apart, and rules the save note off under a full-width hairline', async () => {
    arrangeSurvey('draft', 0)
    renderAt('/surveys/s1/questions')
    const columns = await screen.findByTestId('editor-columns')
    expect(columns.className.split(' ')).toContain('gap-4')
    expect(screen.getByTestId('editor-aside').className.split(' ')).toContain('gap-4')
    const note = screen.getByTestId('save-note')
    expect(note.textContent).toBe(a.saveWritesOnly)
    expect(note.className.split(' ')).toEqual(expect.arrayContaining(['mt-5', 'border-t', 'pt-4']))
    // Full width: a sibling of the columns, not inside either one.
    expect(columns.contains(note)).toBe(false)
  })

  it('sets every question field without the 12px margin index.css gives a <label>', async () => {
    arrangeSurvey('draft', 0)
    renderAt('/surveys/s1/questions')
    const card = (await screen.findAllByTestId('question-card'))[0]
    const fields = [...card.querySelectorAll('label')].filter((label) => label.className.split(' ').includes('flex-col'))
    expect(fields.length).toBeGreaterThanOrEqual(4)
    for (const field of fields) {
      // …nor the 4px index.css puts above a label's own control (index.css:252-258): the board sets
      // the control 6px under its label, the field's gap and nothing more.
      expect(field.className.split(' ')).toEqual(expect.arrayContaining(['mb-0', 'gap-1.5', '[&>input]:mt-0', '[&>select]:mt-0', '[&>textarea]:mt-0']))
    }
  })

  it("prints the add row's tail at 12px in the tertiary ink after the 13px label", async () => {
    arrangeSurvey('draft', 0)
    renderAt('/surveys/s1/questions')
    const tail = await screen.findByTestId('add-tail')
    expect(tail.textContent).toBe(a.addFromLibrary)
    expect(tail.className.split(' ')).toEqual(expect.arrayContaining(['text-sm', 'font-normal', 'text-fg-tertiary']))
  })

  it("prints the boards' type: 20px card headings, 13px question text, 12px hints in the tertiary ink", async () => {
    arrangeSurvey('draft', 0)
    renderAt('/surveys/s1/questions')
    const card = (await screen.findAllByTestId('question-card'))[0]
    expect(screen.getByRole('heading', { name: new RegExp(`^${a.questions}`) }).className.split(' ')).toContain('text-2xl')
    expect(screen.getByRole('heading', { name: a.preview }).className.split(' ')).toContain('text-2xl')
    expect(within(card).getByText(/^First/, { selector: 'p' }).className.split(' ')).toContain('text-base')
    expect(screen.getByText(a.dimensionHint).className.split(' ')).toEqual(expect.arrayContaining(['text-sm', 'text-fg-tertiary']))
  })

  it('paints the locked banner on the ground tint under a white tile, 20px above the panels', async () => {
    arrangeSurvey('active', 1)
    renderAt('/surveys/s1/questions')
    const banner = await screen.findByTestId('locked-banner')
    const classes = banner.className.split(' ')
    expect(classes).toEqual(expect.arrayContaining(['bg-surface-outer', 'mb-5']))
    expect(classes).not.toContain('bg-surface-card')
    const tile = banner.querySelector('[data-tone]')
    expect(tile?.getAttribute('data-tone')).toBe('card')
  })
})
