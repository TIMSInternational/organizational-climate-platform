import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  RespondentContentRefusal,
  effectiveText,
  getCompanyRespondentContent,
  getSurveyRespondentContent,
  interpolateContent,
  respondentContentOf,
  saveCompanyRespondentContent,
  saveSurveyRespondentContent,
  textAlignOf,
  toRespondentContentView,
  type RespondentContentView,
} from './respondentContent'
import { ApiError } from '../../../api/authFetch'
import { setToken, clearToken } from '../../../auth/token'

const BASE = 'https://api.example.invalid'

/** The server's shape, as `RespondentContentEndpoints` answers it. */
function serverView(overrides: Partial<RespondentContentView> = {}): RespondentContentView {
  return {
    level: 'survey',
    companyId: 'c1',
    surveyId: 's1',
    language: 'es',
    requiredLocales: ['es'],
    editable: true,
    surveyStatus: 'active',
    entries: [
      {
        key: 'next.entryPace',
        kind: 'screen',
        group: 'start',
        maxLength: 300,
        placeholders: ['count', 'minutes'],
        values: [],
        defaultValue: null,
        legacyColumn: null,
      },
      {
        key: 'display.textAlign',
        kind: 'display',
        group: 'display',
        maxLength: 7,
        placeholders: [],
        values: ['justify', 'start'],
        defaultValue: 'justify',
        legacyColumn: null,
      },
    ],
    companyValues: { es: { 'demographics.intro': 'Empresa' }, en: {}, '*': { 'display.textAlign': 'start' } },
    surveyValues: { es: { anonymousBody: 'Párrafo' }, en: {}, '*': {} },
    effective: { es: { 'demographics.intro': 'Empresa', anonymousBody: 'Párrafo' }, en: {}, '*': { 'display.textAlign': 'start' } },
    ...overrides,
  }
}

function respond(body: unknown, status = 200): void {
  vi.mocked(fetch).mockImplementation(() => Promise.resolve(new Response(JSON.stringify(body), { status })))
}

function call(index = 0): { url: string; init: RequestInit } {
  const [url, init] = vi.mocked(fetch).mock.calls[index]
  return { url: String(url), init: (init ?? {}) as RequestInit }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  setToken('header.eyJzdWIiOiJ1MSJ9.signature')
})

afterEach(() => {
  clearToken()
  vi.unstubAllGlobals()
})

