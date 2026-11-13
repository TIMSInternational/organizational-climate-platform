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
import {
  applyAnswerLabels,
  canLabelAnswers,
  compatibleScaleTypes,
  hasAnswerLabels,
  isEditable,
  isTextEditable,
  moveQuestion,
  questionsMissingAnswerLabels,
  setAnswerLabel,
  withAnswerLabels,
  withoutAnswerLabels,
} from './model'
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
  vi.mocked(getSurvey).mockResolvedValue({ id: 's1', companyId: COMPANY, title: 'Q4 Climate Survey', description: 'Wave five', type: 'periodic', status, responseCount, targetAudienceCount: 24, startDate: '2026-09-03T12:00:00Z', endDate: '2026-10-10T12:00:00Z' } as SurveyDetail)
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

  it('lets a super admin edit the questions of an ACTIVE survey nobody has answered, and nothing more (ruled 2026-11-11)', () => {
    expect(isEditable('active', 0, true)).toBe(true)
    expect(isEditable('active', 1, true)).toBe(false)
    expect(isEditable('closed', 0, true)).toBe(false)
    expect(isEditable('archived', 0, true)).toBe(false)
    expect(isEditable('active', 0, false)).toBe(false)
  })

  it('offers the name and description to anyone on an unanswered draft, and past draft to a super admin until archived', () => {
    expect(isTextEditable('draft', 0, false)).toBe(true)
    expect(isTextEditable('draft', 1, true)).toBe(false)
    expect(isTextEditable('active', 0, false)).toBe(false)
    expect(isTextEditable('active', 12, true)).toBe(true)
    expect(isTextEditable('scheduled', 0, true)).toBe(true)
    expect(isTextEditable('closed', 239, true)).toBe(true)
    expect(isTextEditable('archived', 0, true)).toBe(false)
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

  it('stays locked for the client administrator on an active survey nobody has answered', async () => {
    arrangeSurvey('active', 0)
    renderAt('/surveys/s1/questions', 'company_admin')
    await screen.findByTestId('locked-banner')
    expect(screen.queryByRole('button', { name: a.save })).toBeNull()
    expect(screen.queryByTestId('live-banner')).toBeNull()
  })

  it('offers a leader nothing to duplicate', async () => {
    arrangeSurvey('active', 1)
    renderAt('/surveys/s1/questions', 'leader')
    await screen.findByTestId('locked-banner')
    expect(screen.queryByRole('button', { name: a.duplicateAndEdit })).toBeNull()
  })
})

