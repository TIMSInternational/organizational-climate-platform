import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MemoryRouter, Route, Routes } from 'react-router'
import { TranslationProvider } from '../../i18n'
import { CATALOGUES, LOCALE_STORAGE_KEY } from '../../i18n/locale'
import { createTranslator } from '../../i18n/translate'
import SurveyRespondForm from './components/SurveyRespondForm'
import SurveyInvitationPage from './pages/SurveyInvitationPage'
import { PublicRespondEntryView } from './next/entry/PublicRespondEntryView'
import { EntryOutcomeCard } from './next/entry/EntryOutcomeCard'
import { entryState, respondFailureOutcome } from './next/entry/derive'
import { SurveyRespondError, type SurveyRespondQuestion, type SurveyRespondView } from './api/surveyResponses'
import type { SurveyInvitationTokenDetail } from './api/surveyLinks'
import { markAnswered } from './respondReceipt'
import { registryScreenKeys } from '../../test/respondentContentRegistry'

/**
 * Every screen text the server lets a client override has a reader on the respond screens
 * (ruled 2026-11-19, `docs/decisions/editable-respondent-content.md`; audit gap #1).
 *
 * The keys are read from `RespondentContentRegistry.cs` itself, not listed here: a key added to
 * the registry with no screen that reads it fails this file — an override nobody reads is an
 * editor that lies. Every key is given a marked override, the respond screens are walked the
 * way a respondent meets them (both start pages, the four pace sentences, the demographic and
 * identity screens, a question page, the thank-you for an anonymous and a named response, and
 * the closed, already-answered and answered-on-this-device cards), and the marks seen are
 * compared with the registry.
 */

const copy = { es: createTranslator(CATALOGUES.es), en: createTranslator(CATALOGUES.en) } as const

const KEYS = registryScreenKeys()
const MARK = (key: string) => `«OVR ${key}»`
/** Every screen key overridden, each with its own allowed placeholders so a filled one shows. */
const CONTENT: Record<string, string> = Object.fromEntries(KEYS.map((key) => [key, MARK(key)]))

const SURVEY = 'survey-77'
const TOKEN = 'fixture-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

function question(overrides: Partial<SurveyRespondQuestion> = {}): SurveyRespondQuestion {
  return {
    id: 'q1',
    text: '¿Qué tan satisfecho estás?',
    type: 'multiple_choice',
    options: [{ order: 0, value: 'strongly_agree', label: 'Muy de acuerdo' }],
    scaleMin: null,
    scaleMax: null,
    scaleLabelMin: null,
    scaleLabelMax: null,
    required: false,
    commentRequired: false,
    commentPrompt: null,
    order: 0,
    category: null,
    ...overrides,
  }
}

function view(overrides: Partial<SurveyRespondView> = {}): SurveyRespondView {
  return {
    id: SURVEY,
    title: 'Clima laboral 2026',
    description: 'Bienvenida del cliente',
    type: 'general_climate',
    language: 'es',
    resolvedLocale: 'es',
    fallbackFields: [],
    startDate: '2026-01-01T00:00:00Z',
    endDate: '2026-09-12T12:00:00Z',
    anonymous: true,
    allowPartialResponses: false,
    autoSave: true,
    randomizeQuestions: false,
    showProgress: false,
    timeLimitMinutes: null,
    questions: [question()],
    demographics: [],
    inProgress: null,
    content: CONTENT,
    ...overrides,
  }
}

function invitation(overrides: Partial<SurveyInvitationTokenDetail> = {}): SurveyInvitationTokenDetail {
  return {
    invitationId: 'inv-1',
    surveyId: SURVEY,
    surveyTitle: 'Clima laboral 2026',
    surveyDescription: 'Bienvenida del cliente',
    language: 'es',
    resolvedLocale: 'es',
    fallbackFields: [],
    status: 'sent',
    surveyStartDate: '2026-01-01T00:00:00Z',
    surveyEndDate: '2026-12-31T00:00:00Z',
    expiresAt: '2026-11-30T00:00:00Z',
    anonymity: { anonymous: true, highestRecordableState: 'opened', suppressedStates: ['started', 'completed'], guarantee: '' },
    content: CONTENT,
    ...overrides,
  }
}

