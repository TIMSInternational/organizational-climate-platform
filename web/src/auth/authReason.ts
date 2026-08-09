/**
 * Which auth failure happened, as a value rather than a string in a component.
 *
 * ## Why this is a module and not a `switch` inside `AuthErrorPage`
 *
 * The reason travels through a URL — `/auth/error?reason=maintenance` — so it is
 * attacker-controlled in the trivial sense that anyone can type one. Narrowing it
 * to a closed set in one tested place means the page can never render a key path
 * it was handed (`errorKey` lookups on an unvalidated string are how untranslated
 * text and `undefined` end up on screen), and the fallback is decided once.
 *
 * It is also the mapping from an HTTP status to a state, which two callers need:
 * `LoginPage` and `RegisterPage` both have to decide whether a failure is a
 * form-level "try again" or a condition worth a whole page.
 *
 * ## The statuses, and why only two of them leave the form
 *
 * `AuthEndpoints.CheckSystemSettingsGateAsync` is the only producer of 403 and
 * 503 on `/auth/login` and `/auth/signup`, and both are *platform* conditions,
 * not credential conditions:
 *
 * - **503** — `SystemSettings.MaintenanceMode`. The message is authored content
 *   (#195), resolved per-locale by the server, so the page prefers the server's
 *   text over the catalogue's.
 * - **403** — `SystemSettings.LoginEnabled == false`. An administrator turned
 *   sign-in off; retyping a password will never help.
 *
 * A 401, a 409 (email taken) or a 400 (validation) is about *this attempt* and
 * belongs beside the field the user can fix, so it stays on the form. Sending
 * those to a full-page error would lose the form state and read as a crash.
 */

export const AUTH_ERROR_REASONS = [
  'login-disabled',
  'maintenance',
  'session-expired',
  'google-signin',
  'unknown',
] as const

export type AuthErrorReason = (typeof AUTH_ERROR_REASONS)[number]

/** Catalogue paths for one reason. Both always resolve; `unknown` is the floor. */
export interface AuthErrorCopy {
  titleKey: string
  descriptionKey: string
}

const COPY: Record<AuthErrorReason, AuthErrorCopy> = {
  'login-disabled': {
    titleKey: 'auth.loginDisabledTitle',
    descriptionKey: 'auth.loginDisabledDetail',
  },
  maintenance: {
    titleKey: 'auth.maintenanceTitle',
    descriptionKey: 'auth.maintenanceDetail',
  },
  'session-expired': {
    titleKey: 'auth.sessionExpiredTitle',
    descriptionKey: 'auth.sessionExpired',
  },
  // The Google round trip's own failures (#81): the fragment carried no usable
  // token, or `POST /auth/google` refused it. Distinct from the two above because
  // password sign-in is still available — the page says so rather than implying
  // the platform is down.
  'google-signin': {
    titleKey: 'auth.googleFailedTitle',
    descriptionKey: 'auth.googleFailedDetail',
  },
  unknown: {
    titleKey: 'auth.errorTitle',
    descriptionKey: 'auth.errorDetail',
  },
}

/** Narrows an arbitrary query-string value. Anything unrecognised is `unknown`. */
export function toAuthErrorReason(raw: string | null | undefined): AuthErrorReason {
  return AUTH_ERROR_REASONS.includes(raw as AuthErrorReason) ? (raw as AuthErrorReason) : 'unknown'
}

export function authErrorCopy(reason: AuthErrorReason): AuthErrorCopy {
  return COPY[reason]
}

/**
 * The reason a whole page is warranted, or `null` to stay on the form.
 *
 * `null` is not "no error" — it is "this error belongs to the form", which is why
 * it is a distinct return rather than `'unknown'`.
 */
export function pageWorthyReason(status: number): AuthErrorReason | null {
  if (status === 503) return 'maintenance'
  if (status === 403) return 'login-disabled'
  return null
}
