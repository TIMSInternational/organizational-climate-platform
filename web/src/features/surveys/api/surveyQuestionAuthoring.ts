import { authFetch } from '../../../api/authFetch'
import { LOCALES, type Locale } from '../../../i18n'
import { getSurvey, type SurveyDetail, type SurveyQuestion } from './surveys'
import { type AuthoredText, requiredLocalesFor } from './surveyInvitationCopy'

/**
 * Reading and writing a draft survey's **questions** in every language it is written in.
 *
 * ## Why a second module rather than a field on `SurveyDetail`
 *
 * `GET /surveys/{id}` resolves content to ONE locale and reports what it had to fall back
 * on, which is exactly right for every screen that displays a survey and useless for one
 * that edits it: a single text box would file whichever language happened to be on screen
 * into whichever column the survey is written in. `surveyInvitationCopy` already solved
 * this for the two invitation fields, and this is the same solution applied to the
 * questions — same `AuthoredText`, same `requiredLocalesFor`, same rule that a value which
 * arrived through fallback is the OTHER language's words and must not be shown as this
 * one's.
 *
 * ## The one thing that must not go wrong here
 *
 * `CreateSurveyQuestionOptionInput.Value` is **optional**, and when it is omitted the
 * server re-derives it from the labels (`SurveyEndpoints.cs` → `DeriveOptionValue`). That
 * value is the aggregation join key every stored answer points at. So an editor that
 * round-trips an option's label without carrying its existing `value` does not "just"
 * rename a choice — it silently repoints every answer already recorded against it, and
 * nothing fails at the time. Every option read here keeps its `value` verbatim and sends
 * it back unchanged; `toQuestionInputs` has no path that omits it.
 *
 * ## Why the merge is keyed the way it is
 *
 * `fallbackFields` paths are built from `Order`, not array position —
 * `questions[{question.Order}].options[{option.Order}].label`. Two reads of the same
 * survey therefore agree on those paths even if the API ever returned questions in a
 * different sequence, so the merge matches on question id and option value rather than on
 * index, and computes the paths from the orders the payload itself reports.
 */

export interface AuthoringOption {
  /**
   * The stable, locale-independent aggregation key, exactly as the server stores it.
   * Never regenerated on this side. See the module note above.
   */
  value: string
  label: Record<Locale, AuthoredText>
}

export interface AuthoringQuestion {
  id: string
  type: string
  order: number
  category: string | null
  required: boolean
  commentRequired: boolean
  scaleMin: number | null
  scaleMax: number | null
  text: Record<Locale, AuthoredText>
  scaleLabelMin: Record<Locale, AuthoredText>
  scaleLabelMax: Record<Locale, AuthoredText>
  commentPrompt: Record<Locale, AuthoredText>
  options: AuthoringOption[] | null
}

export interface SurveyQuestionAuthoring {
  surveyId: string
  /** Resolved for display only — the breadcrumb. Null when no language holds one (#195). */
  title: string | null
  language: string
  status: string
  locales: Locale[]
  questions: AuthoringQuestion[]
}

function blank(): AuthoredText {
  return { text: '', authored: false }
}

/**
 * One field, in one locale.
 *
 * A value that resolved through fallback is the other language's text. Reporting it as
 * this locale's content would make an untranslated question look translated, and saving it
 * would copy it into the wrong column for real — the same trap `surveyInvitationCopy`
 * documents for the invitation fields.
 */
function authored(payload: SurveyDetail, path: string, value: string | null): AuthoredText {
  if (value === null || payload.fallbackFields.includes(path)) return blank()
  return { text: value, authored: true }
}

function emptyByLocale(): Record<Locale, AuthoredText> {
  return Object.fromEntries(LOCALES.map((l) => [l, blank()])) as Record<Locale, AuthoredText>
}

/**
 * Fold one locale's read into the accumulator.
 *
 * Exported for the tests, which need to prove the fallback rule per field rather than only
 * through a two-request round trip.
 */
export function mergeLocaleRead(
  into: Map<string, AuthoringQuestion>,
  locale: Locale,
  payload: SurveyDetail,
): void {
  for (const question of payload.questions ?? []) {
    const path = `questions[${question.order}]`
    const existing = into.get(question.id) ?? seed(question)
    existing.text[locale] = authored(payload, `${path}.text`, question.text)
    existing.scaleLabelMin[locale] = authored(payload, `${path}.scaleLabelMin`, question.scaleLabelMin)
    existing.scaleLabelMax[locale] = authored(payload, `${path}.scaleLabelMax`, question.scaleLabelMax)
    existing.commentPrompt[locale] = authored(payload, `${path}.commentPrompt`, question.commentPrompt)

    for (const option of question.options ?? []) {
      const match = existing.options?.find((o) => o.value === option.value)
      if (match) {
        match.label[locale] = authored(
          payload,
          `${path}.options[${option.order}].label`,
          option.label,
        )
      }
    }

    into.set(question.id, existing)
  }
}

