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
 * a 400 ("A person cannot be their own manager") and gets the screen's fallback instead. The
 * catalogue has no locale flag this function could branch on without the caller passing one,
 * and a screen that needs a specific refusal should map its `code` (as `emailRefusal.ts` and
 * the intake wizard already do) rather than lean on English prose.
 *
 * Admin screens only. Respondent and employee screens keep their own handling
 * (`respondFailure.ts`, `derive.ts` under the invitation pages) and are deliberately untouched.
 */
export function describeApiError(error: unknown, t: TranslateFn, fallbackKey?: string): string {
  if (error instanceof ApiError) {
    const codeKey = error.code ? CODE_KEYS[error.code] : undefined
    if (codeKey) return t(codeKey)
    const statusKey = statusKeyFor(error.status)
    return t(statusKey ?? fallbackKey ?? 'errors.api.rejected')
  }
  if (error instanceof Error && isNetworkFailure(error, t)) {
    return t('errors.networkError')
  }
  return t(fallbackKey ?? 'errors.generic')
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
}

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
