/**
 * What the privacy page claims about the data model, as data rather than as prose.
 *
 * ## Why these are constants and not four sentences in the catalogue
 *
 * #137's third acceptance criterion is "erasure scope stated accurately, no overclaiming",
 * and the issue says why it is worded that way: telling a data subject their survey answers
 * will be deleted, when the implementation anonymises them, is a false claim on the one page
 * whose entire value is that it can be believed. A promise written as prose cannot be
 * compared to the code that keeps it — the promise lives in a React component and the
 * behaviour lives in `ClimateProject.Infrastructure.Gdpr`, in another language, in another
 * build, behind another test suite.
 *
 * So the *lists* are data and `erasureScope.test.ts` compares them against
 * `SubjectDataMap.cs`, while the *reasons* stay in the catalogue where copy belongs. Move a
 * table from `Redacted` to `Deleted` in the map and that test goes red until this page has
 * been updated to say so.
 *
 * ## Why a plain module rather than exports on the components
 *
 * These started life beside the components that render them, and `oxlint`'s
 * `react/only-export-components` rightly objected: a file that exports both a component and
 * five constants breaks fast refresh for everything that imports it. Five warnings put the
 * repo over its `--max-warnings 10` budget, which is exactly the budget saying "do not let
 * these accumulate".
 */

/**
 * The tables an erasure **deletes outright**.
 *
 * Mirrors `ErasureTreatment.Deleted` in
 * `src/ClimateProject.Application/Gdpr/SubjectDataMap.cs`.
 */
export const ERASURE_DELETED_TABLES = [
  'notifications',
  'survey_drafts',
  'user_demographics',
  'user_invitation_demographics',
] as const

/** Tables whose link to the person is severed, the rows surviving. `ErasureTreatment.Anonymised`. */
export const ERASURE_ANONYMISED_TABLES = ['responses', 'users'] as const

/** Tables where named columns are overwritten and the rest is left intact. `ErasureTreatment.Redacted`. */
export const ERASURE_REDACTED_TABLES = [
  'microclimate_invitations',
  'survey_audit_logs',
  'survey_invitations',
  'user_invitations',
] as const

/** Catalogue paths for the deleted tables, keyed by the table's own name. */
export const DELETED_LABEL_PATH: Record<string, string> = {
  notifications: 'privacy.erasureDeletedNotifications',
  survey_drafts: 'privacy.erasureDeletedSurveyDrafts',
  user_demographics: 'privacy.erasureDeletedUserDemographics',
  user_invitation_demographics: 'privacy.erasureDeletedInvitationDemographics',
}

export const ANONYMISED_LABEL_PATH: Record<string, string> = {
  responses: 'privacy.erasureAnonymisedResponses',
  users: 'privacy.erasureAnonymisedUsers',
}

export const REDACTED_LABEL_PATH: Record<string, string> = {
  microclimate_invitations: 'privacy.erasureRedactedMicroclimateInvitations',
  survey_audit_logs: 'privacy.erasureRedactedSurveyAuditLogs',
  survey_invitations: 'privacy.erasureRedactedSurveyInvitations',
  user_invitations: 'privacy.erasureRedactedUserInvitations',
}

/** Every path the three lookups above can produce, for the catalogue guard test. */
export const ERASURE_LABEL_PATHS: Record<string, string> = {
  ...DELETED_LABEL_PATH,
  ...ANONYMISED_LABEL_PATH,
  ...REDACTED_LABEL_PATH,
}

/**
 * Catalogue paths for the six columns of `UserConsent`.
 *
 * Keyed by the column name as the exporter flattens it (`Consent.Analytics` minus its
 * prefix), so a column with no copy renders as the raw name rather than as a blank row —
 * the same fallback `ProfileActivityList` gives an unrecognised audit action. A consent
 * surface that hides a flag it has never heard of is exactly the wrong failure mode.
 *
 * `privacyCopy.test.ts` asserts every path here resolves in both catalogues, which is the
 * check `keysExist.test.ts` cannot do: the lookup is dynamic at the call site.
 */
export const CONSENT_LABEL_PATH: Record<string, string> = {
  Essential: 'privacy.consentEssential',
  Analytics: 'privacy.consentAnalytics',
  Marketing: 'privacy.consentMarketing',
  Personalization: 'privacy.consentPersonalization',
  ThirdParty: 'privacy.consentThirdParty',
  Demographics: 'privacy.consentDemographics',
}
