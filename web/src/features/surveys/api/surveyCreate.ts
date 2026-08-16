import { authFetch } from '../../../api/authFetch'
import type { SurveyDetail } from './surveys'

/**
 * The write half of `/surveys` — `POST /surveys` (`SurveyEndpoints.CreateAsync`).
 *
 * Its own module rather than an addition to `surveys.ts`, because that file states
 * the boundary explicitly: "No write DTOs here. Create/update take `LocalizedInput`
 * and belong to the wizard (#108). This lane is the read/browse/manage surface."
 * This is that wizard's lane.
 *
 * ## `LocalizedInput`, and why the wizard cannot avoid it
 *
 * Every authored string on the way *in* is `string | { en?, es? }` — the same shape
 * the microclimates client uses. A bare string means "this text, in whatever the
 * survey's language is"; the object form is what a `'both'` survey needs, and the
 * server's publish gate refuses to activate a bilingual survey with a language
 * missing. So the wizard has to know which of the two it is building, and
 * `wizardValues.ts` is where that decision lives.
 *
 * ## Status is deliberately absent
 *
 * `CreateSurveyRequest` has no status field and `CreateAsync` writes `draft`. There
 * is a separate `PUT /surveys/{id}/status` for the lifecycle, guarded by the publish
 * gate. So this call cannot launch a survey and the wizard must not imply that it
 * can — the review step says what it is about to make.
 */

/** `string | { en?, es? }` — see the note above. Matches `LocalizedInput.cs`. */
export type LocalizedInput = string | Partial<Record<'en' | 'es', string>>

export interface CreateSurveyQuestionOptionInput {
  /**
   * The stable, locale-independent key aggregation joins on. Omitted lets the server
   * derive one from the label — which is what keeps two surveys built from the same
   * template aggregating together, and why a client-invented value would be wrong.
   */
  value?: string
  label: LocalizedInput
}

export interface CreateSurveyQuestionInput {
  text: LocalizedInput
  /** One of `QuestionTypes.ForSurvey`: likert, multiple_choice, ranking, open_ended, yes_no, rating. */
  type: string
  options?: CreateSurveyQuestionOptionInput[]
  scaleMin?: number
  scaleMax?: number
  /**
   * The words at the ends of a likert/rating scale. Respondents read them under
   * the scale and the results page prints them under each distribution — the
   * server has accepted both since the DTO existed (`SurveyDtos.cs`), and until
   * the wizard collected them nothing in the product ever sent one.
   */
  scaleLabelMin?: LocalizedInput
  scaleLabelMax?: LocalizedInput
  required?: boolean
  order?: number
  /**
   * `Question.Category` — the dimension vocabulary. A free string the server
   * neither trims nor validates, and THE key the climate map, the standings
   * table and the respond page's sections group on. Send the raw key
   * (`psychological_safety`), never a display name.
   */
  category?: string
}

/**
 * Every field is optional and omitting one means "leave the server's default alone",
 * so the wizard sends only what it actually asked the admin about. Sending the whole
 * record with invented defaults would silently overwrite fifteen settings the flow
 * never showed anyone.
 */
export interface CreateSurveySettingsInput {
  anonymous?: boolean
  allowPartialResponses?: boolean
  showProgress?: boolean
}

export interface CreateSurveyInput {
  title: LocalizedInput
  companyId: string
  /** periodic | onboarding | exit | pulse | engagement | satisfaction | custom. */
  type: string
  /** ISO 8601. */
  startDate: string
  endDate: string
  description?: LocalizedInput
  departmentIds?: string[]
  questions?: CreateSurveyQuestionInput[]
  settings?: CreateSurveySettingsInput
  targetAudienceCount?: number
  /** 'en' | 'es' | 'both'. Omitted inherits the company's own language. */
  language?: string
}

/**
 * Create a draft survey.
 *
 * Answers `201` with the full `SurveyDetail`, so the caller navigates to
 * `/surveys/{returned.id}` rather than re-fetching. `lang` is the *display* locale
 * for the response, not the survey's content language — those are different
 * questions and `language` on the input is the second one.
 */
export async function createSurvey(
  baseUrl: string,
  input: CreateSurveyInput,
  lang?: string,
): Promise<SurveyDetail> {
  const query = lang ? `?lang=${encodeURIComponent(lang)}` : ''
  const response = await authFetch(`${baseUrl}/surveys${query}`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<SurveyDetail>
}