const AREA = {
  field: 'department',
  label: '¿En qué área trabaja?',
  options: [{ value: '7f6c1c8e-0000-4000-8000-000000000001', label: 'Operaciones' }],
  required: true,
  order: -1,
}

/** The marks on the page right now. */
const seen = new Set<string>()
function collect() {
  const text = document.body.textContent ?? ''
  for (const key of KEYS) if (text.includes(MARK(key))) seen.add(key)
}

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }))
}

/** The respond GET and the completing POST, as the API answers them. */
function serveRespond(payload: SurveyRespondView | { status: number; body: unknown }) {
  vi.mocked(fetch).mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const anonymous = 'anonymous' in payload ? payload.anonymous : true
      return json(
        {
          responseId: 'r1',
          sessionId: 'session-1',
          isComplete: true,
          isAnonymous: anonymous,
          alreadySubmitted: false,
          language: 'es',
          answeredQuestionCount: 1,
          questionCount: 1,
          suppressedDemographics: [],
        },
        201,
      )
    }
    return 'status' in payload && typeof payload.status === 'number' ? json(payload.body, payload.status) : json(payload)
  })
}

/** A browser that has answered nothing: the receipt and the session live in storage. */
function freshDevice() {
  window.localStorage.clear()
  window.sessionStorage.clear()
  window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
}

/**
 * Waits for a screen by its structure, never by an override's mark: a reader that is missing
 * must show up in the final `unread` list, not as a timeout on the way there.
 */
function slot(name: string) {
  return waitFor(() => {
    const found = document.querySelector(`[data-slot="${name}"]`)
    if (!found) throw new Error(`no ${name} yet`)
    return found
  })
}

/** The page's way on: the last button of the respond nav, whatever its words. */
function wayOn(): HTMLElement {
  const buttons = document.querySelectorAll<HTMLElement>('[data-slot="respond-nav"] button')
  return buttons[buttons.length - 1]
}

function renderForm() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={[`/surveys/${SURVEY}/respond`]}>
        <SurveyRespondForm surveyId={SURVEY} publicEntry />
      </MemoryRouter>
    </TranslationProvider>,
  )
}

function renderInvitation() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={[`/survey-invitations/${TOKEN}`]}>
        <Routes>
          <Route path="/survey-invitations/:token" element={<SurveyInvitationPage />} />
        </Routes>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

