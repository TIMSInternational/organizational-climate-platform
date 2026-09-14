import { pageWorthyReason, type AuthErrorReason } from '../authReason'

/**
 * The pure rules behind the five auth artboards (Login, Register, AuthError,
 * AuthTransition, AccountInactive of 10 Sep).
 *
 * Nothing here touches React, `fetch` or storage: it is only the decisions the five
 * screens make — which sentence a refusal gets, whether that refusal belongs beside the
 * field or takes the whole page, and what the register form can tell the user before it
 * submits anything.
 *
 * ## Why the copy is decided here and not in the page
 *
 * `/auth/error?reason=…` is a URL, so the reason is attacker-typeable in the trivial
 * sense. `authReason.ts` already narrows it to a closed set; this module maps that closed
 * set onto the redesigned page's three catalogue paths, so the page can never render a key
 * path it was handed and the fallback is decided once, in a tested place.
 */

/** The eyebrow, heading and body one auth state prints. All three always resolve. */
export interface AuthStateCopy {
  eyebrowKey: string
  titleKey: string
  bodyKey: string
}

const K = 'auth.next'

/**
 * One phrase per reason inside the same frame — the AuthError artboard's own rule.
 *
 * The four it draws are the four `authReason.ts` produces, plus `unknown` as the floor.
 * The sentences are the artboard's, which differ from `auth.*`'s older ones on purpose:
 * each names what happened to the *platform* and what the reader can do next, rather than
 * paraphrasing a status code.
 */
const STATE_COPY: Record<AuthErrorReason, AuthStateCopy> = {
  'login-disabled': {
    eyebrowKey: `${K}.errorEyebrow`,
    titleKey: `${K}.loginDisabledTitle`,
    bodyKey: `${K}.loginDisabledBody`,
  },
  maintenance: {
    eyebrowKey: `${K}.errorEyebrow`,
    titleKey: `${K}.maintenanceTitle`,
    bodyKey: `${K}.maintenanceBody`,
  },
  'session-expired': {
    eyebrowKey: `${K}.errorEyebrow`,
    titleKey: `${K}.sessionExpiredTitle`,
    bodyKey: `${K}.sessionExpiredBody`,
  },
  'google-signin': {
    eyebrowKey: `${K}.errorEyebrow`,
    titleKey: `${K}.googleFailedTitle`,
    bodyKey: `${K}.googleFailedBody`,
  },
  unknown: {
    eyebrowKey: `${K}.errorEyebrow`,
    titleKey: `${K}.unknownFailureTitle`,
    bodyKey: `${K}.unknownFailureBody`,
  },
}

export function authStateCopy(reason: AuthErrorReason): AuthStateCopy {
  return STATE_COPY[reason]
}

/**
 * `SystemSettings.PasswordPolicy`'s shipped defaults, verbatim:
 * `src/ClimateProject.Domain/Entities/SystemSettings.cs:22-26` — `MinLength = 8`,
 * uppercase, lowercase and numbers required, special characters not.
 *
 * **The server is authoritative and this is a copy of its default**, which is exactly
 * what the Register artboard states on screen ("Al menos 8 caracteres, con una mayúscula,
 * una minúscula y un número."). There is no unauthenticated endpoint that reads the
 * policy back — `GET /admin/system/settings` is admin-only and a person on the register
 * page holds no token — so the alternative to naming the default is naming nothing and
 * letting the server reject the form with a sentence in English. An administrator who
 * loosens the policy makes this line stricter than the rule, never laxer: the button
 * disables on a password the server would have taken, and nothing is accepted that the
 * server refuses.
 */
export const DEFAULT_PASSWORD_POLICY = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
} as const

/**
 * bcrypt silently truncates past 72 bytes, so the server rejects longer passwords rather
 * than hash a prefix (`PasswordPolicyValidation.MaxLength`). Mirrored so the form does not
 * offer to submit one.
 */
export const MAX_PASSWORD_LENGTH = 72

export function meetsPasswordPolicy(password: string): boolean {
  if (password.length < DEFAULT_PASSWORD_POLICY.minLength) return false
  if (password.length > MAX_PASSWORD_LENGTH) return false
  if (DEFAULT_PASSWORD_POLICY.requireUppercase && !/\p{Lu}/u.test(password)) return false
  if (DEFAULT_PASSWORD_POLICY.requireLowercase && !/\p{Ll}/u.test(password)) return false
  if (DEFAULT_PASSWORD_POLICY.requireNumbers && !/\d/.test(password)) return false
  return true
}

/**
 * The part after the `@`, or `null`.
 *
 * `SignupAsync` matches `Companies.EmailDomain` against exactly this, so it is the one
 * fact the register form can state before it submits: which organisation the address
 * decides. An address with no `@`, or nothing after it, decides nothing and gets `null`
 * rather than an empty string that would print as a domain of no characters.
 */
export function domainOf(email: string): string | null {
  const at = email.indexOf('@')
  if (at < 0) return null
  const domain = email.slice(at + 1).trim()
  return domain.length > 0 && !domain.includes('@') ? domain.toLowerCase() : null
}

/**
 * Where a failed sign-in belongs.
 *
 * `form` keeps the user on the page with what they typed; `page` hands the whole screen
 * to `/auth/error` with a reason. `pageWorthyReason` owns the status→reason half of that
 * (503 maintenance, 403 disabled) and is not re-implemented here.
 *
 * The one addition is the 401 sentence. The server answers 401 identically for a wrong
 * password and a deactivated account — deliberately, so nobody can enumerate addresses —
 * so the page must not echo the server's "Invalid email or password" as though it had
 * diagnosed one of the two. `messageKey` is the catalogue's own pair of sentences, which
 * say that the response is deliberately ambiguous.
 */
export type LoginOutcome =
  | { kind: 'form'; titleKey: string; bodyKey: string }
  | { kind: 'form-server'; message: string }
  | { kind: 'page'; reason: AuthErrorReason }

export function loginOutcome(status: number, message: string): LoginOutcome {
  const reason = pageWorthyReason(status)
  if (reason) return { kind: 'page', reason }
  if (status === 401) {
    return { kind: 'form', titleKey: `${K}.credentialsTitle`, bodyKey: `${K}.credentialsBody` }
  }
  return { kind: 'form-server', message }
}

/**
 * Where a failed registration belongs.
 *
 * `invitation` is the 404 branch and is **not** a failure: no company has registered that
 * domain, which is the product's own onboarding rule (users arrive by invitation unless
 * their employer's domain is registered). The artboard says so in the catalogue's words
 * with the domain named, rather than printing the server's English sentence — which is
 * the defect its annotation records.
 *
 * 400 (validation) and 409 (address taken) are about this attempt and stay on the form in
 * the server's own words; 403 and 503 are the platform and take the page, identically to
 * sign-in, because it is the same `CheckSystemSettingsGateAsync` refusing.
 */
export type RegisterOutcome =
  | { kind: 'invitation' }
  | { kind: 'form-server'; message: string }
  | { kind: 'page'; reason: AuthErrorReason }

export function registerOutcome(status: number, message: string): RegisterOutcome {
  const reason = pageWorthyReason(status)
  if (reason) return { kind: 'page', reason }
  if (status === 404) return { kind: 'invitation' }
  return { kind: 'form-server', message }
}
