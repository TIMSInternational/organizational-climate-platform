import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InvitationEmailDialog } from './InvitationEmailDialog'
import CompanyEmailTextsSection from '../../../org-structure/next/settings/CompanyEmailTextsSection'
import { LOCALE_STORAGE_KEY, TranslationProvider } from '../../../../i18n'
import es from '../../../../i18n/es.json'
import type { RespondentContentView } from '../../api/respondentContent'

const T = es.surveys.emailTexts
const SURVEY = '22222222-2222-2222-2222-222222222222'
const COMPANY = '11111111-1111-1111-1111-111111111111'

const entry = (key: string, maxLength: number, legacy: string | null = null) => ({
  key,
  kind: 'email',
  group: key.split('.').slice(0, 2).join('.'),
  maxLength,
  placeholders: ['survey', 'company'],
  values: [],
  defaultValue: null,
  legacyColumn: legacy,
  requiresEveryLocale: legacy !== null,
})

function view(over: Partial<RespondentContentView> = {}): RespondentContentView {
  return {
    level: 'survey',
    companyId: COMPANY,
    surveyId: SURVEY,
    language: 'es',
    requiredLocales: ['es'],
    editable: true,
    surveyStatus: 'active',
    entries: [
      entry('email.personalLink.subject', 200, 'InvitationCustomSubject'),
      entry('email.personalLink.message', 1000, 'InvitationCustomMessage'),
      entry('email.credentials.subject', 200),
      entry('email.credentials.message', 1000),
      entry('email.reminder.subject', 200),
      entry('email.reminder.message', 1000),
    ] as RespondentContentView['entries'],
    companyValues: { es: { 'email.credentials.message': 'Muy buenas tardes, gracias por participar.' }, en: {}, '*': {} },
    surveyValues: { es: { 'email.credentials.subject': 'Sus datos de Clima' }, en: {}, '*': {} },
    effective: { es: {}, en: {}, '*': {} },
    ...over,
  }
}

type Sent = { method: string; url: string; body: unknown }
let sent: Sent[] = []

function serve(initial: RespondentContentView, afterPut?: RespondentContentView) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    sent.push({ method, url, body: init?.body ? JSON.parse(init.body as string) : null })
    if (url.includes('/email-preview/')) {
      const mail = url.split('/email-preview/')[1]
      return Promise.resolve(new Response(JSON.stringify({ mail, subject: `Asunto de ${mail}`, text: '', html: '<p>correo</p>' }), { status: 200 }))
    }
    const body = method === 'PUT' ? (afterPut ?? initial) : initial
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
  })
}

const previews = (mail: string) => sent.filter((s) => s.method === 'GET' && s.url.endsWith(`/email-preview/${mail}`))

