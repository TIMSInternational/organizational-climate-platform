/**
 * The respondent's session id: the key that makes a retried submit idempotent and an
 * interrupted survey resumable.
 *
 * The server generates nothing here — on an anonymous survey the session id is the
 * *only* thing that can tell a retried request from a second respondent, so it has to
 * be minted by the client and kept stable across a reload, a closed tab and a
 * network retry.
 *
 * ## Why `localStorage` and not `sessionStorage`
 *
 * `sessionStorage` dies with the tab, and "a long survey lost to a closed tab" is the
 * abandonment cause this exists to fix. The cost is stated rather than hidden: on a
 * **shared** browser the id outlives the person, so whoever opens the same anonymous
 * survey next on that machine would resume the previous respondent's answers. Two
 * things bound it — the id is cleared the moment the response is completed, and it is
 * scoped per survey rather than global — but a genuinely shared kiosk would want it
 * gone at sign-out, and there is no sign-out on the public route to hang that on.
 * Recorded as a known limit.
 *
 * ## Why it is not in the URL
 *
 * Nothing here ever puts the id in a link. It is a resume credential: anyone holding
 * it can read back and overwrite an in-progress anonymous response. It has to travel
 * as a query parameter on the respond GET because that is the shape the endpoint
 * takes, which already puts it in server access logs — see the note in the lane
 * report. Putting it anywhere shareable on top of that would be gratuitous.
 */

const KEY_PREFIX = 'surveyResponseSession:'

function keyFor(surveyId: string): string {
  return `${KEY_PREFIX}${surveyId}`
}

function mint(): string {
  // `crypto.randomUUID` is available in every browser this app supports and in
  // happy-dom, but it is absent over plain HTTP on some older engines, where
  // `crypto` itself is undefined. Falling back keeps a respondent answering rather
  // than facing a blank page, at the cost of a weaker id — which is acceptable
  // because the id is an idempotency key, not a secret that grants access to
  // anything the holder did not create.
  const source = globalThis.crypto
  if (source && typeof source.randomUUID === 'function') return source.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/** The stored id for this survey, or null. Never throws — storage is blocked outright in some privacy modes. */
export function readSessionId(surveyId: string): string | null {
  try {
    const stored = window.localStorage.getItem(keyFor(surveyId))
    return stored && stored.length > 0 ? stored : null
  } catch {
    return null
  }
}

/**
 * The id for this survey, minting and persisting one on first use.
 *
 * Returns a usable id even when storage is unavailable, so a respondent in private
 * browsing can still submit — they simply cannot resume, which is strictly better
 * than being unable to answer at all.
 */
export function ensureSessionId(surveyId: string): string {
  const existing = readSessionId(surveyId)
  if (existing) return existing

  const created = mint()
  try {
    window.localStorage.setItem(keyFor(surveyId), created)
  } catch {
    // Not being able to remember the id is no reason not to use it for this visit.
  }
  return created
}

/** Forgets the id, once its response is complete and there is nothing left to resume. */
export function clearSessionId(surveyId: string): void {
  try {
    window.localStorage.removeItem(keyFor(surveyId))
  } catch {
    // Nothing to do: the id is already unreachable if storage is.
  }
}
