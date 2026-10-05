/**
 * "This device remembers you answered" — the only receipt an anonymous survey can have.
 *
 * ## The problem this exists for
 *
 * An anonymous survey can be answered repeatedly, and that is not an oversight. Three
 * places in the product choose it deliberately and each explains itself:
 *
 * - `SurveyInvitationStatuses.AnonymityCeiling` is `opened`. `started` and `completed` are
 *   accepted by the API and deliberately **not** persisted, because a per-person
 *   `completed_at` taken at almost the same instant as `responses.completion_time` is a
 *   join that re-identifies the respondent.
 * - `SurveyResponseEndpoints.FindExistingResponseAsync` keys idempotency on the acting user
 *   for an identified survey and on the **session** for an anonymous one — "on an anonymous
 *   survey it deliberately does not exist, which leaves the session as the only thing that
 *   can tell a retry from a second person".
 * - `SurveyQueries.AssignedTo` — "An anonymous survey stores no UserId, so it stays listed
 *   for its whole window".
 *
 * On top of that, `SurveyRespondForm` **deletes** the session id on completion, so that a
 * shared browser cannot read back the previous respondent's answers (the respond GET returns
 * them, free text included). That is the right call and it stays. Its consequence is that
 * the next visit mints a fresh session id, the server's idempotency key cannot match, and a
 * second response is written.
 *
 * ## Why a browser-local flag, and not the receipt `MySurveysNextPage` ruled out
 *
 * That page's doc comment rules out "inventing a survey-history read to fill the table …
 * it would put a per-person answer log on the one surface in the product that must not
 * accumulate one." That ruling stands, and this does not breach it: **nothing here reaches
 * the server.** No row, no timestamp, no column. The flag lives in one browser's
 * `localStorage`, is readable only by the person sitting at it, and is invisible to every
 * admin, every export and every report.
 *
 * So the honest claim, and the one the copy makes: *the platform* still does not know
 * whether you answered. This browser does.
 *
 * ## What is stored, and what is deliberately not
 *
 * One flag per survey, and nothing else. **No timestamp**: the product never shows what
 * anyone answered or when, and a local answer log with times is a thing a shared or
 * forensically-examined device would give up. **No answers**: those are what
 * `clearSessionId` exists to drop. The flag says only "answered", which is the single bit
 * the three surfaces need in order to stop offering the survey again.
 *
 * ## The limit, stated rather than implied
 *
 * This is **not** a guarantee of one response per person, and must never be described as
 * one. A new browser, a private window, a second device or cleared site data all defeat it,
 * and nothing server-side is watching. It stops the *accident* — the respondent who follows
 * the emailed link a second time, or finds the survey still sitting under "To answer" — and
 * that is the whole of its job. Enforcing one-per-person would mean a per-person completion
 * record, which is the privacy trade the three decisions above declined to make.
 *
 * Scoped per survey rather than global, so answering one survey never silences another.
 *
 * **There is deliberately no way to clear it.** An earlier version offered "that was not me,
 * answer again" everywhere the flag was read, reasoning that the flag belongs to a device and
 * not to a person. Ruled against: a visible control for answering twice is an invitation to,
 * and on a survey the point is that somebody who has answered is done. The cost is stated
 * rather than hidden — on a genuinely shared browser the next person is told they have already
 * answered, and their way through is a different browser or a private window.
 */

const KEY_PREFIX = 'surveyAnswered:'

function keyFor(surveyId: string): string {
  return `${KEY_PREFIX}${surveyId}`
}

/**
 * Whether this browser remembers answering this survey.
 *
 * Never throws: storage is blocked outright in some privacy modes, and a reader who cannot
 * be remembered is simply offered the survey — which is the correct thing to degrade to,
 * because the alternative is withholding a survey somebody may genuinely owe an answer to.
 */
export function hasAnswered(surveyId: string): boolean {
  try {
    return window.localStorage.getItem(keyFor(surveyId)) !== null
  } catch {
    return false
  }
}

/**
 * Record that this browser answered this survey.
 *
 * Called at the one moment it is true: the submission the server accepted as complete. The
 * stored value is a constant — it is the key's existence that carries the meaning, and a
 * value that looked like data would invite somebody to put data in it.
 */
export function markAnswered(surveyId: string): void {
  try {
    window.localStorage.setItem(keyFor(surveyId), '1')
  } catch {
    // Storage is blocked. The survey stays listed, which is the honest degradation.
  }
}
