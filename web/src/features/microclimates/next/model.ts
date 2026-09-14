import type { LiveResults, Microclimate, MicroclimateDetail } from '../api/microclimates'

/**
 * The typed models behind the two redesigned microclimate screens: `/microclimates`
 * (the MicroclimatesList artboard of 10 Sep) and `/microclimates/:id/live`
 * (MicroclimateLive).
 *
 * Every field either screen prints is on the wire today, read through the existing
 * client (`../api/microclimates.ts`):
 *
 * | Region                                         | Endpoint                                   |
 * |------------------------------------------------|--------------------------------------------|
 * | the sessions, their status and their counts    | `GET /microclimates?companyId=`            |
 * | a session's close date, questions, anonymity   | `GET /microclimates/{id}`                  |
 * | the moving count and the word frequencies      | `GET /microclimates/{id}/live-results`     |
 *
 * So neither screen carries an `isSample` flag or wears the sample chip — the same
 * call `surveys/next/list/model.ts` makes. What the design adds (the order of the
 * sessions, the flow step, the word bars) is derived in `derive.ts`, never typed.
 */

/** The flow card's four steps, numbered as the card numbers them. */
export type FlowStep = 1 | 2 | 3 | 4

/** A session still in progress: open, or drafted and not yet opened. */
export interface InProgressSession {
  /** The row as `GET /microclimates` returns it. */
  row: Microclimate
  /**
   * `GET /microclimates/{id}`, for the three facts the list payload does not carry —
   * when it closes, how many questions it asks, whether it is anonymous. `null` when
   * that read failed: the row then prints what the list knows and leaves the rest off,
   * never a guess.
   */
  detail: MicroclimateDetail | null
}

export interface MicroclimatesListNextModel {
  /** Open sessions newest first, then drafts newest first. */
  inProgress: readonly InProgressSession[]
  /** Closed sessions, newest first. */
  past: readonly Microclimate[]
  /** The session the flow card follows — the first of `inProgress` — or `null`. */
  current: InProgressSession | null
  /** Where `current` is in the flow; `null` when nothing is in progress. */
  step: FlowStep | null
}

export interface MicroclimateLiveNextModel {
  /** Fetched once: the title, the schedule and the questions do not move while it runs. */
  detail: MicroclimateDetail
  /** The latest successful `/live-results` read, or `null` before the first. */
  live: LiveResults | null
  /** When `live` was read. */
  lastUpdatedAt: Date | null
  /** A poll failed after one had succeeded: the figure on screen is the last good one. */
  isStale: boolean
}
