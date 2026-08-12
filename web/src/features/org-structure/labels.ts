/**
 * Catalogue keys for the closed vocabularies the org-structure API speaks.
 *
 * ## Why these are not translated at the call site
 *
 * `role`, `invitationType` and `invitationStatus` arrive from the API as
 * lowercase snake_case tokens — `company_admin`, `employee_direct`, `sent`. Every
 * table that showed one of them printed it raw, so a Spanish administrator read
 * `company_admin` in a column headed *Rol*. They are closed sets, not free text
 * (a company name is free text and stays raw), so each has exactly one
 * translation and belongs in the catalogue.
 *
 * ## Why a key rather than a string
 *
 * These functions have no translation context — they are plain modules, called
 * from components that do. Returning the key keeps the mapping testable without a
 * provider, and keeps `t()` in the component where
 * `i18n/noHardcodedStrings.test.ts` can see it.
 *
 * ## Why `null` rather than a fallback string
 *
 * An unrecognised value means the API grew a case this build has never heard of.
 * Inventing English prose for it would print a lie in a Spanish page; returning
 * `null` lets the caller show the raw token, which is at least honestly the
 * server's own word for it, and is what every caller here does.
 */

/**
 * The five roles, in ascending order of reach.
 *
 * Must match `Roles.All` in `src/ClimateProject.Application/Auth/Roles.cs`
 * exactly — that backend list has 5 values, NOT the 6-value legacy `UserRole`
 * enum (there is no `department_admin`). Verified against that file.
 */
export const ROLES = ['employee', 'supervisor', 'leader', 'company_admin', 'super_admin']

/**
 * A `Map`, not an object literal, and that is not stylistic. `{}['toString']`
 * resolves up the prototype chain to `Function`, so an object-literal lookup
 * typed `Record<string, string>` hands back a function for a handful of ordinary
 * strings while TypeScript insists it is a `string`. A `Map` has no such
 * inheritance, so an unknown token is unknown.
 */
const ROLE_KEYS = new Map<string, string>([
  ['employee', 'users.employee'],
  ['supervisor', 'users.supervisor'],
  ['leader', 'users.leader'],
  ['company_admin', 'users.companyAdmin'],
  ['super_admin', 'users.superAdmin'],
])

/**
 * Invitation statuses, from `InvitationValidation.Status*` in
 * `src/ClimateProject.Application/OrgStructure/InvitationValidation.cs`: exactly
 * `pending`, `sent` and `accepted`.
 */
const INVITATION_STATUS_KEYS = new Map<string, string>([
  ['pending', 'users.invitationStatusPending'],
  ['sent', 'users.invitationStatusSent'],
  ['accepted', 'users.invitationStatusAccepted'],
])

/**
 * Invitation types, from `InvitationValidation.Type*` in the same file:
 * `company_admin_setup`, `employee_direct`, `employee_self_signup`.
 */
const INVITATION_TYPE_KEYS = new Map<string, string>([
  ['employee_direct', 'users.invitationTypeEmployeeDirect'],
  ['company_admin_setup', 'users.invitationTypeCompanyAdminSetup'],
  ['employee_self_signup', 'users.invitationTypeEmployeeSelfSignup'],
])

export function roleLabelKey(role: string): string | null {
  return ROLE_KEYS.get(role) ?? null
}

export function invitationStatusLabelKey(status: string): string | null {
  return INVITATION_STATUS_KEYS.get(status) ?? null
}

export function invitationTypeLabelKey(type: string): string | null {
  return INVITATION_TYPE_KEYS.get(type) ?? null
}

/**
 * A company's survey cadence.
 *
 * **This one is not a closed vocabulary, and that is the point.**
 * `CompanyEndpoints.cs:229` assigns `SurveyFrequency` straight from the request
 * after a bare `IsNullOrWhiteSpace` check — no allow-list, no enum — so the column
 * can hold any string a caller sends. `Company.cs:28` defaults it to `quarterly`,
 * and the values the product actually uses are the four below, matching
 * `ActionPlanValidation.ValidMeasurementFrequencies`.
 *
 * So unlike the three maps above, `null` here is the *ordinary* answer rather than
 * the "API grew a case this build never heard of" answer, and the caller's
 * raw-token fallback is load bearing rather than defensive. Translating the four
 * conventional values is still worth doing — a Spanish administrator was reading
 * `quarterly` under *Frecuencia de encuestas*, which is the same defect the role
 * and invitation maps above exist to fix — but nothing here may start treating this
 * as a validated set.
 */
const SURVEY_FREQUENCY_KEYS = new Map<string, string>([
  ['daily', 'companySettings.frequencyDaily'],
  ['weekly', 'companySettings.frequencyWeekly'],
  ['monthly', 'companySettings.frequencyMonthly'],
  ['quarterly', 'companySettings.frequencyQuarterly'],
])

/**
 * Case-insensitive, unlike the closed sets above: the values are unvalidated, so
 * `Quarterly` is as likely to arrive as `quarterly` and both name one cadence.
 */
export function surveyFrequencyLabelKey(frequency: string): string | null {
  return SURVEY_FREQUENCY_KEYS.get(frequency.trim().toLowerCase()) ?? null
}