beforeEach(() => {
  window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

describe('every registry screen key has a reader on the respond screens', () => {
  it('reads the registry it walks', () => {
    // The anonymity paragraph, a footer sentence with a placeholder and a card body: one
    // from each shape the registry file writes its entries in.
    expect(KEYS).toEqual(expect.arrayContaining(['anonymousBody', 'next.closesOn', 'closedBody', 'demographics.intro', 'identity.intro', 'participationBody']))
    // As many as the file declares, counted a second, dumber way: a line that starts an entry.
    const source = readFileSync(join(process.cwd(), '..', 'src/ClimateProject.Application/RespondentContent/RespondentContentRegistry.cs'), 'utf8')
    const declared = source.split('\n').filter((line) => /^\s+(Screen\(|new\(\w+, RespondentContentKinds\.Screen,)/.test(line)).length
    expect(KEYS.length).toBe(declared)
    expect(new Set(KEYS).size).toBe(KEYS.length)
    expect(KEYS.some((key) => key.startsWith('email.') || key.startsWith('display.'))).toBe(false)
  })

  it('renders a client override for every one of them', async () => {
    seen.clear()

    // The shared-link start page, once per pace sentence.
    for (const [questions, minutes] of [
      [1, null],
      [1, 5],
      [2, null],
      [10, null],
    ] as const) {
      render(
        <TranslationProvider>
          <PublicRespondEntryView
            view={view({ questions: Array.from({ length: questions }, (_, i) => question({ id: `q${i}`, order: i })), estimatedMinutes: minutes, asksParticipantIdentity: true })}
            locale="es"
            onBegin={() => {}}
          />
        </TranslationProvider>,
      )
      collect()
      cleanup()
    }

    // The closed card on /s/:token, drawn from the respond GET's 400.
    const closed = new SurveyRespondError(400, 'closed', { content: CONTENT, resolvedLocale: 'es' })
    render(
      <TranslationProvider>
        <EntryOutcomeCard outcome={respondFailureOutcome(400)} source={closed} />
      </TranslationProvider>,
    )
    collect()
    cleanup()

    // The personal-link landing, then its 409 `already_completed` card.
    vi.mocked(fetch).mockImplementation(() => json(invitation()))
    renderInvitation()
    await slot('anonymity-notice')
    collect()
    cleanup()
    vi.mocked(fetch).mockImplementation(() =>
      json({ message: 'done', reason: 'already_completed', content: CONTENT, resolvedLocale: 'es' }, 409),
    )
    renderInvitation()
    await slot('entry-outcome')
    collect()
    cleanup()

    // «Sobre usted», «Quién responde», a question page, the thank-you for an anonymous response.
    freshDevice()
    serveRespond(view({ demographics: [AREA], asksParticipantIdentity: true }))
    renderForm()
    await screen.findByLabelText('Operaciones')
    collect()
    await userEvent.click(screen.getByLabelText('Operaciones'))
    await userEvent.click(screen.getByRole('button', { name: copy.es('surveyRespond.next.next') }))
    await slot('identity-intro')
    collect()
    await userEvent.type(document.querySelector<HTMLInputElement>('#participant-identity input')!, 'Ana')
    await userEvent.click(wayOn())
    await screen.findByText('¿Qué tan satisfecho estás?')
    collect()
    await userEvent.click(screen.getByLabelText('Muy de acuerdo'))
    await userEvent.click(screen.getByRole('button', { name: copy.es('surveyRespond.submitResponse') }))
    await slot('respond-thanks')
    collect()
    cleanup()

    // A stated duration on the footer, a named response's «qué pasa ahora», and the
    // demographics screen's own way on when no identity screen follows.
    freshDevice()
    serveRespond(view({ anonymous: false, estimatedMinutes: 5, demographics: [AREA] }))
    renderForm()
    await screen.findByLabelText('Operaciones')
    await userEvent.click(screen.getByLabelText('Operaciones'))
    collect()
    await userEvent.click(wayOn())
    await screen.findByText('¿Qué tan satisfecho estás?')
    collect()
    await userEvent.click(screen.getByLabelText('Muy de acuerdo'))
    await userEvent.click(screen.getByRole('button', { name: copy.es('surveyRespond.submitResponse') }))
    await slot('respond-what-happens')
    collect()
    cleanup()

    // The server holds a complete response: the already-answered card.
    freshDevice()
    serveRespond(view({ inProgress: { responseId: 'r1', answers: [], isComplete: true } as unknown as SurveyRespondView['inProgress'] }))
    renderForm()
    await slot('alert')
    collect()
    cleanup()

    // This browser answered an anonymous survey: the device card.
    freshDevice()
    markAnswered(SURVEY)
    serveRespond(view())
    renderForm()
    await slot('alert')
    collect()
    cleanup()

    // The closed survey, inside the form.
    freshDevice()
    serveRespond({ status: 400, body: { message: 'closed', content: CONTENT, resolvedLocale: 'es' } })
    renderForm()
    await slot('alert')
    collect()
    cleanup()

    const unread = KEYS.filter((key) => !seen.has(key))
    expect(unread).toEqual([])
  })
})

describe('the client’s words, only in their own language', () => {
  it('shows the defaults to a reader in another language than the payload’s', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    render(
      <TranslationProvider>
        <PublicRespondEntryView view={view()} locale="en" onBegin={() => {}} />
      </TranslationProvider>,
    )
    expect(screen.queryByText(MARK('next.entryStart'))).toBeNull()
    expect(screen.getByText(copy.en('surveyRespond.next.entryStart'))).toBeTruthy()
    expect(screen.queryByText(MARK('anonymousBody'))).toBeNull()
  })

  it('fills an override’s placeholders as the default’s would be', async () => {
    serveRespond(view({ content: { 'next.closesOn': 'Cerramos el {date}, sin falta.' } }))
    renderForm()
    await screen.findByText('¿Qué tan satisfecho estás?')
    const footer = document.querySelector('[data-slot="respond-footer"]')!
    expect(footer.textContent).toMatch(/Cerramos el \d+ de septiembre, sin falta\./)
  })
})

describe('display.textAlign', () => {
  it('justifies the welcome text and the question by default', async () => {
    serveRespond(view({ content: {} }))
    renderForm()
    await screen.findByText('¿Qué tan satisfecho estás?')
    const intro = document.querySelector('[data-slot="survey-intro"] p')!
    const text = document.querySelector('[data-slot="question-text"]')!
    expect(intro.className).toContain('text-justify')
    expect(text.className).toContain('text-justify')
  })

  it('sets them ragged when the survey or its company chose «start»', async () => {
    serveRespond(view({ content: { 'display.textAlign': 'start' } }))
    renderForm()
    await screen.findByText('¿Qué tan satisfecho estás?')
    const intro = document.querySelector('[data-slot="survey-intro"] p')!
    const text = document.querySelector('[data-slot="question-text"]')!
    expect(intro.className).toContain('text-start')
    expect(intro.className).not.toContain('text-justify')
    expect(text.className).toContain('text-start')
    expect(text.className).not.toContain('text-justify')
  })

  it('sets the start page’s and the invitation’s welcome text the same way', async () => {
    render(
      <TranslationProvider>
        <PublicRespondEntryView view={view({ content: { 'display.textAlign': 'start' } })} locale="es" onBegin={() => {}} />
      </TranslationProvider>,
    )
    const caption = document.querySelector('[data-slot="respond-caption-description"] p')!
    expect(caption.className).toContain('text-start')
    cleanup()

    vi.mocked(fetch).mockImplementation(() => json(invitation({ content: {} })))
    renderInvitation()
    await waitFor(() => expect(document.querySelector('[data-slot="respond-caption-description"] p')).not.toBeNull())
    expect(document.querySelector('[data-slot="respond-caption-description"] p')!.className).toContain('text-justify')
  })
})

describe('the /s/:token card takes its words from what the respond GET answered', () => {
  it('carries the refusal on a closed survey and the view on an already-answered one, and nothing on a dead link', () => {
    const closed = new SurveyRespondError(400, 'closed', { content: CONTENT, resolvedLocale: 'es' })
    const detail = { surveyId: SURVEY } as Parameters<typeof entryState>[0] extends infer L ? (L extends { status: 'resolved'; detail: infer D } ? D : never) : never
    const blocked = entryState({ status: 'resolved', detail }, { status: 'failed', error: closed }, false)
    expect(blocked.status === 'blocked' && blocked.source).toBe(closed)

    const done = view({ inProgress: { isComplete: true } as unknown as SurveyRespondView['inProgress'] })
    const answered = entryState({ status: 'resolved', detail }, { status: 'ready', view: done }, false)
    expect(answered.status === 'blocked' && answered.source).toBe(done)

    const dead = entryState({ status: 'dead', error: null }, { status: 'idle' }, false)
    expect(dead.status === 'blocked' && dead.source).toBeFalsy()
  })
})
