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
function read(lang: 'es' | 'en', over: { language?: string; intro?: string | null; closing?: string | null; fallback?: string[]; status?: string } = {}) {
  return {
    language: over.language ?? 'es',
    status: over.status ?? 'active',
    fallbackFields: over.fallback ?? [],
    settings: { respondentIntro: over.intro ?? null, closingMessage: over.closing ?? null },
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
    expect(closing.placeholder).toBe(`${es.surveyRespond.thankYouTitle}. ${es.surveyRespond.thankYouBody}`)
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
      },
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('offers no edit on a closed survey, which the API would refuse', async () => {
    serve({ es: read('es', { status: 'closed' }), en: read('en', { status: 'closed' }) })
    renderDialog()

    const intro = (await screen.findByLabelText(T.introLabel, { exact: false })) as HTMLTextAreaElement
    expect(intro.disabled).toBe(true)
    expect((screen.getByRole('button', { name: es.common.save }) as HTMLButtonElement).disabled).toBe(true)
  })
})
