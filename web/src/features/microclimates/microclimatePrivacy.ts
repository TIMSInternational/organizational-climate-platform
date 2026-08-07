import type { WordCloudEntry } from './api/microclimates'

/**
 * Small-group disclosure control for the microclimate word cloud, applied client
 * side because nothing applies it server side.
 *
 * ## Why this is here and not in the API
 *
 * `SurveyResultsPrivacy` (surveys) enforces three floors in C#. The microclimate
 * surface enforces **none**: `MicroclimateEndpoints.SubmitResponseAsync` merges every
 * respondent's words into `LiveResults.WordCloudData` and `GetLiveResultsAsync` hands
 * the raw map back. So a session with two responses returns whatever those two people
 * typed, and "my visa renewal" names its author to anyone who knows the team.
 *
 * This module is the mitigation that a frontend lane can actually ship. It is
 * deliberately not presented as equivalent to the server-side control, for one
 * concrete reason:
 *
 * > **The microclimate word counts are occurrences, not distinct respondents.**
 * > `CountWordFrequencies` increments per word per text, so one person writing
 * > "visa visa" produces `value: 2` and clears an occurrence floor of 2 on their own.
 * > `SurveyResultsPrivacy.MinimumWordRespondents` counts *responses containing the
 * > word*, which is the thing that actually bounds re-identification.
 *
 * The honest fix is a respondent-keyed floor inside `SubmitResponseAsync`. Until that
 * exists, the whole-session floor below is the load-bearing control and the
 * per-word one is a useful-but-partial second layer.
 *
 * ## The two floors, and why the counters stay visible below them
 *
 * - **The session as a whole** — below `MINIMUM_RESPONDENTS` the cloud is withheld
 *   entirely and the page says so. Not blanked: a reader has to be able to tell "no
 *   one wrote anything" from "this was withheld", or they go looking for the raw data.
 * - **A single word** — words below `MINIMUM_WORD_OCCURRENCES` are dropped and
 *   *counted*, so the total still reconciles.
 *
 * Participation counts are never suppressed, matching the argument
 * `SurveyResultsPrivacy` makes at length: "3 of 40 so far" identifies nobody, and it
 * is the number that tells an admin whether to keep chasing responses.
 */

/**
 * Responses a session needs before any wording is shown.
 *
 * The literal 5 mirrors `SurveyResultsPrivacy.MinimumRespondents`. There is no
 * build-time link between the two — this is a client-side control over a surface the
 * server does not gate at all — so it is a deliberate copy rather than an
 * accidental one, and it is stated here so a future backend floor can be reconciled
 * against it.
 */
export const MINIMUM_RESPONDENTS = 5

/** Occurrences a word needs before it is shown. See the caveat above. */
export const MINIMUM_WORD_OCCURRENCES = 2

export interface SuppressedWordCloud {
  /** The words that may be shown. Empty when `isSuppressed`. */
  words: WordCloudEntry[]
  /** Words dropped for being too rare. Reported, never silently discarded. */
  withheldCount: number
  /** True when the whole session is below `MINIMUM_RESPONDENTS`. */
  isSuppressed: boolean
}

/**
 * Applies both floors.
 *
 * `responseCount` is the session's own total rather than the word list's length: the
 * floor is about how many people could be re-identified, not about how much they
 * wrote.
 */
export function suppressWordCloud(
  words: readonly WordCloudEntry[],
  responseCount: number,
): SuppressedWordCloud {
  if (responseCount < MINIMUM_RESPONDENTS) {
    // Every word is withheld, and the count says how many — so a reader can see
    // that there was something here rather than assuming nobody typed anything.
    return { words: [], withheldCount: words.length, isSuppressed: true }
  }

  const kept = words.filter((word) => word.value >= MINIMUM_WORD_OCCURRENCES)
  return { words: kept, withheldCount: words.length - kept.length, isSuppressed: false }
}

/**
 * Participation as a percentage, or null when there is no denominator.
 *
 * Null rather than 0: a rate computed against a target of zero is an invented
 * denominator, and `charts/participation.ts` makes the same call for the same reason.
 * Kept here rather than imported so the microclimate pages agree on one definition
 * across the live view, the results page and the cross-session analytics.
 */
export function participationPercent(responseCount: number, targetParticipantCount: number): number | null {
  if (targetParticipantCount <= 0) return null
  return (responseCount / targetParticipantCount) * 100
}
