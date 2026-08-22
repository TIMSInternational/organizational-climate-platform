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
 * Tables where `SubjectDataMap` and `SubjectErasure` **disagree**, and the treatment this
 * page states instead.
 *
 * ## Why this exists, and why it is not a workaround
 *
 * The rule everywhere else on this page is "the map is the truth". For one table it cannot
 * be, because the map and the code that does the erasing say different things:
 *
 * - `SubjectDataMap` declares `survey_audit_logs` as `ErasureTreatment.Redacted`, with a
 *   rationale describing the actor's name, email and role being overwritten while
 *   "everything else — user_id, action, entity, changes, timestamp, IP, user agent — is
 *   kept".
 * - `SubjectErasure` **deletes the rows**: `db.SurveyAuditLogs.RemoveRange(surveyAuditLogs)`,
 *   under a comment that opens "DELETED, not redacted -- the decided treatment".
 * - `GdprEndpointsTests.Erasure_deletes_redacts_anonymises_and_retains_exactly_what_the_map_declares`
 *   asserts the deletion — `Assert.False(await db.SurveyAuditLogs.AnyAsync(...))` — so the
 *   behaviour is not an accident, and despite its name that test does not derive this one
 *   table from the map.
 * - `SubjectErasure.KnownLimitations` sides with the map ("survey_audit_logs keeps
 *   everything except the denormalised copy of the actor's name and email"), which is how
 *   the disagreement stayed invisible: an erasure response says one thing and does another.
 *
 * Three sources, two stories. Resolving it is a compliance decision that belongs to whoever
 * owns the erasure semantics (#144) — the map's prose, the limitation sentence and the
 * decision record all have to move together, and this page is not the place to make that
 * call.
 *
 * What this page **must not** do is repeat the map's version, because the map's version is
 * the one that is false, and it is false in the worst direction: it tells a data subject
 * that a record about them is kept when it is destroyed. So the page states what the code
 * does, and `erasureScope.test.ts` pins the divergence from both ends — it re-reads the map
 * to confirm the map still says `Redacted`, and re-reads `SubjectErasure` to confirm it
 * still calls `RemoveRange`. Fix either side and this file goes red rather than silently
 * drifting back into a false claim.
 */
export const ERASURE_MAP_DIVERGENCES = [
  {
    table: 'survey_audit_logs',
    /** What `SubjectDataMap` declares. */
    mapSays: 'Redacted',
    /** What `SubjectErasure` actually does, and what this page therefore says. */
    codeDoes: 'Deleted',
    /** The call in `SubjectErasure.cs` that makes `codeDoes` true. */
    anchor: 'db.SurveyAuditLogs.RemoveRange(surveyAuditLogs)',
  },
] as const

/**
 * The tables an erasure **deletes outright**.
 *
 * `ErasureTreatment.Deleted` in `src/ClimateProject.Application/Gdpr/SubjectDataMap.cs`,
 * plus `survey_audit_logs` — see `ERASURE_MAP_DIVERGENCES`.
 */
export const ERASURE_DELETED_TABLES = [
  'notifications',
  'survey_audit_logs',
  'survey_drafts',
  'user_demographics',
  'user_invitation_demographics',
] as const

/** Tables whose link to the person is severed, the rows surviving. `ErasureTreatment.Anonymised`. */
export const ERASURE_ANONYMISED_TABLES = ['responses', 'users'] as const

/**
 * Tables where named columns are overwritten and the rest is left intact.
 * `ErasureTreatment.Redacted`, minus `survey_audit_logs` — see `ERASURE_MAP_DIVERGENCES`.
 */
export const ERASURE_REDACTED_TABLES = [
  'microclimate_invitations',
  'survey_invitations',
  'user_invitations',
] as const

/** Catalogue paths for the deleted tables, keyed by the table's own name. */
export const DELETED_LABEL_PATH: Record<string, string> = {
  notifications: 'privacy.erasureDeletedNotifications',
  survey_audit_logs: 'privacy.erasureDeletedSurveyAuditLogs',
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
