import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RespondentTextsDialog } from './RespondentTextsDialog'
import { LOCALE_STORAGE_KEY, TranslationProvider } from '../../../../i18n'
import es from '../../../../i18n/es.json'
import en from '../../../../i18n/en.json'

const T = es.surveys.next.respondentTexts
const SURVEY = '22222222-2222-2222-2222-222222222222'

/** One `GET /surveys/{id}?lang=…` payload per locale, as the API resolves it. */
function read(
  lang: 'es' | 'en',
  over: { language?: string; intro?: string | null; closing?: string | null; fallback?: string[]; status?: string; minutes?: number | null; questions?: number } = {},
) {
  return {
    language: over.language ?? 'es',
    status: over.status ?? 'active',
    fallbackFields: over.fallback ?? [],
    settings: { respondentIntro: over.intro ?? null, closingMessage: over.closing ?? null, estimatedMinutes: over.minutes ?? null },
    questions: Array.from({ length: over.questions ?? 57 }, (_, index) => ({ id: `q${index}` })),
    lang,
  }
}

type Sent = { method: string; url: string; body: unknown }
let sent: Sent[] = []

function serve(byLang: Record<'es' | 'en', ReturnType<typeof read>>) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    sent.push({ method, url, body: init?.body ? JSON.parse(init.body as string) : null })
    if (method === 'PUT') return Promise.resolve(new Response('{}', { status: 200 }))
    const lang = url.includes('lang=en') ? 'en' : 'es'
    return Promise.resolve(new Response(JSON.stringify(byLang[lang]), { status: 200 }))
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
  it('shows the survey’s own texts, and the default each empty box stands for as its placeholder', async () => {
    serve({ es: read('es', { intro: 'Texto de Eagle' }), en: read('en', { intro: 'Texto de Eagle', fallback: ['settings.respondentIntro'] }) })
    renderDialog()

    const intro = (await screen.findByLabelText(T.introLabel, { exact: false })) as HTMLTextAreaElement
    const closing = screen.getByLabelText(T.closingLabel, { exact: false }) as HTMLTextAreaElement
    expect(intro.value).toBe('Texto de Eagle')
    expect(closing.value).toBe('')
    // A Spanish-only survey: one column, and the placeholders are the Spanish defaults.
    // The default thanks is its title alone (PROCOMER, 2026-11-18): the line under it is gone.
    expect(closing.placeholder).toBe(es.surveyRespond.thankYouTitle)
    expect(closing.placeholder).not.toContain(es.surveyRespond.thankYouBody)
    expect(intro.placeholder).toBe(es.surveyRespond.anonymousBody)
  })

  it('never prefills a language with the other language’s text that arrived by fallback', async () => {
    serve({
      es: read('es', { language: 'both', intro: 'Solo en español' }),
      en: read('en', { language: 'both', intro: 'Solo en español', fallback: ['settings.respondentIntro'] }),
    })
    renderDialog()

    const intros = (await screen.findAllByLabelText(T.introLabel, { exact: false })) as HTMLTextAreaElement[]
    expect(intros).toHaveLength(2)
    const byPlaceholder = Object.fromEntries(intros.map((box) => [box.placeholder, box.value]))
    expect(byPlaceholder[es.surveyRespond.anonymousBody]).toBe('Solo en español')
    expect(byPlaceholder[en.surveyRespond.anonymousBody]).toBe('')
  })

  it('saves both texts in the survey’s locales in one PUT, an emptied box as "" to restore the default', async () => {
    serve({ es: read('es', { intro: 'Viejo', closing: 'Gracias viejas' }), en: read('en') })
    const { onSaved, onOpenChange } = renderDialog()

    const intro = await screen.findByLabelText(T.introLabel, { exact: false })
    await userEvent.clear(intro)
    const closing = screen.getByLabelText(T.closingLabel, { exact: false })
    await userEvent.clear(closing)
    await userEvent.type(closing, 'Eagle le agradece su participación en la presente encuesta.')
    await userEvent.click(screen.getByRole('button', { name: es.common.save }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(T.saved))
    const put = sent.find((s) => s.method === 'PUT')!
    expect(put.url).toContain(`/surveys/${SURVEY}`)
    expect(put.body).toEqual({
      settings: {
        respondentIntro: { es: '' },
        closingMessage: { es: 'Eagle le agradece su participación en la presente encuesta.' },
        // No duration stated: sent as 0, the API's "calculate it from the questions".
        estimatedMinutes: 0,
      },
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  /**
   * PROCOMER, 2026-11-19: «38 es mucho», and the figure differs per evaluation and per company.
   * The empty box shows the calculation it stands for; a typed figure is what is sent.
   */
  it('shows the calculated duration as the empty box’s placeholder and saves a stated one', async () => {
    serve({ es: read('es', { questions: 57 }), en: read('en', { questions: 57 }) })
    const { onSaved } = renderDialog()

    const minutes = (await screen.findByLabelText(T.durationLabel, { exact: false })) as HTMLInputElement
    expect(minutes.value).toBe('')
    // 57 questions, half a minute each, to the nearest five: 30.
    expect(minutes.placeholder).toBe('30')
    expect(screen.getByText(T.durationHelp.replace('{minutes}', '30'))).toBeTruthy()

    await userEvent.type(minutes, '25')
    await userEvent.click(screen.getByRole('button', { name: es.common.save }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(T.saved))
    const put = sent.find((s) => s.method === 'PUT')!
    expect((put.body as { settings: { estimatedMinutes: number } }).settings.estimatedMinutes).toBe(25)
  })

  it('prefills a stated duration, and an emptied box sends 0 to calculate it again', async () => {
    serve({ es: read('es', { minutes: 30 }), en: read('en', { minutes: 30 }) })
    const { onSaved } = renderDialog()

    const minutes = (await screen.findByLabelText(T.durationLabel, { exact: false })) as HTMLInputElement
    expect(minutes.value).toBe('30')
    await userEvent.clear(minutes)
    await userEvent.click(screen.getByRole('button', { name: es.common.save }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const put = sent.find((s) => s.method === 'PUT')!
    expect((put.body as { settings: { estimatedMinutes: number } }).settings.estimatedMinutes).toBe(0)
  })

  it('refuses a duration the API would refuse, and sends nothing', async () => {
    serve({ es: read('es'), en: read('en') })
    renderDialog()

    const minutes = await screen.findByLabelText(T.durationLabel, { exact: false })
    await userEvent.type(minutes, '1')

    expect(screen.getByText(T.durationInvalid.replace('{min}', '2').replace('{max}', '600'))).toBeTruthy()
    const save = screen.getByRole('button', { name: es.common.save }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    await userEvent.click(save)
    expect(sent.some((s) => s.method === 'PUT')).toBe(false)
  })

  it('offers no edit on a closed survey, which the API would refuse', async () => {
    serve({ es: read('es', { status: 'closed' }), en: read('en', { status: 'closed' }) })
    renderDialog()

    const intro = (await screen.findByLabelText(T.introLabel, { exact: false })) as HTMLTextAreaElement
    expect(intro.disabled).toBe(true)
    expect((screen.getByRole('button', { name: es.common.save }) as HTMLButtonElement).disabled).toBe(true)
  })
})