describe('the respondent-content routes', () => {
  it('reads the company level from /admin/companies/{id}/respondent-content with the bearer', async () => {
    respond(serverView({ level: 'company', surveyId: null, surveyStatus: null, surveyValues: null }))

    const view = await getCompanyRespondentContent(BASE, 'c1')

    expect(call().url).toBe(`${BASE}/admin/companies/c1/respondent-content`)
    expect(new Headers(call().init.headers).get('Authorization')).toBe('Bearer header.eyJzdWIiOiJ1MSJ9.signature')
    expect(view.level).toBe('company')
    expect(view.surveyValues).toBeNull()
    expect(view.companyValues.es['demographics.intro']).toBe('Empresa')
  })

  it('reads the survey level, its company beside it and the effective result', async () => {
    respond(serverView())

    const view = await getSurveyRespondentContent(BASE, 's1')

    expect(call().url).toBe(`${BASE}/surveys/s1/respondent-content`)
    expect(view.surveyValues?.es.anonymousBody).toBe('Párrafo')
    expect(view.effective['*']['display.textAlign']).toBe('start')
    expect(view.entries.map((entry) => entry.key)).toEqual(['next.entryPace', 'display.textAlign'])
    expect(view.entries[0].placeholders).toEqual(['count', 'minutes'])
  })

  it('PUTs the changes under `values`, partial, an empty string clearing a key', async () => {
    respond(serverView())

    await saveSurveyRespondentContent(BASE, 's1', { es: { 'demographics.intro': 'A la medida', closedTitle: '' }, '*': { 'display.textAlign': 'start' } })

    expect(call().url).toBe(`${BASE}/surveys/s1/respondent-content`)
    expect(call().init.method).toBe('PUT')
    expect(JSON.parse(String(call().init.body))).toEqual({
      values: { es: { 'demographics.intro': 'A la medida', closedTitle: '' }, '*': { 'display.textAlign': 'start' } },
    })
  })

  it('answers a save with the view the server sent back', async () => {
    respond(serverView({ level: 'company', surveyId: null, surveyValues: null }))

    const view = await saveCompanyRespondentContent(BASE, 'c1', { en: { eyebrow: 'Climate survey' } })

    expect(call().url).toBe(`${BASE}/admin/companies/c1/respondent-content`)
    expect(view.level).toBe('company')
  })

  it('keeps the field a refusal names, as well as its code', async () => {
    respond(
      {
        message: "'next.closesOn' (es) does not know '{fecha}'.",
        code: 'respondent_content_unknown_placeholder',
        locale: 'es',
        key: 'next.closesOn',
        placeholder: 'fecha',
        maxLength: null,
        allowed: ['date'],
      },
      400,
    )

    const failure = await saveSurveyRespondentContent(BASE, 's1', { es: { 'next.closesOn': 'Cierra el {fecha}' } }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(RespondentContentRefusal)
    expect(failure).toBeInstanceOf(ApiError)
    const refusal = failure as RespondentContentRefusal
    expect(refusal.status).toBe(400)
    expect(refusal.code).toBe('respondent_content_unknown_placeholder')
    expect(refusal.key).toBe('next.closesOn')
    expect(refusal.locale).toBe('es')
    expect(refusal.placeholder).toBe('fecha')
    expect(refusal.allowed).toEqual(['date'])
    expect(refusal.maxLength).toBeNull()
  })

  it('a 409 for a closed survey is a refusal with its code', async () => {
    respond({ message: 'locked', code: 'respondent_content_locked' }, 409)

    const failure = (await saveSurveyRespondentContent(BASE, 's1', {}).catch((error: unknown) => error)) as RespondentContentRefusal

    expect(failure.status).toBe(409)
    expect(failure.code).toBe('respondent_content_locked')
    expect(failure.key).toBeNull()
  })

  it('fills in a locale an older server left out', () => {
    const view = toRespondentContentView({
      ...serverView(),
      effective: { es: { eyebrow: 'Encuesta' } } as unknown as RespondentContentView['effective'],
    })

    expect(view.effective).toEqual({ es: { eyebrow: 'Encuesta' }, en: {}, '*': {} })
  })
})

describe('effectiveText', () => {
  const content = {
    'next.entryPace': '{count} preguntas, unos {minutes} minutos',
    'demographics.intro': 'Sus datos comparan grupos.',
    blank: '   ',
  }
  const spanish = { content, resolvedLocale: 'es' }

  it('is the override, placeholders filled the way t() fills them', () => {
    expect(effectiveText(spanish, 'es', 'next.entryPace', { count: 57, minutes: 20 })).toBe('57 preguntas, unos 20 minutos')
    expect(effectiveText(spanish, 'es', 'demographics.intro')).toBe('Sus datos comparan grupos.')
  })

  it('is null for the product default: an absent key, a blank value, no content at all', () => {
    expect(effectiveText(spanish, 'es', 'closedTitle')).toBeNull()
    expect(effectiveText(spanish, 'es', 'blank')).toBeNull()
    expect(effectiveText({ content: null, resolvedLocale: 'es' }, 'es', 'closedTitle')).toBeNull()
    expect(effectiveText(null, 'es', 'closedTitle')).toBeNull()
    expect(effectiveText(undefined, 'es', 'closedTitle')).toBeNull()
    // Never a prototype member mistaken for a text.
    expect(effectiveText({ content: {}, resolvedLocale: 'es' }, 'es', 'toString')).toBeNull()
  })

  /**
   * "An override written in Spanish is never shown to an English reader": an es-only survey
   * resolves its content in Spanish whatever was asked, and a visitor who chose English reads
   * English chrome — so the default, in English, not the client's Spanish sentence.
   */
  it('is null when the reader is not in the language the words were resolved in', () => {
    expect(effectiveText(spanish, 'en', 'demographics.intro')).toBeNull()
    expect(effectiveText({ content: { closedTitle: 'Closed for now' }, resolvedLocale: 'en' }, 'es', 'closedTitle')).toBeNull()
    // An older API that names no locale: nothing is assumed.
    expect(effectiveText({ content }, 'es', 'demographics.intro')).toBeNull()
  })

  it('leaves a placeholder it was given no value for visible, like t()', () => {
    expect(interpolateContent('{count} de {total}', { count: 3 })).toBe('3 de {total}')
    expect(interpolateContent('sin marcadores')).toBe('sin marcadores')
  })
})

describe('respondentContentOf', () => {
  it('reads the words and their locale off a refusal body, keeping only strings', () => {
    expect(respondentContentOf({ message: 'x', resolvedLocale: 'es', content: { closedTitle: 'Cerrada', n: 1, o: {} } })).toEqual({
      content: { closedTitle: 'Cerrada' },
      resolvedLocale: 'es',
    })
  })

  it('is nulls for a body that carries none, or is not an object', () => {
    expect(respondentContentOf({ message: 'x' })).toEqual({ content: null, resolvedLocale: null })
    expect(respondentContentOf({ content: ['a'], resolvedLocale: 3 })).toEqual({ content: null, resolvedLocale: null })
    expect(respondentContentOf(null)).toEqual({ content: null, resolvedLocale: null })
    expect(respondentContentOf('text')).toEqual({ content: null, resolvedLocale: null })
  })
})

describe('textAlignOf', () => {
  it('is justify unless the client chose start', () => {
    expect(textAlignOf({ 'display.textAlign': 'start' })).toBe('start')
    expect(textAlignOf({ 'display.textAlign': 'justify' })).toBe('justify')
    expect(textAlignOf({ 'display.textAlign': 'center' })).toBe('justify')
    expect(textAlignOf({})).toBe('justify')
    expect(textAlignOf(null)).toBe('justify')
  })
})