/**
 * The locale-independent skeleton, taken from whichever read arrives first.
 *
 * Option `value` and `order` are established here and never touched again — the labels are
 * what vary by locale, and the key must not.
 */
function seed(question: SurveyQuestion): AuthoringQuestion {
  return {
    id: question.id,
    type: question.type,
    order: question.order,
    category: question.category,
    required: question.required,
    commentRequired: question.commentRequired,
    scaleMin: question.scaleMin,
    scaleMax: question.scaleMax,
    text: emptyByLocale(),
    scaleLabelMin: emptyByLocale(),
    scaleLabelMax: emptyByLocale(),
    commentPrompt: emptyByLocale(),
    options:
      question.options?.map((option) => ({
        value: option.value,
        label: emptyByLocale(),
      })) ?? null,
  }
}

/**
 * Read a survey once per language it is written in, and merge the reads into an editable
 * shape.
 *
 * A monolingual survey costs one request, not two: `requiredLocalesFor` returns the single
 * locale, and asking for a language the survey is not written in would come back as
 * fallback for every field anyway.
 */
export async function getSurveyQuestionAuthoring(
  baseUrl: string,
  id: string,
): Promise<SurveyQuestionAuthoring> {
  const first = await getSurvey(baseUrl, id, 'en')
  const locales = requiredLocalesFor(first.language)

  const reads = new Map<Locale, SurveyDetail>()
  reads.set('en', first)
  for (const locale of locales) {
    if (!reads.has(locale)) reads.set(locale, await getSurvey(baseUrl, id, locale))
  }

  const merged = new Map<string, AuthoringQuestion>()
  for (const locale of locales) {
    const payload = reads.get(locale)
    if (payload) mergeLocaleRead(merged, locale, payload)
  }

  return {
    surveyId: id,
    title: first.title,
    language: first.language,
    status: first.status,
    locales,
    questions: [...merged.values()].sort((a, b) => a.order - b.order),
  }
}

/**
 * A `LocalizedInput`, carrying only the locales that actually hold content.
 *
 * An unauthored locale is OMITTED rather than sent as `''`, and the distinction is real
 * in both directions. A survey written in English only would otherwise write empty strings
 * into every `*_es` column it does not use; and on a `both` survey an untranslated field
 * would be stored as "translated to nothing" rather than "not translated yet", which is
 * the state `fallbackFields` exists to report and this editor exists to show.
 *
 * It also means this function needs no locale list: a locale the survey is not written in
 * is never read, so it is never authored, so it is never sent.
 */
function localized(by: Record<Locale, AuthoredText>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const locale of LOCALES) {
    if (by[locale]?.authored) out[locale] = by[locale].text
  }
  return out
}

/**
 * The PUT payload.
 *
 * `value` is present on every option unconditionally. There is deliberately no branch that
 * omits it — see the module note: omitting it makes the server re-derive the join key from
 * the label, which repoints answers already recorded.
 */
export function toQuestionInputs(questions: AuthoringQuestion[]): unknown[] {
  return questions.map((question) => ({
    text: localized(question.text),
    type: question.type,
    options:
      question.options?.map((option) => ({
        value: option.value,
        label: localized(option.label),
      })) ?? null,
    scaleMin: question.scaleMin,
    scaleMax: question.scaleMax,
    scaleLabelMin: localized(question.scaleLabelMin),
    scaleLabelMax: localized(question.scaleLabelMax),
    required: question.required,
    commentRequired: question.commentRequired,
    commentPrompt: localized(question.commentPrompt),
    order: question.order,
    category: question.category,
  }))
}

/**
 * Replace the survey's questions.
 *
 * Only `questions` is sent. `UpdateSurveyRequest` treats every omitted member as "leave
 * this alone", so an editor that restated the title, dates and settings would be an
 * editor that can clobber them by being open in another tab.
 *
 * The server refuses with 409 twice — a status that does not allow content edits, and any
 * response existing even on a draft. `authFetch` turns both into a thrown `Error` carrying
 * the server's own message, which is the sentence the author needs to read.
 */
export async function saveSurveyQuestions(
  baseUrl: string,
  id: string,
  questions: AuthoringQuestion[],
): Promise<void> {
  await authFetch(`${baseUrl}/surveys/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ questions: toQuestionInputs(questions) }),
  })
}
