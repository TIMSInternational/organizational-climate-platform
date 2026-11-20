import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PaperResponseAction } from './PaperResponseAction'
import SurveyRosterPanel from './SurveyRosterPanel'
import { LOCALE_STORAGE_KEY, TranslationProvider } from '../../../../i18n'
import { clearToken, setToken } from '../../../../auth/token'
import { tokenFor } from '../../../../test/jwtFixture'
import es from '../../../../i18n/es.json'
import type { SurveyParticipationView, SurveyRosterRow } from '../../api/surveys'
import type { SurveyRespondQuestion } from '../../api/surveyResponses'

const T = es.surveys.next.roster.paper
const SURVEY = '33333333-3333-3333-3333-333333333333'
const ROW: SurveyRosterRow = {
  userId: 'beto',
  name: 'Beto Solís',
  email: 'beto@esph.test',
  username: null,
  role: 'employee',
  status: 'not_started',
  lastActivityOn: null,
  demographics: [],
}

const CHOICE: SurveyRespondQuestion = {
  id: 'q-choice',
  text: '¿Dónde trabaja?',
  type: 'multiple_choice',
  options: [
    { order: 0, value: 'remote', label: 'Remoto' },
    { order: 1, value: 'office', label: 'Oficina' },
  ],
  scaleMin: null,
  scaleMax: null,
  scaleLabelMin: null,
  scaleLabelMax: null,
  required: true,
  commentRequired: false,
  commentPrompt: null,
  order: 0,
  category: null,
}

const OPEN: SurveyRespondQuestion = { ...CHOICE, id: 'q-open', text: '¿Algún comentario?', type: 'open_ended', options: null, required: false, order: 1 }

function form(anonymous: boolean) {
  return {
    userId: 'beto',
    name: 'Beto Solís',
    email: 'beto@esph.test',
    survey: {
      id: SURVEY,
      title: 'Clima',
      description: null,
      type: 'periodic',
      language: 'es',
      resolvedLocale: 'es',
      fallbackFields: [],
      startDate: '2026-11-01T00:00:00Z',
      endDate: '2026-11-30T00:00:00Z',
      anonymous,
      allowPartialResponses: true,
      autoSave: true,
      randomizeQuestions: true,
      showProgress: true,
      timeLimitMinutes: null,
      // Served out of order on purpose: the paper is typed in authored order.
      questions: [OPEN, CHOICE],
      demographics: [],
      inProgress: null,
    },
  }
}

function stubFetch(anonymous = true, postStatus = 201, postBody: unknown = { surveyId: SURVEY, userId: 'beto', status: 'completed' }) {
  const sent: { method: string; url: string; body: unknown }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      sent.push({ method, url: String(input), body: init?.body ? (JSON.parse(String(init.body)) as unknown) : null })
      const body = method === 'GET' ? form(anonymous) : postBody
      const status = method === 'GET' ? 200 : postStatus
      return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
    }),
  )
  return sent
}

function draw() {
  return render(
    <TranslationProvider>
      <PaperResponseAction surveyId={SURVEY} row={ROW} />
    </TranslationProvider>,
  )
}

/**
 * «Registrar respuesta en papel» (ruled 2026-11-19): the operator types a paper questionnaire
 * into the respondent's own question fields, and it is sent through the paper route with the
 * respondent's own answer shape.
 */
describe('Entering a paper questionnaire from a roster row', () => {
  beforeEach(() => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    setToken(tokenFor({ role: 'super_admin' }))
  })

  afterEach(() => {
    cleanup()
    clearToken()
    vi.unstubAllGlobals()
  })

  it('draws the questions in authored order and says the survey is anonymous', async () => {
    stubFetch(true)
    draw()

    await userEvent.click(screen.getByRole('button', { name: T.actionFor.replace('{name}', 'Beto Solís') }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(T.anonymous)).toBeTruthy()
    const legends = within(screen.getByTestId('paper-questions')).getAllByRole('group').map((group) => group.textContent ?? '')
    expect(legends[0]).toContain('¿Dónde trabaja?')
    expect(legends[1]).toContain('¿Algún comentario?')
  })

  it('refuses to send while a required answer is missing, then sends the answers in the respondent shape', async () => {
    const sent = stubFetch(false)
    draw()
    await userEvent.click(screen.getByRole('button', { name: T.actionFor.replace('{name}', 'Beto Solís') }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByText(T.anonymous)).toBeNull()

    await userEvent.click(within(dialog).getByRole('button', { name: T.confirm }))
    expect(within(dialog).getByText(T.missing.replace('{positions}', '1'))).toBeTruthy()
    expect(sent.filter((request) => request.method === 'POST')).toHaveLength(0)

    await userEvent.click(within(dialog).getByRole('radio', { name: 'Oficina' }))
    await userEvent.click(within(dialog).getByRole('button', { name: T.confirm }))

    const post = sent.find((request) => request.method === 'POST')
    expect(post?.url).toContain(`/surveys/${SURVEY}/paper-responses/beto`)
    expect(post?.body).toEqual({ answers: [{ questionId: 'q-choice', value: 'office' }], language: 'es' })
    expect(await screen.findByText(T.done.replace('{name}', 'Beto Solís'))).toBeTruthy()
  })

  it('says a refusal in the reader’s language', async () => {
    stubFetch(false, 409, { code: 'paper_response_already_completed', message: 'English' })
    draw()
    await userEvent.click(screen.getByRole('button', { name: T.actionFor.replace('{name}', 'Beto Solís') }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Remoto' }))
    await userEvent.click(within(dialog).getByRole('button', { name: T.confirm }))

    expect(await within(dialog).findByText(es.errors.api.codes.paper_response_already_completed)).toBeTruthy()
  })
})

describe('The roster row offers it', () => {
  const DONE: SurveyRosterRow = { ...ROW, userId: 'ana', name: 'Ana Mora', status: 'completed', lastActivityOn: '2026-11-18' }
  const view: SurveyParticipationView = {
    surveyId: SURVEY,
    tracksCompletionOnly: false,
    collectsParticipantIdentity: false,
    answeredCount: 1,
    pendingCount: 1,
    answered: [],
    pending: [],
    startedCount: 0,
    notStartedCount: 1,
    roster: [DONE, ROW],
    tracksIndividuals: true,
  }
  const actionFor = (name: string) => T.actionFor.replace('{name}', name)

  beforeEach(() => localStorage.setItem(LOCALE_STORAGE_KEY, 'es'))
  afterEach(() => {
    cleanup()
    clearToken()
    vi.unstubAllGlobals()
  })

  it('to a super admin, on somebody who has not completed, and only on them', async () => {
    setToken(tokenFor({ role: 'super_admin' }))
    stubFetch()
    render(
      <TranslationProvider>
        <SurveyRosterPanel state={{ status: 'ready', view }} />
      </TranslationProvider>,
    )

    expect(await screen.findByRole('button', { name: actionFor('Beto Solís') })).toBeTruthy()
    expect(screen.queryByRole('button', { name: actionFor('Ana Mora') })).toBeNull()
  })

  it('never to a company admin', async () => {
    setToken(tokenFor({ role: 'company_admin' }))
    stubFetch()
    render(
      <TranslationProvider>
        <SurveyRosterPanel state={{ status: 'ready', view }} />
      </TranslationProvider>,
    )

    await screen.findByText('Beto Solís')
    expect(screen.queryByRole('button', { name: actionFor('Beto Solís') })).toBeNull()
  })
})