beforeEach(() => {
  window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
  vi.stubGlobal('fetch', vi.fn())
  sent = []
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

function renderDialog(initialMail?: 'personalLink' | 'credentials' | 'reminder') {
  const onSaved = vi.fn()
  render(
    <TranslationProvider>
      <InvitationEmailDialog surveyId={SURVEY} open onOpenChange={vi.fn()} onSaved={onSaved} initialMail={initialMail} />
    </TranslationProvider>,
  )
  return { onSaved }
}

describe('InvitationEmailDialog: the three survey mails', () => {
  it('opens on the personal-link mail, reads the respondent-content route and previews what is saved', async () => {
    serve(view())
    renderDialog()

    await screen.findByTestId('email-texts-editor')
    expect(sent[0]).toMatchObject({ method: 'GET' })
    expect(sent[0].url).toContain(`/surveys/${SURVEY}/respondent-content`)
    expect(screen.getByRole('button', { name: T.mail.personalLink }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText(T.about.personalLink)).toBeTruthy()
    expect((await screen.findByTestId('email-texts-preview-subject')).textContent).toContain('Asunto de personalLink')
    expect(screen.getByTitle(T.previewFrame).getAttribute('sandbox')).toBe('')
  })

  it('shows the survey its own words and, where it wrote none, the company words it inherits', async () => {
    serve(view())
    renderDialog('credentials')

    const fields = within(await screen.findByTestId('email-texts-es'))
    expect((fields.getByLabelText(T.subject) as HTMLInputElement).value).toBe('Sus datos de Clima')
    expect((fields.getByLabelText(T.message) as HTMLTextAreaElement).value).toBe('')
    // The message inherits the company's paragraph, and says so; the subject would fall to the default.
    expect(screen.getByText('Si queda vacío, se usa el de la empresa: «Muy buenas tardes, gracias por participar.»')).toBeTruthy()
    expect(screen.getByText(T.inheritsDefault)).toBeTruthy()
  })

  it('saves only what changed, through the survey PUT, and previews again from the saved words', async () => {
    serve(view())
    const { onSaved } = renderDialog('credentials')

    const fields = within(await screen.findByTestId('email-texts-es'))
    await waitFor(() => expect(previews('credentials')).toHaveLength(1))
    // `{{` is user-event's escape for a literal `{`.
    await userEvent.type(fields.getByLabelText(T.message), 'Gracias por participar en {{survey}.')
    await userEvent.clear(fields.getByLabelText(T.subject))
    expect(screen.getByText(T.previewUnsaved)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: es.common.save }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(T.saved))
    const put = sent.find((s) => s.method === 'PUT')!
    expect(put.url).toContain(`/surveys/${SURVEY}/respondent-content`)
    // The subject is CLEARED (so the company's or the default shows through); nothing else is touched.
    expect(put.body).toEqual({
      values: { es: { 'email.credentials.message': 'Gracias por participar en {survey}.', 'email.credentials.subject': '' } },
    })
    await waitFor(() => expect(previews('credentials')).toHaveLength(2))
  })

  it('moves between the three mails', async () => {
    serve(view())
    renderDialog()

    await screen.findByTestId('email-texts-editor')
    await userEvent.click(screen.getByRole('button', { name: T.mail.reminder }))
    expect(screen.getByText(T.about.reminder)).toBeTruthy()
    await waitFor(() => expect(previews('reminder')).toHaveLength(1))
  })

  it('says why it cannot save, and offers nothing to type into, when the caller may not edit', async () => {
    serve(view({ editable: false, surveyStatus: 'closed' }))
    renderDialog('credentials')

    const fields = within(await screen.findByTestId('email-texts-es'))
    expect((fields.getByLabelText(T.subject) as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText(T.lockedSurvey)).toBeTruthy()
    expect((screen.getByRole('button', { name: es.common.save }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('CompanyEmailTextsSection: the company level', () => {
  it('reads and writes the company route and previews over the company', async () => {
    const company = view({ level: 'company', surveyId: null, surveyStatus: null, surveyValues: null, companyValues: { es: {}, en: {}, '*': {} } })
    serve(company)
    render(
      <TranslationProvider>
        <CompanyEmailTextsSection companyId={COMPANY} />
      </TranslationProvider>,
    )

    const fields = within(await screen.findByTestId('email-texts-es'))
    expect(screen.getByRole('heading', { name: T.companyTitle })).toBeTruthy()
    // At the company level nothing is inherited but the default.
    expect(screen.getAllByText(T.inheritsDefault)).toHaveLength(2)
    await userEvent.type(fields.getByLabelText(T.subject), 'Invitación de {{company}')
    await userEvent.click(screen.getByRole('button', { name: es.common.save }))

    await waitFor(() => expect(sent.some((s) => s.method === 'PUT')).toBe(true))
    const put = sent.find((s) => s.method === 'PUT')!
    expect(put.url).toContain(`/admin/companies/${COMPANY}/respondent-content`)
    expect(put.body).toEqual({ values: { es: { 'email.personalLink.subject': 'Invitación de {company}' } } })
    expect(previews('personalLink')[0].url).toContain(`/admin/companies/${COMPANY}/respondent-content/email-preview/personalLink`)
    expect(await screen.findByText(T.saved)).toBeTruthy()
  })
})
