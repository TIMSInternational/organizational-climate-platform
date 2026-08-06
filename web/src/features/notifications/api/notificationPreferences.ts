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
 */
const PATH = '/me/notification-preferences'

export async function getNotificationPreferences(baseUrl: string): Promise<NotificationPreferences> {
  const response = await authFetch(`${baseUrl}${PATH}`)
  return response.json() as Promise<NotificationPreferences>
}

/**
 * Sends all five values, always.
 *
 * The API rejects a partial payload rather than defaulting the missing flags, so this
 * signature takes the whole object instead of a partial — an opt-out must never be
 * inferred from a field the client happened not to send.
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
