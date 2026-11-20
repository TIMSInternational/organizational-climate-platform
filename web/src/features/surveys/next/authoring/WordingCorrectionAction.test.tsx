import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WordingCorrectionAction } from './WordingCorrectionAction'
import { LOCALE_STORAGE_KEY, TranslationProvider } from '../../../../i18n'
import { clearToken, setToken } from '../../../../auth/token'
import { tokenFor } from '../../../../test/jwtFixture'
import es from '../../../../i18n/es.json'
import type { SurveyQuestionAuthoring } from '../../api/surveyQuestionAuthoring'

const T = es.surveys.next.authoring.wording
const SURVEY = '44444444-4444-4444-4444-444444444444'
const said = (text: string) => ({ es: { text, authored: true }, en: { text: '', authored: false } })
const none = () => ({ es: { text: '', authored: false }, en: { text: '', authored: false } })

const AUTHORING: SurveyQuestionAuthoring = {
  surveyId: SURVEY,
  title: 'Clima',
  language: 'es',
  status: 'active',
  locales: ['es'],
  questions: [
    {
      id: 'q55',
      type: 'multiple_choice',
      order: 54,
      category: 'cierre',
      required: true,
      commentRequired: false,
      keepAtEnd: true,
      scaleMin: null,
      scaleMax: null,
      text: said('¿Hay algun comentario?'),
      scaleLabelMin: none(),
      scaleLabelMax: none(),
      commentPrompt: none(),
      options: [
        { value: 'si', label: said('Si') },
        { value: 'no', label: said('No') },
      ],
    },
  ],
}

function stubFetch(status = 200, body: unknown = { surveyId: SURVEY, version: 3, changedQuestionIds: ['q55'] }) {
  const sent: { method: string; url: string; body: unknown }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ method: init?.method ?? 'GET', url: String(input), body: init?.body ? (JSON.parse(String(init.body)) as unknown) : null })
      return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
    }),
  )
  return sent
}

function draw(onSaved = vi.fn()) {
  render(
    <TranslationProvider>
      <WordingCorrectionAction surveyId={SURVEY} authoring={AUTHORING} onSaved={onSaved} />
    </TranslationProvider>,
  )
  return onSaved
}

/**
 * «Corregir redacción» (ruled 2026-11-19): only the words are offered, and the save sends every
 * question with its id and its stored structure untouched -- PROCOMER's «algun» is the case.
 */
describe('Correcting the wording of an answered survey', () => {
  beforeEach(() => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    setToken(tokenFor({ role: 'super_admin' }))
  })

  afterEach(() => {
    cleanup()
    clearToken()
    vi.unstubAllGlobals()
  })

  it('offers words only: the text and the option words, and no comment prompt where there is none', async () => {
    stubFetch()
    draw()

    await userEvent.click(screen.getByRole('button', { name: T.action }))

    const dialog = await screen.findByRole('dialog')
    const fields = within(dialog).getAllByRole('textbox').map((field) => (field as HTMLInputElement).value)
    expect(fields).toEqual(['¿Hay algun comentario?', 'Si', 'No'])
    expect(within(dialog).queryByLabelText(T.commentPrompt)).toBeNull()
    expect(within(dialog).queryByRole('combobox')).toBeNull()
    expect(within(dialog).queryByRole('checkbox')).toBeNull()
  })

  it('sends every question with its id and stored structure, and reloads the editor on close', async () => {
    const sent = stubFetch()
    const onSaved = draw()
    await userEvent.click(screen.getByRole('button', { name: T.action }))
    const dialog = await screen.findByRole('dialog')

    const text = within(dialog).getByLabelText(T.text)
    await userEvent.clear(text)
    await userEvent.type(text, '¿Hay algún comentario?')
    await userEvent.click(within(dialog).getByRole('button', { name: T.save }))

    const put = sent.find((request) => request.method === 'PUT')
    expect(put?.url).toContain(`/surveys/${SURVEY}/wording`)
    expect(put?.body).toEqual({
      questions: [
        {
          id: 'q55',
          type: 'multiple_choice',
          text: { es: '¿Hay algún comentario?' },
          options: [
            { value: 'si', label: { es: 'Si' } },
            { value: 'no', label: { es: 'No' } },
          ],
          scaleMin: null,
          scaleMax: null,
          scaleLabelMin: {},
          scaleLabelMax: {},
          required: true,
          commentRequired: false,
          commentPrompt: {},
          order: 54,
          category: 'cierre',
          keepAtEnd: true,
        },
      ],
    })
    expect(await within(dialog).findByText(T.savedOne.replace('{version}', '3'))).toBeTruthy()

    expect(onSaved).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getAllByRole('button', { name: es.common.close }).at(-1)!)
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('says a structural refusal in the reader’s language', async () => {
    stubFetch(409, { code: 'survey_wording_structure_changed', message: 'English', field: 'type' })
    draw()
    await userEvent.click(screen.getByRole('button', { name: T.action }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: T.save }))

    expect(await within(dialog).findByText(es.errors.api.codes.survey_wording_structure_changed)).toBeTruthy()
  })
})
