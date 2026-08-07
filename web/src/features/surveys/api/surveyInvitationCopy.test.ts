import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import {
  getSurveyInvitationCopy,
  missingInvitationCopy,
  requiredLocalesFor,
  saveSurveyInvitationCopy,
  type InvitationCopyByLocale,
} from './surveyInvitationCopy'

const BASE_URL = 'http://localhost:5080'

interface ReadOverrides {
  language?: string
  status?: string
  subject?: string | null
  message?: string | null
  fallbackFields?: string[]
  title?: string | null
  resolvedLocale?: string
}

function read(overrides: ReadOverrides = {}) {
  return {
    companyId: 'c1',
    language: overrides.language ?? 'both',
    status: overrides.status ?? 'active',
    title: overrides.title ?? 'Team pulse',
    resolvedLocale: overrides.resolvedLocale ?? 'en',
    fallbackFields: overrides.fallbackFields ?? [],
    departmentIds: ['d1'],
    responseCount: 4,
    settings: {
      invitationCustomSubject: overrides.subject ?? null,
      invitationCustomMessage: overrides.message ?? null,
    },
  }
}

/** `getSurveyInvitationCopy` reads `?lang=en` then `?lang=es`, in `LOCALES` order. */
function stubLocaleReads(en: ReadOverrides, es: ReadOverrides) {
  const fetchMock = vi.fn().mockImplementation((url: string) =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve(url.includes('lang=es') ? read(es) : read(en)),
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('survey invitation copy', () => {
  beforeEach(() => {
    localStorage.setItem('climate_platform_token', 'test-token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  describe('requiredLocalesFor', () => {
    it('demands both languages only when the survey is authored in both', () => {
      expect(requiredLocalesFor('both')).toEqual(['en', 'es'])
      expect(requiredLocalesFor('es')).toEqual(['es'])
      expect(requiredLocalesFor('en')).toEqual(['en'])
    })
  })

  describe('getSurveyInvitationCopy', () => {
    it('reads the survey once per locale rather than asking for en/es fields', async () => {
      // The whole reason this module makes two requests: no read DTO may expose
      // En/Es-shaped fields (#195). Two resolved reads is the compliant way to get both.
      const fetchMock = stubLocaleReads({ subject: 'Your invitation' }, { subject: 'Tu invitación' })

      await getSurveyInvitationCopy(BASE_URL, 's1')

      expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
        `${BASE_URL}/surveys/s1?lang=en`,
        `${BASE_URL}/surveys/s1?lang=es`,
      ])
    })

    it('keeps each locale’s own text when both are authored', async () => {
      stubLocaleReads(
        { subject: 'Your invitation', message: 'Please answer' },
        { subject: 'Tu invitación', message: 'Por favor responde' },
      )

      const result = await getSurveyInvitationCopy(BASE_URL, 's1')

      expect(result.copy.en.subject).toEqual({ text: 'Your invitation', authored: true })
      expect(result.copy.es.message).toEqual({ text: 'Por favor responde', authored: true })
      expect(result.requiredLocales).toEqual(['en', 'es'])
    })

    /**
     * The load-bearing assertion of this module.
     *
     * The Spanish read comes back with the ENGLISH text, because that is what the
     * resolution rule does when Spanish is missing — and it says so in `fallbackFields`.
     * Prefilling the Spanish box with it would make an untranslated field look translated,
     * and saving would then copy English into the `_es` column for real.
     */
    it('treats a fallback value as “not written in this language”, not as content', async () => {
      stubLocaleReads(
        { subject: 'Your invitation' },
        { subject: 'Your invitation', fallbackFields: ['settings.invitationCustomSubject'] },
      )

      const result = await getSurveyInvitationCopy(BASE_URL, 's1')

      expect(result.copy.en.subject).toEqual({ text: 'Your invitation', authored: true })
      expect(result.copy.es.subject).toEqual({ text: '', authored: false })
    })

    it('reports an absent field as empty and unauthored in every locale', async () => {
      stubLocaleReads({}, {})

      const result = await getSurveyInvitationCopy(BASE_URL, 's1')

      expect(result.copy.en.message.authored).toBe(false)
      expect(result.copy.es.message.text).toBe('')
    })

    it('marks a closed survey as not editable, matching AllowsScheduleEdit', async () => {
      stubLocaleReads({ status: 'closed' }, { status: 'closed' })
      expect((await getSurveyInvitationCopy(BASE_URL, 's1')).editable).toBe(false)

      stubLocaleReads({ status: 'active' }, { status: 'active' })
      expect((await getSurveyInvitationCopy(BASE_URL, 's1')).editable).toBe(true)
    })

    it('reports the locale the title is actually in, not the one asked for', async () => {
      // A Spanish-only survey fetched for a Spanish reader still resolves to 'es'; a
      // Spanish-only survey read for 'en' comes back Spanish and must SAY 'es'. Reporting
      // the requested locale there is the silent substitution the design forbids.
      stubLocaleReads(
        { language: 'es', title: 'Pulso de equipo', resolvedLocale: 'es' },
        { language: 'es', title: 'Pulso de equipo', resolvedLocale: 'es' },
      )

      const result = await getSurveyInvitationCopy(BASE_URL, 's1', 'en')

      expect(result.survey.title).toBe('Pulso de equipo')
      expect(result.survey.resolvedLocale).toBe('es')
    })

    it('carries the survey facts the page needs off the same reads', async () => {
      stubLocaleReads({}, {})

      const result = await getSurveyInvitationCopy(BASE_URL, 's1')

      expect(result.survey.companyId).toBe('c1')
      expect(result.survey.departmentIds).toEqual(['d1'])
      expect(result.survey.responseCount).toBe(4)
    })
  })

  describe('missingInvitationCopy', () => {
    const copy: InvitationCopyByLocale = {
      en: { subject: { text: 'Hello', authored: true }, message: { text: 'Body', authored: true } },
      es: { subject: { text: '', authored: false }, message: { text: '   ', authored: false } },
    }

    it('names every gap in every required locale', () => {
      expect(missingInvitationCopy(copy, ['en', 'es'])).toEqual([
        { locale: 'es', field: 'subject' },
        { locale: 'es', field: 'message' },
      ])
    })

    it('asks for nothing outside the survey’s own languages', () => {
      // An English-only survey has no Spanish gap. Demanding one would invent a
      // requirement the server's publish gate does not have.
      expect(missingInvitationCopy(copy, ['en'])).toEqual([])
    })
  })

  describe('saveSurveyInvitationCopy', () => {
    const copy: InvitationCopyByLocale = {
      en: { subject: { text: 'Hello', authored: true }, message: { text: 'Body', authored: true } },
      es: { subject: { text: 'Hola', authored: true }, message: { text: 'Cuerpo', authored: true } },
    }

    it('always sends the locale-keyed shape, never a bare string', async () => {
      // A bare string is REJECTED by LocalizedInput when the survey is authored in
      // 'both' — deliberately, because attributing unlabelled text to one column is the
      // content-mangling the paired columns exist to prevent.
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
      vi.stubGlobal('fetch', fetchMock)

      await saveSurveyInvitationCopy(BASE_URL, 's1', copy, ['en', 'es'])

      const body = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(body.settings.invitationCustomSubject).toEqual({ en: 'Hello', es: 'Hola' })
      expect(body.settings.invitationCustomMessage).toEqual({ en: 'Body', es: 'Cuerpo' })
    })

    it('uses the object shape even for a single-language survey', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
      vi.stubGlobal('fetch', fetchMock)

      await saveSurveyInvitationCopy(BASE_URL, 's1', copy, ['es'])

      // Only the required locale, and still keyed — one shape on every path, so the
      // branch that only misfires on 'both' surveys does not exist.
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).settings.invitationCustomSubject).toEqual({
        es: 'Hola',
      })
    })

    it('never sends `anonymous`, which the API classes as content and would 409', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
      vi.stubGlobal('fetch', fetchMock)

      await saveSurveyInvitationCopy(BASE_URL, 's1', copy, ['en', 'es'])

      const body = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(Object.keys(body)).toEqual(['settings'])
      expect(Object.keys(body.settings).sort()).toEqual([
        'invitationCustomMessage',
        'invitationCustomSubject',
      ])
      expect(fetchMock.mock.calls[0][1].method).toBe('PUT')
    })
  })
})
