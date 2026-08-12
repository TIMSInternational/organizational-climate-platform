import type { Microclimate } from './api/microclimates'

/**
 * What the Microclimates listing reads off the sessions it already fetched: the
 * KPI strip's four numbers, and which sessions are open right now.
 *
 * ## Why `responses` is summed and never suppressed
 *
 * The strip's fourth reading is the company's total response count across every
 * session. That is deliberately not put behind the anonymity floor, for the reason
 * `microclimatePrivacy.ts` states at length: a participation count identifies
 * nobody, and it is the number that tells an admin whether to keep chasing. The
 * floor applies to *what people said* — the wording, and any per-session reading
 * derived from it — which is why `MicroclimateList` gates the results link on
 * `isSuppressed` and leaves the counts alone.
 *
 * ## Why the live sessions are sorted again here
 *
 * `MicroclimateEndpoints.ListAsync` already returns `.OrderByDescending(m =>
 * m.CreatedAt)`, so today this sort is a no-op on a straight fetch. It is here
 * anyway because the panel's order is part of what the panel *means* — the room
 * you are standing in goes first — and that must not silently become "whatever
 * order the last caller happened to hand us" if this list is ever paged, merged,
 * or filled from a cache. Stating it costs one comparison per open session, of
 * which there is normally one.
 */

/** The one status that means responses can still arrive. `MicroclimateValidation.ValidStatuses`. */
const LIVE_STATUS = 'active'

export interface MicroclimateRollup {
  /** Sessions open for responses. */
  live: number
  /** Sessions set up but not yet opened. */
  draft: number
  /** Sessions that will take no more responses. */
  closed: number
  /** Every response collected, across every session. */
  responses: number
}

export function rollUpMicroclimates(sessions: readonly Microclimate[]): MicroclimateRollup {
  const rollup: MicroclimateRollup = { live: 0, draft: 0, closed: 0, responses: 0 }

  for (const session of sessions) {
    if (session.status === LIVE_STATUS) rollup.live += 1
    else if (session.status === 'draft') rollup.draft += 1
    else if (session.status === 'closed') rollup.closed += 1
    rollup.responses += session.responseCount
  }

  return rollup
}

/**
 * The sessions currently taking responses, newest first.
 *
 * A copy: `Array.prototype.sort` mutates, and the argument is the state array the
 * page renders its table from — sorting it in place would silently reorder the
 * table as a side effect of drawing the panel above it.
 */
export function liveSessions(sessions: readonly Microclimate[]): Microclimate[] {
  return sessions
    .filter((session) => session.status === LIVE_STATUS)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}
