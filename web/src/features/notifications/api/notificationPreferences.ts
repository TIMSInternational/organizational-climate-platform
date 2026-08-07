import { authFetch } from '../../../api/authFetch'

/**
 * The digest vocabulary, mirroring
 * `Application/OrgStructure/NotificationPreferenceValidation.ValidDigestFrequencies`.
 *
 * A validated string on both sides rather than an enum, because these are the legacy
 * Mongo literals the ETL (#154) imports verbatim.
 */
export const DIGEST_FREQUENCIES = ['daily', 'weekly', 'monthly', 'never'] as const

export type DigestFrequency = (typeof DIGEST_FREQUENCIES)[number]

/**
 * The caller's own preferences: **five fields, not six.**
 *
 * `pushNotifications` is stored on the user and deliberately absent from this API and
 * from the page. There is no push infrastructure and no device-token storage in this
 * repo, so a toggle here would advertise a channel that cannot deliver — and a
 * preference the product silently ignores is worse than an absent one. It stays stored
 * so the legacy value survives import; it gets exposed in the same change that ships
 * push delivery, once #82 settles the PWA question.
 */
export interface NotificationPreferences {
  emailSurveys: boolean
  emailMicroclimates: boolean
  emailActionPlans: boolean
  emailReminders: boolean
  digestFrequency: DigestFrequency
}

/**
 * The route carries no user id on purpose — a user cannot read or write another user's
 * preferences because there is nothing to address but their own. Company scoping is
 * irrelevant here: this is a per-person rule, so even a CompanyAdmin has no path to a
 * colleague's opt-outs.
 *
 * This is #97's endpoint, not a second one. #97 and #103 were built in parallel and both
 * shipped a self-service preferences API — #97 at this path with partial-update semantics,
 * #103 at `/me/notification-preferences` with full-replacement semantics. Two live routes
 * for one resource, disagreeing about what an omitted field means, is worse than either
 * alone, so #97's kept the surface (it owns dispatch, which consults the same preferences
 * at delivery time) and this page points at it. A full payload is a valid partial one, so
 * the page's behaviour is unchanged.
 */
const PATH = '/notifications/preferences'

export async function getNotificationPreferences(baseUrl: string): Promise<NotificationPreferences> {
  const response = await authFetch(`${baseUrl}${PATH}`)
  return response.json() as Promise<NotificationPreferences>
}

/**
 * Sends all five values, always.
 *
 * The endpoint's own semantics are *partial*: every field on
 * `UpdateNotificationPreferencesRequest` is nullable and null means "not mentioned, leave
 * exactly as stored" — the only reading that cannot change a choice the user did not make
 * in this request. (An earlier version of this comment said the API rejects a partial
 * payload; it does not, and never did.)
 *
 * This signature still takes the whole object rather than a `Partial`, because the form
 * above it edits all five at once and a full payload is a valid partial one. What it must
 * never do is compute the payload from a subset of the form's state: an opt-out inferred
 * from a field the client happened not to send is the failure the nullable request DTO
 * exists to prevent.
 */
export async function updateNotificationPreferences(
  baseUrl: string,
  input: NotificationPreferences,
): Promise<NotificationPreferences> {
  const response = await authFetch(`${baseUrl}${PATH}`, {
    method: 'PUT',
    body: JSON.stringify({
      emailSurveys: input.emailSurveys,
      emailMicroclimates: input.emailMicroclimates,
      emailActionPlans: input.emailActionPlans,
      emailReminders: input.emailReminders,
      digestFrequency: input.digestFrequency,
    }),
  })
  return response.json() as Promise<NotificationPreferences>
}
