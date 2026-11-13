import type { SurveyCredentialMode, SurveyRosterRow } from '../../api/surveys'

/**
 * What to do about ONE person who has not finished.
 *
 * `SurveyRosterRow.status` already says the roster carries three states and not two, because
 * *"'Pendiente' used to mean both 'never opened it' and 'answered half and was interrupted',
 * and those call for opposite actions -- the first person needs their sign-in details again,
 * the second already has them."* That sentence has been in the DTO since the three states
 * shipped; until now only ONE of the two actions existed, so the screen offered `reissue` to
 * everybody and the API refused half of them.
 */
export type ChaseAction =
  /** Signed in already: send a reminder, which mints nothing. A new key would lock them out. */
  | 'remind'
  /** Holds a key and has never used it: send a new one. Nothing is lost, and it may be the first that arrives. */
  | 'reissue'
  /** Holds no key at all: there is nothing to resend. They need an invitation. */
  | 'invite'
  /** Finished, or this survey does not hand out per-survey keys. Nothing to do from here. */
  | 'none'

/**
 * The rule, in one place.
 *
 * <p>This SUGGESTS; the API ENFORCES. `reissue` refuses `already_signed_in` and `remind`
 * refuses `already_completed` on their own, so a stale screen cannot do the wrong thing -- it
 * can only offer the wrong button and be told no. That matters because a roster read minutes
 * ago goes stale fast: two of the seven people ESPH asked us to chase on 2026-10-30 had
 * finished between the report being taken and the request arriving.</p>
 */
export function chaseActionFor(
  row: Pick<SurveyRosterRow, 'status' | 'credentialIssuedOn' | 'lastSignInOn' | 'surveyUsername'>,
  credentialMode: SurveyCredentialMode | undefined,
): ChaseAction {
  // A shared survey's people sign in with their own account; neither route applies, and the
  // per-survey fields are null for all of them anyway.
  if (credentialMode !== 'per_survey') return 'none'

  // `completed` is the only status that means finished. `not_completed` is the honest state an
  // ANONYMOUS survey reports -- "has not finished, and whether they started is not known" --
  // so it is chased like any other unfinished person.
  if (row.status === 'completed') return 'none'

  const holdsKey = Boolean(row.surveyUsername ?? row.credentialIssuedOn)
  if (!holdsKey) return 'invite'

  // The whole of the distinction: having signed in is what makes a new password harmful rather
  // than helpful, and it is recorded on the credential itself.
  return row.lastSignInOn ? 'remind' : 'reissue'
}
