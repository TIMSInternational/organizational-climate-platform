/**
 * The in-app route a notification is *about*, or `null` when it is about nothing this
 * client can open.
 *
 * ## Why the inbox needed this
 *
 * A `survey_invitation` row reads "Q4 Climate Survey is open to you" and, until this
 * module existed, offered exactly one control: **Mark as Read**. For the employee — the
 * persona whose entire relationship with the product is *get invited, answer honestly* —
 * the one screen that announces the invitation was the one screen with no way to act on
 * it. The bell, the badge and the row all pointed at a dead end.
 *
 * ## The payload this reads is a contract the API already writes
 *
 * `ClimateProject.Application.Notifications.SurveyNotificationData` serialises
 * `{"surveyId": …, "surveyInvitationId": …}` into `notifications.data` when
 * `SurveyDistributionEndpoints` queues the row, and `EmailNotificationSender` reads it
 * back to compose the mail. The constants below are that class's, restated:
 *
 * - `SurveyIdKey` → {@link SURVEY_ID_KEY}
 * - `LinkCarryingTypes` → {@link LINK_CARRYING_TYPES}
 *
 * **The invitation token is deliberately not in the payload and is not wanted here.** The
 * C# remarks explain why — `GET /notifications?companyId=` returns `data` verbatim to any
 * company admin, so a persisted token would hand them a bearer credential for every
 * employee's invitation. This client does not need one: the reader already has a session,
 * and `GET /surveys/{id}/respond` authorizes them from their own user row and the survey's
 * own department targets, reading no role claim at all. `roleCapabilities.ts` files
 * `/surveys/:id/respond` under `SELF_SERVICE` for exactly that reason, and
 * `roleCapabilities.test.ts` asserts a non-admin can reach it.
 *
 * ## Every read failure is `null`, never a throw
 *
 * `data` is a `jsonb` column and `POST /notifications` lets a company admin write one
 * verbatim, so this has to survive nothing, a JSON array, a number, a truncated object,
 * and a `surveyId` whose value is an object. All of those mean "no survey named here",
 * which degrades to the row this page drew before — a notification with no action — rather
 * than to a crash inside a list render. This mirrors the same decision the C# side records.
 */

/** `SurveyNotificationData.SurveyIdKey`. */
const SURVEY_ID_KEY = 'surveyId'

/**
 * `SurveyNotificationData.LinkCarryingTypes`.
 *
 * Both are addressed to one invitee about one invitation. Nothing else in
 * `NOTIFICATION_TYPES` is, and a type absent from this list is never read for a link even
 * if some other producer happens to have put a `surveyId` in its payload — a
 * `survey_completion` notification announces published *results*, which a respondent has no
 * route to, and pointing it at the respond screen would offer to re-answer a closed survey.
 */
const LINK_CARRYING_TYPES: readonly string[] = ['survey_invitation', 'survey_reminder']

/**
 * `Guid.Empty`, rejected for the same reason the C# rejects it: it parses, so a payload
 * carrying it would otherwise produce a well-formed route to a survey that does not exist.
 */
const EMPTY_GUID = '00000000-0000-0000-0000-000000000000'

/** The 8-4-4-4-12 hex shape, case-insensitive. Anything else is not an id this app minted. */
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The two fields of a notification this reads. A structural type, so callers may pass more. */
export interface LinkableNotification {
  type: string
  data: string | null
}

/**
 * The respond route for a notification that names a survey, or `null`.
 *
 * Returns a path rather than a boolean plus an id so a caller cannot build the URL a
 * second, differently-shaped way — the `/surveys/:id/respond` literal is written here and
 * on `MySurveysPage`, and one of those is one too many already.
 */
export function surveyRespondPathFor(notification: LinkableNotification): string | null {
  if (!LINK_CARRYING_TYPES.includes(notification.type)) return null
  if (notification.data === null) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(notification.data)
  } catch {
    return null
  }

  // `typeof null === 'object'`, and an array is an object too. Both are payloads that
  // name no survey, and `(null)[SURVEY_ID_KEY]` throws rather than returning undefined.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null

  const surveyId = (parsed as Record<string, unknown>)[SURVEY_ID_KEY]
  if (typeof surveyId !== 'string') return null
  if (!GUID.test(surveyId)) return null
  if (surveyId.toLowerCase() === EMPTY_GUID) return null

  return `/surveys/${surveyId}/respond`
}
