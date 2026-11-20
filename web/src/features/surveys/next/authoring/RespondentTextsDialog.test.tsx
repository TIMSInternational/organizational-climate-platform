import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RespondentTextsDialog } from './RespondentTextsDialog'
import { LOCALE_STORAGE_KEY, TranslationProvider } from '../../../../i18n'
import es from '../../../../i18n/es.json'
import en from '../../../../i18n/en.json'
import type { RespondentContentView } from '../../api/respondentContent'
import { contentView, emptyByLocale, registryScreenKeys } from '../../../../test/respondentContentRegistry'

const T = es.surveys.next.respondentTexts
const C = es.surveys.next.respondentContent
const SURVEY = '22222222-2222-2222-2222-222222222222'

/** One `GET /surveys/{id}?lang=…` payload per locale: what the duration field still reads. */
function read(lang: 'es' | 'en', over: { status?: string; minutes?: number | null; questions?: number } = {}) {
  return {
    language: 'es',
    status: over.status ?? 'active',
    fallbackFields: [],
    settings: { respondentIntro: null, closingMessage: null, estimatedMinutes: over.minutes ?? null },
    questions: Array.from({ length: over.questions ?? 57 }, (_, index) => ({ id: `q${index}` })),
    lang,
  }
}

/** `GET /surveys/{id}/respondent-content`, survey level. */
function surveyContent(over: Partial<RespondentContentView> = {}): RespondentContentView {
  return contentView({ level: 'survey', surveyId: SURVEY, surveyStatus: 'active', surveyValues: emptyByLocale(), ...over })
}

type Sent = { method: string; url: string; body: unknown }
let sent: Sent[] = []

function serve(
  content: RespondentContentView,
  texts: { status?: string; minutes?: number | null; questions?: number } = {},
  refusal: Record<string, unknown> | null = null,
) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    sent.push({ method, url, body: init?.body ? JSON.parse(init.body as string) : null })
    if (url.includes('/respondent-content')) {
      if (method === 'PUT' && refusal) return Promise.resolve(new Response(JSON.stringify(refusal), { status: 400 }))
      return Promise.resolve(new Response(JSON.stringify(content), { status: 200 }))
    }
    if (method === 'PUT') return Promise.resolve(new Response('{}', { status: 200 }))
    const lang = url.includes('lang=en') ? 'en' : 'es'
    return Promise.resolve(new Response(JSON.stringify(read(lang, texts)), { status: 200 }))
  })
}

function renderDialog(onSaved = vi.fn(), onOpenChange = vi.fn()) {
  render(
    <TranslationProvider>
      <RespondentTextsDialog surveyId={SURVEY} open onOpenChange={onOpenChange} onSaved={onSaved} />
    </TranslationProvider>,
  )
  return { onSaved, onOpenChange }
}

/** A text box inside one screen's section. */
async function box(group: string, label: string, locale = 'es') {
  const fields = await waitFor(() => {
    const found = document.querySelector<HTMLElement>(`[data-slot="respondent-content-fields"][data-locale="${locale}"]`)
    if (!found) throw new Error('no fields yet')
    return found
  })
  const section = fields.querySelector<HTMLElement>(`[data-group="${group}"]`)!
  return within(section).getByLabelText(label, { exact: false }) as HTMLTextAreaElement | HTMLInputElement
}

function puts(path: string): Sent[] {
  return sent.filter((s) => s.method === 'PUT' && s.url.endsWith(path))
}

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

