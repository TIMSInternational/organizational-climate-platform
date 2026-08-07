import { authFetch } from '../../../api/authFetch'
import type { SurveyDetail } from './surveys'

/**
 * Typed client for `/survey-templates` (`SurveyTemplateEndpoints.cs`, landed in #107).
 *
 * ## Two shapes, and a third that is not a template at all
 *
 * - `GET /survey-templates` returns `SurveyTemplateListItem` -- catalogue metadata plus
 *   a `questionCount`, and **no questions**.
 * - `GET /survey-templates/{id}` returns `SurveyTemplateDetail`, which adds the
 *   questions, the inferred `language`, and the `resolvedLocale`/`fallbackFields` pair.
 * - `POST /survey-templates/{id}/use` returns a **`SurveyDetail`**, not a template. It
 *   instantiates the template into a real survey and answers `201`. Typing it as a
 *   template would be a page navigating to `/surveys/{templateId}`.
 *
 * ## What is and is not localized here, which is not what you would guess
 *
 * Template *questions* are localized the usual #195 way: already resolved, with
 * `resolvedLocale` naming the language the text is actually in.
 *
 * `name`, `description` and `category` are **not**. `survey_templates.name` and
 * `.description` are single `text` columns -- #195 gave paired `_en`/`_es` treatment to
 * `template_questions` only -- so a template's catalogue metadata is currently
 * monolingual however its questions are authored. That is a real parity gap the
 * endpoint documents rather than fakes, and it is why `SurveyTemplateDetail.language`
 * describes the *questions* and not the name above them.
 *
 * `language` is **inferred from the question rows**, not stored: `survey_templates` has
 * no language column. So declaring one language at create time and supplying another's
 * text cannot produce a template that lies about itself.
 */

export interface SurveyTemplateQuestionOption {
  order: number
  /** The stable, locale-independent key. Survives instantiation into the new survey. */
  value: string
  label: string | null
}

export interface SurveyTemplateQuestion {
  id: string
  /** Already resolved for the requested locale. */
  text: string | null
  type: string
  options: SurveyTemplateQuestionOption[] | null
  scaleMin: number | null
  scaleMax: number | null
  scaleLabelMin: string | null
  scaleLabelMax: string | null
  required: boolean
  commentRequired: boolean
  commentPrompt: string | null
  order: number
  category: string | null
}

/** A row of `GET /survey-templates`. */
export interface SurveyTemplateListItem {
  id: string
  name: string
  description: string
  category: string
  industry: string | null
  companySize: string | null
  isPublic: boolean
  companyId: string | null
  /**
   * `companyId === null`, restated by the server as a flag so a client does not infer
   * a security-relevant property from a null. A global template is visible to every
   * tenant and writable only by a super admin.
   */
  isGlobal: boolean
  tags: string[]
  usageCount: number
  rating: number
  questionCount: number
  lastUsed: string | null
  createdAt: string
}

/** `GET /survey-templates/{id}`. */
export interface SurveyTemplateDetail {
  id: string
  name: string
  description: string
  category: string
  industry: string | null
  companySize: string | null
  isPublic: boolean
  companyId: string | null
  isGlobal: boolean
  tags: string[]
  usageCount: number
  rating: number
  /** The language the QUESTIONS are authored in, inferred from the rows. */
  language: string
  /** The locale this payload is actually written in. May differ from the one asked for. */
  resolvedLocale: string
  fallbackFields: string[]
  questions: SurveyTemplateQuestion[]
  sourceSurveyId: string | null
  lastUsed: string | null
  createdAt: string
  updatedAt: string
}

/** Server-side filters accepted by `GET /survey-templates`. */
export interface SurveyTemplateListFilters {
  companyId?: string
  category?: string
  /** Free-text match. */
  q?: string
}

/**
 * The body of `POST /survey-templates/{id}/use`.
 *
 * `companyId` is optional for a company admin -- their own company is the only legal
 * answer -- and **required for a super admin**, who has had no implicit tenant since
 * #191. That is why the detail page reads `useCompanyScope()` before offering the
 * action rather than after it fails.
 *
 * `language` is deliberately omitted from this type. It defaults server-side to the
 * language the template's questions are actually authored in, which is the only value
 * that cannot produce a survey failing its own publish gate for a language it never
 * had. Choosing one belongs to the wizard (#108), which can also supply the localized
 * title that a `'both'` survey then requires.
 */
export interface InstantiateSurveyTemplateInput {
  companyId?: string
  type?: string
  startDate?: string
  endDate?: string
  departmentIds?: string[]
  targetAudienceCount?: number
}

function withQuery(baseUrl: string, path: string, params: Record<string, string | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, value)
    }
  }
  const query = search.toString()
  return query ? `${baseUrl}${path}?${query}` : `${baseUrl}${path}`
}

/**
 * The templates the caller may use.
 *
 * Admin-only (`Roles.Admin`), and scoped by the server: a super admin sees every
 * tenant's plus the global ones, a company admin sees the global ones plus their own.
 * No `companyId` is sent by default, exactly as with `listSurveys`.
 *
 * Optional arguments last -- a prior bug in this repo put a defaulted `baseUrl` ahead
 * of the required ones and broke five exports.
 */
export async function listSurveyTemplates(
  baseUrl: string,
  filters: SurveyTemplateListFilters = {},
  lang?: string,
): Promise<SurveyTemplateListItem[]> {
  const response = await authFetch(
    withQuery(baseUrl, '/survey-templates', {
      companyId: filters.companyId,
      category: filters.category,
      q: filters.q,
      lang,
    }),
  )
  const body = (await response.json()) as { templates: SurveyTemplateListItem[] }
  return body.templates
}

export async function getSurveyTemplate(
  baseUrl: string,
  id: string,
  lang?: string,
): Promise<SurveyTemplateDetail> {
  const response = await authFetch(withQuery(baseUrl, `/survey-templates/${id}`, { lang }))
  return response.json() as Promise<SurveyTemplateDetail>
}

/**
 * Instantiate a template into a new draft survey.
 *
 * Returns the **survey**, not the template: the response is a `SurveyDetail` with a
 * `201`, so the caller navigates to `/surveys/{returned.id}`. The instantiation copies
 * every option's stable value, which is what lets surveys built from one template
 * aggregate together.
 */
export async function instantiateSurveyTemplate(
  baseUrl: string,
  id: string,
  input: InstantiateSurveyTemplateInput = {},
  lang?: string,
): Promise<SurveyDetail> {
  const response = await authFetch(withQuery(baseUrl, `/survey-templates/${id}/use`, { lang }), {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<SurveyDetail>
}

/** `DELETE /survey-templates/{id}` answers 204, so there is no body to parse. */
export async function deleteSurveyTemplate(baseUrl: string, id: string): Promise<void> {
  await authFetch(`${baseUrl}/survey-templates/${id}`, { method: 'DELETE' })
}
