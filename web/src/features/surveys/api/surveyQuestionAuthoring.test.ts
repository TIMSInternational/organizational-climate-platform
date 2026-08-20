import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import {
  getSurveyQuestionAuthoring,
  saveSurveyQuestions,
  toQuestionInputs,
} from './surveyQuestionAuthoring'

const BASE_URL = 'http://localhost:5080'

interface QuestionOverrides {
  text?: string | null
  optionLabels?: (string | null)[]
  scaleLabelMin?: string | null
  scaleLabelMax?: string | null
  commentPrompt?: string | null
}

function question(o: QuestionOverrides = {}) {
  return {
    id: 'q1',
    text: o.text === undefined ? 'How are you?' : o.text,
    type: 'multiple_choice',
    options: (o.optionLabels ?? ['Good', 'Bad']).map((label, i) => ({
      order: i,
      // The stable aggregation key, deliberately unlike the label so a re-derived
      // value is visibly different rather than coincidentally equal.
      value: `opt-key-${i}`,
      label,
    })),
    scaleMin: 1,
    scaleMax: 5,
    scaleLabelMin: o.scaleLabelMin === undefined ? 'Low' : o.scaleLabelMin,
    scaleLabelMax: o.scaleLabelMax === undefined ? 'High' : o.scaleLabelMax,
    required: true,
    commentRequired: false,
    commentPrompt: o.commentPrompt === undefined ? 'Say more' : o.commentPrompt,
    order: 0,
    category: 'Bienestar',
  }
}

function read(overrides: { language?: string; fallbackFields?: string[] } & QuestionOverrides = {}) {
  return {
    id: 's1',
    language: overrides.language ?? 'both',
    status: 'draft',
    fallbackFields: overrides.fallbackFields ?? [],
    questions: [question(overrides)],
  }
}

function stubReads(en: Parameters<typeof read>[0], es: Parameters<typeof read>[0]) {
  const fetchMock = vi.fn().mockImplementation((url: string) =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve(url.includes('lang=es') ? read(es) : read(en)),
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('survey question authoring', () => {
  beforeEach(() => {
    localStorage.setItem('climate_platform_token', 'test-token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  /**
   * THE test for this module. `CreateSurveyQuestionOptionInput.Value` is optional and the
   * server re-derives it from the label when omitted, so an editor that renames a choice
   * without carrying its key repoints every answer already recorded against it — silently,
   * with nothing failing at the time. Dropping `value` from `toQuestionInputs` fails here.
   */
  it('sends every option value back unchanged when only the labels were edited', async () => {
    stubReads({}, {})
    const authoring = await getSurveyQuestionAuthoring(BASE_URL, 's1')

    authoring.questions[0].options![0].label.en = { text: 'Very good', authored: true }
    authoring.questions[0].options![1].label.en = { text: 'Not good', authored: true }

    const [sent] = toQuestionInputs(authoring.questions) as [
      { options: { value: string; label: { en: string; es: string } }[] },
    ]

    expect(sent.options.map((o) => o.value)).toEqual(['opt-key-0', 'opt-key-1'])
    expect(sent.options.map((o) => o.label.en)).toEqual(['Very good', 'Not good'])
  })

  it('round-trips category, scale bounds and labels, and the comment configuration', async () => {
    stubReads({}, {})
    const authoring = await getSurveyQuestionAuthoring(BASE_URL, 's1')

    const [sent] = toQuestionInputs(authoring.questions) as [Record<string, unknown>]

    expect(sent.category).toBe('Bienestar')
    expect(sent.scaleMin).toBe(1)
    expect(sent.scaleMax).toBe(5)
    expect(sent.scaleLabelMin).toEqual({ en: 'Low', es: 'Low' })
    expect(sent.scaleLabelMax).toEqual({ en: 'High', es: 'High' })
    expect(sent.required).toBe(true)
    expect(sent.commentRequired).toBe(false)
    expect(sent.commentPrompt).toEqual({ en: 'Say more', es: 'Say more' })
    expect(sent.order).toBe(0)
  })

  /**
   * A field that resolved through fallback holds the OTHER language's words. Showing them
   * in this locale's box makes an untranslated question look translated, and saving it
   * copies them into the wrong column for real.
   */
  it('does not present a fallback value as this locale having content', async () => {
    stubReads(
      {},
      {
        text: 'How are you?',
        fallbackFields: ['questions[0].text', 'questions[0].options[0].label'],
      },
    )

    const authoring = await getSurveyQuestionAuthoring(BASE_URL, 's1')
    const q = authoring.questions[0]

    expect(q.text.en).toEqual({ text: 'How are you?', authored: true })
    expect(q.text.es).toEqual({ text: '', authored: false })
    expect(q.options![0].label.es).toEqual({ text: '', authored: false })
    // The option that did NOT fall back still carries its Spanish label.
    expect(q.options![1].label.es.authored).toBe(true)
  })

  /**
   * An unauthored locale is omitted, not sent as `''`. An English-only survey must not
   * write empty strings into every `*_es` column, and on a bilingual survey an
   * untranslated field must stay "not translated yet" rather than becoming "translated
   * to nothing" — the state `fallbackFields` reports and this editor exists to show.
   */
  it('omits a locale that holds no content instead of writing an empty one', async () => {
    stubReads(
      {},
      { fallbackFields: ['questions[0].text', 'questions[0].commentPrompt'] },
    )
    const authoring = await getSurveyQuestionAuthoring(BASE_URL, 's1')

    const [sent] = toQuestionInputs(authoring.questions) as [
      { text: Record<string, string>; commentPrompt: Record<string, string> },
    ]

    expect(sent.text).toEqual({ en: 'How are you?' })
    expect(Object.keys(sent.commentPrompt)).toEqual(['en'])
  })

  it('reads once for a monolingual survey and twice for a bilingual one', async () => {
    const bilingual = stubReads({}, {})
    await getSurveyQuestionAuthoring(BASE_URL, 's1')
    expect(bilingual).toHaveBeenCalledTimes(2)

    vi.unstubAllGlobals()
    const monolingual = stubReads({ language: 'en' }, { language: 'en' })
    await getSurveyQuestionAuthoring(BASE_URL, 's1')
    expect(monolingual).toHaveBeenCalledTimes(1)
  })

  /**
   * `UpdateSurveyRequest` treats an omitted member as "leave this alone", so sending
   * anything else would let an editor open in one tab clobber a change made in another.
   */
  it('sends questions and nothing else', async () => {
    stubReads({}, {})
    const authoring = await getSurveyQuestionAuthoring(BASE_URL, 's1')

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    vi.stubGlobal('fetch', fetchMock)

    await saveSurveyQuestions(BASE_URL, 's1', authoring.questions)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE_URL}/surveys/s1`)
    expect(init.method).toBe('PUT')
    expect(Object.keys(JSON.parse(String(init.body)))).toEqual(['questions'])
  })

  /**
   * Both 409s — a status that forbids content edits, and responses already existing — must
   * reach the author as the server's own sentence rather than a generic failure.
   */
  it('surfaces the server reason when the edit is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ message: 'A survey with responses cannot be edited' }),
      }),
    )

    await expect(saveSurveyQuestions(BASE_URL, 's1', [])).rejects.toThrow(
      'A survey with responses cannot be edited',
    )
  })
})