describe('RespondentTextsDialog', () => {
  it('offers every screen text of the registry, the three that had no editor among them', async () => {
    serve(surveyContent())
    renderDialog()
    await box('demographics', C.fields.demographics_intro)
    expect(await box('identity', C.fields.identity_intro)).toBeTruthy()
    expect(await box('anonymity', C.fields.participationBody)).toBeTruthy()
    const boxes = document.querySelectorAll('[data-slot="respondent-content-fields"] textarea, [data-slot="respondent-content-fields"] input')
    expect(boxes).toHaveLength(registryScreenKeys().length)
  })

  it('shows what an empty box inherits: the company’s text, or the default', async () => {
    serve(
      surveyContent({
        companyValues: { es: { 'demographics.intro': 'Texto de PROCOMER' }, en: {}, '*': {} },
        surveyValues: { es: { anonymousBody: 'Texto de Eagle' }, en: {}, '*': {} },
      }),
    )
    renderDialog()

    const demographics = await box('demographics', C.fields.demographics_intro)
    expect(demographics.value).toBe('')
    expect(demographics.placeholder).toBe('Texto de PROCOMER')
    expect(screen.getByText(C.fromCompany.replace('{text}', 'Texto de PROCOMER'), { exact: false })).toBeTruthy()

    const identity = await box('identity', C.fields.identity_intro)
    expect(identity.placeholder).toBe(es.surveyRespond.identity.intro)
    expect(screen.getByText(C.fromDefault.replace('{text}', es.surveyRespond.identity.intro), { exact: false })).toBeTruthy()

    // The survey's own text is the box's value.
    expect((await box('anonymity', C.fields.anonymousBody)).value).toBe('Texto de Eagle')
    // The default thanks is its title alone (PROCOMER, 2026-11-18): the line under it is gone.
    const closing = await box('thanks', C.fields.thankYouTitle)
    expect(closing.placeholder).toBe(es.surveyRespond.thankYouTitle)
    expect(closing.placeholder).not.toContain(es.surveyRespond.thankYouBody)
  })

  it('says beside the four publish-gate texts that they must be written in every language', async () => {
    serve(surveyContent())
    renderDialog()
    await box('anonymity', C.fields.anonymousBody)
    const fields = document.querySelector('[data-slot="respondent-content-fields"]')!
    const notes = [...fields.querySelectorAll('[data-slot="form-description"], p')].filter((p) => p.textContent?.includes(C.everyLocale))
    // anonymousBody and thankYouTitle are the two screen texts with a legacy column.
    expect(notes).toHaveLength(2)
  })

  it('never prefills one language with the other’s text', async () => {
    serve(
      surveyContent({
        language: 'both',
        requiredLocales: ['es', 'en'],
        surveyValues: { es: { anonymousBody: 'Solo en español' }, en: {}, '*': {} },
      }),
    )
    renderDialog()
    expect((await box('anonymity', C.fields.anonymousBody)).value).toBe('Solo en español')
    await userEvent.click(screen.getByRole('tab', { name: es.surveys.distribution.locale.en }))
    const english = await box('anonymity', C.fields.anonymousBody, 'en')
    expect(english.value).toBe('')
    expect(english.placeholder).toBe(en.surveyRespond.anonymousBody)
  })

  it('saves only the boxes that changed, through the respondent-content route, an emptied one as ""', async () => {
    serve(surveyContent({ surveyValues: { es: { anonymousBody: 'Viejo', thankYouTitle: 'Gracias viejas' }, en: {}, '*': {} } }))
    const { onSaved, onOpenChange } = renderDialog()

    await userEvent.clear(await box('anonymity', C.fields.anonymousBody))
    await userEvent.type(await box('demographics', C.fields.demographics_intro), 'Estos datos ayudan a PROCOMER.')
    await userEvent.click(screen.getByRole('button', { name: es.common.save }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(T.saved))
    expect(puts(`/surveys/${SURVEY}/respondent-content`).map((p) => p.body)).toEqual([
      { values: { es: { anonymousBody: '', 'demographics.intro': 'Estos datos ayudan a PROCOMER.' } } },
    ])
    // The duration did not change, so the survey itself is not written.
    expect(puts(`/surveys/${SURVEY}`)).toHaveLength(0)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('sets the text alignment for every language, and shows what the company chose', async () => {
    serve(surveyContent({ companyValues: { es: {}, en: {}, '*': { 'display.textAlign': 'start' } } }))
    const { onSaved } = renderDialog()

    const inherit = await screen.findByLabelText(C.alignInherit.replace('{value}', C.alignStart))
    expect((inherit as HTMLButtonElement).getAttribute('aria-checked')).toBe('true')
    await userEvent.click(screen.getByLabelText(C.alignJustify))
    await userEvent.click(screen.getByRole('button', { name: es.common.save }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(puts(`/surveys/${SURVEY}/respondent-content`)[0].body).toEqual({ values: { '*': { 'display.textAlign': 'justify' } } })
  })

  it('names a placeholder the text does not allow, and holds Save', async () => {
    serve(surveyContent())
    renderDialog()
    const intro = await box('demographics', C.fields.demographics_intro)
    // `userEvent.type` reads `{` as a key descriptor; `{{` types one.
    await userEvent.type(intro, 'Hola {{nombre}')
    expect(screen.getAllByText(C.noPlaceholders.replace('{placeholder}', '{nombre}'), { exact: false }).length).toBeGreaterThan(0)
    expect((screen.getByRole('button', { name: es.common.save }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('marks the box the server refused', async () => {
    serve(surveyContent(), {}, { code: 'respondent_content_too_long', message: 'too long', key: 'identity.intro', locale: 'es', maxLength: 1000 })
    renderDialog()
    await userEvent.type(await box('identity', C.fields.identity_intro), 'Largo')
    await userEvent.click(screen.getByRole('button', { name: es.common.save }))

    const reason = es.errors.api.codes.respondent_content_too_long
    await screen.findByText(C.refusedField.replace('{field}', C.fields.identity_intro).replace('{locale}', es.surveys.distribution.locale.es).replace('{reason}', reason))
    expect((await box('identity', C.fields.identity_intro)).getAttribute('aria-invalid')).toBe('true')
  })

  /**
   * PROCOMER, 2026-11-19: «38 es mucho», and the figure differs per evaluation and per company.
   * The empty box shows the calculation it stands for; a typed figure is what is sent.
   */
  it('shows the calculated duration as the empty box’s placeholder and saves a stated one, alone', async () => {
    serve(surveyContent(), { questions: 57 })
    const { onSaved } = renderDialog()

    const minutes = (await screen.findByLabelText(T.durationLabel, { exact: false })) as HTMLInputElement
    expect(minutes.value).toBe('')
    // 57 questions, half a minute each, to the nearest five: 30.
    expect(minutes.placeholder).toBe('30')
    expect(screen.getByText(T.durationHelp.replace('{minutes}', '30'))).toBeTruthy()

    await userEvent.type(minutes, '25')
    await userEvent.click(screen.getByRole('button', { name: es.common.save }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(T.saved))
    expect(puts(`/surveys/${SURVEY}`).map((p) => p.body)).toEqual([{ settings: { estimatedMinutes: 25 } }])
    expect(puts(`/surveys/${SURVEY}/respondent-content`)).toHaveLength(0)
  })

  it('prefills a stated duration, and an emptied box sends 0 to calculate it again', async () => {
    serve(surveyContent(), { minutes: 30 })
    const { onSaved } = renderDialog()

    const minutes = (await screen.findByLabelText(T.durationLabel, { exact: false })) as HTMLInputElement
    expect(minutes.value).toBe('30')
    await userEvent.clear(minutes)
    await userEvent.click(screen.getByRole('button', { name: es.common.save }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(puts(`/surveys/${SURVEY}`).map((p) => p.body)).toEqual([{ settings: { estimatedMinutes: 0 } }])
  })

  it('refuses a duration the API would refuse, and sends nothing', async () => {
    serve(surveyContent())
    renderDialog()

    const minutes = await screen.findByLabelText(T.durationLabel, { exact: false })
    await userEvent.type(minutes, '1')

    expect(screen.getByText(T.durationInvalid.replace('{min}', '2').replace('{max}', '600'))).toBeTruthy()
    const save = screen.getByRole('button', { name: es.common.save }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    await userEvent.click(save)
    expect(sent.some((s) => s.method === 'PUT')).toBe(false)
  })

  it('is read-only for a caller the API would refuse (a company admin on a closed survey)', async () => {
    serve(surveyContent({ editable: false, surveyStatus: 'closed' }), { status: 'closed' })
    renderDialog()

    const intro = await box('anonymity', C.fields.anonymousBody)
    expect(intro.disabled).toBe(true)
    expect(screen.getByText(T.locked)).toBeTruthy()
    expect((screen.getByLabelText(T.durationLabel, { exact: false }) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: es.common.save }) as HTMLButtonElement).disabled).toBe(true)
  })

  /** The ruling: «aunque ya esté publicada, el super admin todavía la puede editar». */
  it('lets a super admin edit the texts of a closed survey, but not its duration', async () => {
    serve(surveyContent({ editable: true, surveyStatus: 'closed' }), { status: 'closed' })
    const { onSaved } = renderDialog()

    const thanks = await box('thanks', C.fields.thankYouTitle)
    expect(thanks.disabled).toBe(false)
    expect(screen.queryByText(T.locked)).toBeNull()
    const minutes = screen.getByLabelText(T.durationLabel, { exact: false }) as HTMLInputElement
    expect(minutes.disabled).toBe(true)
    expect(screen.getByText(T.durationLocked, { exact: false })).toBeTruthy()

    await userEvent.type(thanks, 'Gracias, PROCOMER.')
    await userEvent.click(screen.getByRole('button', { name: es.common.save }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(puts(`/surveys/${SURVEY}/respondent-content`).map((p) => p.body)).toEqual([{ values: { es: { thankYouTitle: 'Gracias, PROCOMER.' } } }])
    expect(puts(`/surveys/${SURVEY}`)).toHaveLength(0)
  })
})