describe('SurveyQuestionsEditorPage — a TIMS operator on a live survey (ruled 2026-11-11)', () => {
  it('edits an active survey nobody has answered, after saying the change is live', async () => {
    arrangeSurvey('active', 0)
    vi.mocked(saveSurveyQuestions).mockResolvedValue()
    renderAt('/surveys/s1/questions', 'super_admin')
    const banner = await screen.findByTestId('live-banner')
    expect(banner.textContent).toBe(a.liveEdit.replace('{status}', en.surveys.statusActive.toLowerCase()))
    expect(screen.getByText(a.descriptionLive)).toBeTruthy()
    expect(screen.queryByText(a.descriptionDraft)).toBeNull()
    expect(screen.queryByTestId('locked-banner')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: a.moveDown }))
    await userEvent.click(screen.getByRole('button', { name: a.save }))
    expect(vi.mocked(saveSurveyQuestions).mock.calls[0][2].map((x) => x.id)).toEqual(['q1', 'q0'])
  })

  it('is locked for the operator too once anybody has answered', async () => {
    arrangeSurvey('active', 1)
    renderAt('/surveys/s1/questions', 'super_admin')
    const banner = await screen.findByTestId('locked-banner')
    expect(within(banner).getByText(a.lockedHasResponses)).toBeTruthy()
    expect(screen.queryByTestId('live-banner')).toBeNull()
    expect(screen.queryByRole('button', { name: a.save })).toBeNull()
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

// «Cómo se ven las respuestas» (TIMS, 2026-11-13): PROCOMER's demo showed a row of numbers where
// ESPH had shown a list of words, and the editor offered no way to choose. A list is an option set
// whose values are the points -- what ESPH's workbook import wrote -- so the answers stay "1".."5".
describe('SurveyQuestionsEditorPage — answers as a list in words', () => {
  const both = (en: string, es: string) => ({ en: { text: en, authored: true }, es: { text: es, authored: true } })
  const blankLabel = { en: { text: '', authored: false }, es: { text: '', authored: false } }
  const FREQUENCY = [
    ['Never', 'Nunca'],
    ['Rarely', 'Casi nunca'],
    ['Sometimes', 'Algunas veces'],
    ['Often', 'Casi siempre'],
    ['Always', 'Siempre'],
  ] as const
  const labelled = (order: number): AuthoringQuestion => ({
    ...q(order, `Labelled ${order}`),
    scaleLabelMin: both('Never', 'Nunca'),
    scaleLabelMax: both('Always', 'Siempre'),
    options: FREQUENCY.map(([enText, esText], i) => ({ value: String(i + 1), label: both(enText, esText) })),
  })

  it('offers words only to a short numeric scale whose answers are its points', () => {
    expect(canLabelAnswers(q(0, 'A'))).toBe(true)
    expect(canLabelAnswers({ ...q(0, 'eNPS'), type: 'rating', scaleMin: 0, scaleMax: 10 })).toBe(false)
    expect(canLabelAnswers({ ...q(0, 'Open'), type: 'open_ended', scaleMin: null, scaleMax: null })).toBe(false)
    // EAGLE lists the positives first: the order is the author's, the keys are still the points.
    expect(canLabelAnswers({ ...labelled(0), options: [...labelled(0).options!].reverse() })).toBe(true)
    // A library scale keyed by words: rewriting it here would repoint every stored answer.
    expect(canLabelAnswers({ ...labelled(0), options: labelled(0).options!.map((o, i) => ({ ...o, value: `k${i}` })) })).toBe(false)
  })

  it('makes one answer per point, keyed by the point, starting from the two end words', () => {
    const list = withAnswerLabels(q(0, 'A'))
    expect(list.options?.map((o) => o.value)).toEqual(['1', '2', '3', '4', '5'])
    expect(list.options?.[0].label.es).toEqual({ text: 'Muy en desacuerdo', authored: true })
    expect(list.options?.[4].label.en).toEqual({ text: 'Strongly agree', authored: true })
    expect(list.options?.[2].label).toEqual(blankLabel)
    expect(hasAnswerLabels(list)).toBe(true)
    expect(withoutAnswerLabels(list).options).toBeNull()
  })

  it("writes the lowest and highest answers' words into the scale's ends, and only those", () => {
    const list = withAnswerLabels(q(0, 'A'))
    const first = setAnswerLabel(list, '1', 'es', 'Nunca')
    expect(first.scaleLabelMin.es).toEqual({ text: 'Nunca', authored: true })
    const middle = setAnswerLabel(first, '3', 'es', 'Algunas veces')
    expect(middle.scaleLabelMin).toEqual(first.scaleLabelMin)
    expect(middle.scaleLabelMax).toEqual(first.scaleLabelMax)
    expect(middle.options?.[2].label.es).toEqual({ text: 'Algunas veces', authored: true })
  })

  it('copies the words onto every question on the same range, and leaves the others exactly as they were', () => {
    const source = labelled(0)
    const sameRange = q(1, 'B')
    const eNps = { ...q(2, 'C'), type: 'rating', scaleMin: 0, scaleMax: 10 }
    const keyedByWords = { ...labelled(3), id: 'q3', options: labelled(3).options!.map((o, i) => ({ ...o, value: `k${i}` })) }
    // A 1–7 scale may take words of its own, but not a 1–5 scale's.
    const sevenPoint = { ...q(4, 'D'), scaleMax: 7 }
    const { questions, count } = applyAnswerLabels([source, sameRange, eNps, keyedByWords, sevenPoint], source)
    expect(count).toBe(2)
    expect(questions[4]).toBe(sevenPoint)
    expect(questions[1].options?.map((o) => [o.value, o.label.es.text])).toEqual(FREQUENCY.map(([, esText], i) => [String(i + 1), esText]))
    expect(questions[1].scaleLabelMin.es.text).toBe('Nunca')
    expect(questions[2]).toBe(eNps)
    expect(questions[3]).toBe(keyedByWords)
  })

  it('names the questions shown as a list with an answer left blank in a language the question is written in', () => {
    const spanishOnly = { ...withAnswerLabels(q(1, 'B')), text: { en: { text: '', authored: false }, es: { text: 'B', authored: true } } }
    const filled = [1, 2, 3, 4, 5].reduce((acc, point) => setAnswerLabel(acc, String(point), 'es', `p${point}`), spanishOnly)
    expect(questionsMissingAnswerLabels([labelled(0), withAnswerLabels(q(1, 'B')), q(2, 'C'), filled], ['en', 'es'])).toEqual([2])
  })

  it('shows a 1–5 question as a list, uses its words on every 1–5 question and saves them under the points', async () => {
    arrangeSurvey('draft', 0)
    vi.mocked(saveSurveyQuestions).mockResolvedValue()
    renderAt('/surveys/s1/questions')
    await userEvent.click(await screen.findByRole('button', { name: a.answersAsList }))
    expect(screen.getByRole('button', { name: a.answersAsList }).getAttribute('aria-pressed')).toBe('true')
    // The ends arrive already written; the three between are the author's.
    expect((screen.getByRole('textbox', { name: `${a.answerLabelsIn.es} 1` }) as HTMLInputElement).value).toBe('Muy en desacuerdo')
    for (const [point, enText, esText] of [['1', 'Never', 'Nunca'], ['2', 'Rarely', 'Casi nunca'], ['3', 'Sometimes', 'Algunas veces'], ['4', 'Often', 'Casi siempre'], ['5', 'Always', 'Siempre']]) {
      for (const [loc, text] of [['en', enText], ['es', esText]] as const) {
        const input = screen.getByRole('textbox', { name: `${a.answerLabelsIn[loc]} ${point}` })
        await userEvent.clear(input)
        await userEvent.type(input, text)
      }
    }
    await userEvent.click(screen.getByRole('button', { name: a.applyToAll.replace('{min}', '1').replace('{max}', '5') }))
    expect(screen.getByTestId('applied-to-all').textContent).toBe(a.appliedToAll.replace('{count}', '2'))
    await userEvent.click(screen.getByRole('button', { name: a.save }))
    const sent = vi.mocked(saveSurveyQuestions).mock.calls[0][2]
    for (const question of sent) {
      expect(question.options?.map((o) => [o.value, o.label.en.text, o.label.es.text])).toEqual(FREQUENCY.map(([enText, esText], i) => [String(i + 1), enText, esText]))
      expect([question.scaleLabelMin.es.text, question.scaleLabelMax.es.text]).toEqual(['Nunca', 'Siempre'])
      expect([question.type, question.scaleMin, question.scaleMax]).toEqual(['likert', 1, 5])
    }
  })

  it('draws the list in the respondent preview, a blank answer as the number it would show', async () => {
    arrangeSurvey('draft', 0)
    renderAt('/surveys/s1/questions')
    await userEvent.click(await screen.findByRole('button', { name: a.answersAsList }))
    const lines = [...screen.getByTestId('preview-answers').children].map((line) => line.textContent)
    expect(lines).toEqual(['Strongly disagree', '2', '3', '4', 'Strongly agree'])
  })

  it('refuses to save a list with an answer left without words, and names the question', async () => {
    arrangeSurvey('draft', 0)
    renderAt('/surveys/s1/questions')
    await userEvent.click(await screen.findByRole('button', { name: a.answersAsList }))
    await userEvent.click(screen.getByRole('button', { name: a.save }))
    expect(saveSurveyQuestions).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe(a.answerLabelsMissingOne.replace('{positions}', '1'))
  })

  it('opens a question that already has words as a list, and saves it back as numbers when asked', async () => {
    vi.mocked(getSurveyQuestionAuthoring).mockResolvedValue({ surveyId: 's1', title: 'Q4', language: 'both', status: 'draft', locales: ['en', 'es'], questions: [labelled(0), q(1, 'Second')] })
    vi.mocked(getSurvey).mockResolvedValue({ id: 's1', companyId: COMPANY, title: 'Q4 Climate Survey', description: 'Wave five', type: 'periodic', status: 'draft', responseCount: 0, targetAudienceCount: 24, startDate: '2026-09-03T12:00:00Z', endDate: '2026-10-10T12:00:00Z' } as SurveyDetail)
    vi.mocked(saveSurveyQuestions).mockResolvedValue()
    renderAt('/surveys/s1/questions')
    const cards = await screen.findAllByTestId('question-card')
    expect(within(cards[0]).getByText(a.answerLabelsChip)).toBeTruthy()
    expect(within(cards[1]).queryByText(a.answerLabelsChip)).toBeNull()
    expect(screen.getByRole('button', { name: a.answersAsList }).getAttribute('aria-pressed')).toBe('true')
    await userEvent.click(screen.getByRole('button', { name: a.answersAsNumbers.replace('{min}', '1').replace('{max}', '5') }))
    await userEvent.click(screen.getByRole('button', { name: a.save }))
    const sent = vi.mocked(saveSurveyQuestions).mock.calls[0][2]
    expect(sent[0].options).toBeNull()
    expect([sent[0].scaleLabelMin.es.text, sent[0].scaleLabelMax.es.text]).toEqual(['Nunca', 'Siempre'])
  })
})

// The boards' spacing, inks and type (SurveyQuestionsEditor / …Locked .dc.html). happy-dom has no
// layout: the classes are the pin, and draft-light.png / locked-light.png are the evidence.
describe('SurveyQuestionsEditorPage — the boards\' spacing, inks and type', () => {
  it("previews the open question semibold in the UI face, as the artboards' `<b>`, under a visible «n de N»", async () => {
    arrangeSurvey('draft', 0)
    renderAt('/surveys/s1/questions')
    const text = await screen.findByTestId('preview-question-text')
    expect(text.className.split(' ')).toEqual(expect.arrayContaining(['text-base', 'font-semibold']))
    for (const face of ['font-display', 'font-serif', 'text-xl']) expect(text.className.split(' ')).not.toContain(face)
    const position = screen.getByTestId('preview-position')
    expect(position.textContent).toMatch(/^\d+ (de|of) \d+$/)
    expect(position.className.split(' ')).not.toContain('sr-only')
  })

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

  it("prints the add row's tail at 12px and weight 400 after the 13px label", async () => {
    arrangeSurvey('draft', 0)
    renderAt('/surveys/s1/questions')
    const tail = await screen.findByTestId('add-tail')
    expect(tail.textContent).toBe(a.addFromLibrary)
    expect(tail.className.split(' ')).toEqual(expect.arrayContaining(['text-sm', 'font-normal', 'text-fg-secondary']))
  })

  it("prints the boards' type: 20px card headings, 13px question text, 12px hints", async () => {
    arrangeSurvey('draft', 0)
    renderAt('/surveys/s1/questions')
    const card = (await screen.findAllByTestId('question-card'))[0]
    expect(screen.getByRole('heading', { name: new RegExp(`^${a.questions}`) }).className.split(' ')).toContain('text-2xl')
    expect(screen.getByRole('heading', { name: a.preview }).className.split(' ')).toContain('text-2xl')
    expect(within(card).getByText(/^First/, { selector: 'p' }).className.split(' ')).toContain('text-base')
    // The board's #6e648b is the tertiary ink, which respondContrast.test.ts bans from features/surveys.
    expect(screen.getByText(a.dimensionHint).className.split(' ')).toEqual(expect.arrayContaining(['text-sm', 'text-fg-secondary']))
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
