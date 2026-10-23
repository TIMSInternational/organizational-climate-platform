import type { TranslateFn } from '../i18n'
import { ApiError } from './authFetch'

/**
 * The sentence an ADMIN screen shows for a failed request, always in the reader's language.
 *
 * ## Why this exists (G30)
 *
 * About a hundred admin catch blocks did `err instanceof Error ? err.message : t(…)`. Every
 * `ApiError` is an `Error`, and its message is the API's own words — English
 * (`new { message = "User not found" }`, 479 sites in `src/ClimateProject.Api`) — or, when the
 * body carried no `message`, the synthetic `Request failed: 403`. The tracking service answers
 * `{ error }`, never `{ message }`, so every tracking refusal arrived as `Request failed: N`.
 * Either way a Spanish administrator read English, and the `t(…)` fallback after the `?` was
 * unreachable for anything `authFetch` threw.
 *
 * ## The rule
 *
 * 1. A refusal whose `code` this module knows is said in the reader's language.
 * 2. Otherwise the STATUS decides: 401 / 403 / 404 / 409 / 413 / 429 / 5xx each have a sentence.
 * 3. Any other refusal (400, 422, …) gets the screen's own `fallbackKey` — "No se pudo guardar
 *    la persona" says more than a generic line, and only the screen knows what it was doing —
 *    or, when the screen names none, `errors.api.rejected` ("Revise los datos…").
 * 4. A transport failure keeps `authFetch`'s message, which is already `errors.networkError`
 *    in the reader's language (the one message here that was never English).
 * 5. Anything else — a plain `Error` some wrapper built from the body, a non-`Error` — is the
 *    fallback. The server's text is never shown.
 *
 * The cost is stated, not hidden: an English reader loses the server's specific sentence for
 * a 400 whose refusal carries no code ("Send either departmentId or clearDepartment, not both") and gets the screen's fallback instead. The
 * catalogue has no locale flag this function could branch on without the caller passing one,
 * and a screen that needs a specific refusal should map its `code` (as `emailRefusal.ts` and
 * the intake wizard already do) rather than lean on English prose.
 *
 * Admin screens only. Respondent and employee screens keep their own handling
 * (`respondFailure.ts`, `derive.ts` under the invitation pages) and are deliberately untouched.
 */
export function describeApiError(error: unknown, t: TranslateFn, fallbackKey?: string): string {
  const known = describeKnownRefusal(error, t)
  if (known !== null) return known
  if (error instanceof ApiError) {
    const statusKey = statusKeyFor(error.status)
    return t(statusKey ?? fallbackKey ?? 'errors.api.rejected')
  }
  if (error instanceof Error && isNetworkFailure(error, t)) {
    return t('errors.networkError')
  }
  return t(fallbackKey ?? 'errors.generic')
}

/**
 * The sentence for a refusal whose `code` this module knows, or null. For a screen that keeps
 * its own status-based copy (the survey window and audience dialogs) but should still say a
 * specific refusal when the API names one.
 */
export function describeKnownRefusal(error: unknown, t: TranslateFn): string | null {
  if (!(error instanceof ApiError) || !error.code) return null
  const codeKey = CODE_KEYS[error.code]
  return codeKey ? t(codeKey) : null
}

/**
 * The API's `code`s an admin can meet, spelled out; `describeApiError.test.ts` checks each key
 * resolves in both catalogues.
 * Bulk-import codes are not here: they arrive as `IntakeRequestError`, which the intake
 * wizard already translates. `bad_request` / `not_found` are left to the status.
 */
const CODE_KEYS: Readonly<Record<string, string>> = {
  survey_ended_audience_frozen: 'errors.api.codes.survey_ended_audience_frozen',
  credential_mode_frozen: 'errors.api.codes.credential_mode_frozen',
  not_mass_invite: 'errors.api.codes.not_mass_invite',
  inactive: 'errors.api.codes.inactive',
  batch_too_large: 'errors.api.codes.batch_too_large',
  per_survey_person: 'errors.api.codes.per_survey_person',
  // Org structure, company and people (AdminRefusals.cs)
  department_name_taken: 'errors.api.codes.department_name_taken',
  demographic_field_key_taken: 'errors.api.codes.demographic_field_key_taken',
  demographic_field_key_reserved: 'errors.api.codes.demographic_field_key_reserved',
  demographic_field_options_required: 'errors.api.codes.demographic_field_options_required',
  user_own_manager: 'errors.api.codes.user_own_manager',
  company_domain_taken: 'errors.api.codes.company_domain_taken',
  company_domain_invalid: 'errors.api.codes.company_domain_invalid',
  // Survey authoring, schedule and lifecycle
  survey_dates_out_of_order: 'errors.api.codes.survey_dates_out_of_order',
  survey_content_locked: 'errors.api.codes.survey_content_locked',
  survey_content_has_responses: 'errors.api.codes.survey_content_has_responses',
  survey_schedule_frozen: 'errors.api.codes.survey_schedule_frozen',
  survey_start_frozen: 'errors.api.codes.survey_start_frozen',
  survey_revert_has_responses: 'errors.api.codes.survey_revert_has_responses',
  survey_no_questions: 'errors.api.codes.survey_no_questions',
  survey_missing_translations: 'errors.api.codes.survey_missing_translations',
  survey_delete_has_responses: 'errors.api.codes.survey_delete_has_responses',
  question_text_required: 'errors.api.codes.question_text_required',
  question_option_duplicate: 'errors.api.codes.question_option_duplicate',
  question_options_too_few: 'errors.api.codes.question_options_too_few',
  // Survey distribution
  survey_not_distributable: 'errors.api.codes.survey_not_distributable',
  survey_window_closed: 'errors.api.codes.survey_window_closed',
  survey_reminders_off: 'errors.api.codes.survey_reminders_off',
  survey_not_collecting: 'errors.api.codes.survey_not_collecting',
  // Microclimates
  microclimate_window_out_of_order: 'errors.api.codes.microclimate_window_out_of_order',
  microclimate_closed_window: 'errors.api.codes.microclimate_closed_window',
  microclimate_not_draft: 'errors.api.codes.microclimate_not_draft',
  microclimate_window_elapsed: 'errors.api.codes.microclimate_window_elapsed',
  microclimate_missing_translations: 'errors.api.codes.microclimate_missing_translations',
  microclimate_invite_window_closed: 'errors.api.codes.microclimate_invite_window_closed',
  // Reports and the question bank
  report_schedule_start_past: 'errors.api.codes.report_schedule_start_past',
  question_bank_item_in_use: 'errors.api.codes.question_bank_item_in_use',
  question_bank_item_has_variations: 'errors.api.codes.question_bank_item_has_variations',
}

/** Every `code` with a sentence here — for the test that sweeps the API's list against it. */
export const KNOWN_REFUSAL_CODES: readonly string[] = Object.freeze(Object.keys(CODE_KEYS))

function statusKeyFor(status: number): string | null {
  if (status === 401) return 'errors.sessionExpired'
  if (status === 403) return 'errors.api.forbidden'
  if (status === 404) return 'errors.api.notFound'
  if (status === 409) return 'errors.api.conflict'
  if (status === 413) return 'errors.api.tooLarge'
  if (status === 429) return 'errors.api.rateLimited'
  if (status >= 500) return 'errors.api.server'
  return null
}

/**
 * `authFetch` throws a plain `Error` carrying `errors.networkError` (already translated) with
 * the browser's `TypeError` as its `cause` when the request never completed.
 */
function isNetworkFailure(error: Error, t: TranslateFn): boolean {
  return error.cause instanceof TypeError || error.message === t('errors.networkError')
}
