/**
 * One open assessment at a time: the browser-local lock that stops a second tab
 * answering a survey the respondent already has open somewhere else.
 *
 * ## The problem this exists for
 *
 * `respondSession.ts` keys the resume credential per survey in `localStorage`, which
 * every tab in the browser shares. Two tabs on the same survey therefore hold the
 * *same* session id, and the consequence is not cosmetic: both hydrate from the same
 * in-progress response, both autosave into it, and the last writer wins. A respondent
 * who opens the emailed link again in a second tab — the ordinary way somebody
 * re-finds a survey — can silently overwrite the answers they gave in the first, and
 * neither screen says anything is wrong.
 *
 * So the lock is not about counting responses. It is about a single response being
 * edited from two places at once.
 *
 * ## Client-side only, and it is not a guarantee
 *
 * Nothing here reaches the server — no row, no column, no request — exactly as
 * `respondReceipt.ts` records for the answered flag, and for the same reason: the one
 * surface this product must not grow is a per-person log of when somebody was
 * answering. A second browser, a private window or a second device all defeat this,
 * and nothing server-side is watching. It stops the *accident*, which is the whole of
 * its job, and it must never be described as one-response-per-person. That guarantee
 * exists, server-side and completely, but only on an identified survey — see
 * `SurveyResponseEndpoints.FindExistingResponseAsync`.
 *
 * ## Why a heartbeat, and why it is 75 seconds
 *
 * A lock that is only released on close locks the survey out for ever the first time a
 * tab is killed, a phone runs out of battery, or a browser is force-quit — and the
 * respondent's way back in would be clearing site data, which also drops the resume
 * credential and the answered flag. So the holder rewrites `at` every
 * `HEARTBEAT_MS`, and a lock nobody has written to for `STALE_MS` is free for the
 * taking.
 *
 * `STALE_MS` is deliberately long. Browsers throttle timers in a backgrounded tab to
 * roughly one per minute, so a respondent who switches to their mail app to re-read
 * the invitation is a *live* holder whose heartbeat has gone quiet; a ten-second
 * staleness window would hand their half-finished response to the next tab that asked.
 * Five missed beats is long enough to survive that throttling and short enough that a
 * genuine crash costs a minute, not a survey. The ordinary case — a closed tab — does
 * not wait at all, because the holder releases on `pagehide` and announces it.
 *
 * ## The race, stated rather than hidden
 *
 * `localStorage` has no compare-and-swap, so two tabs mounting in the same instant can
 * both read "free" before either writes. `claimLock` writes and then reads back, which
 * closes the window to the few microseconds between those two calls and makes the
 * common case correct; it does not make it atomic. That is the right amount of rigour
 * for a defence against a mistake rather than against an adversary — and the cost of
 * losing the race is that two tabs are open, which is where we already are today.
 */

const KEY_PREFIX = 'surveyOpen:'

/** How often the holder rewrites its heartbeat. */
export const HEARTBEAT_MS = 15_000

/** How quiet a lock has to go before another tab may take it. Five missed beats. */
export const STALE_MS = 75_000

function keyFor(surveyId: string): string {
  return `${KEY_PREFIX}${surveyId}`
}

function mint(): string {
  // The same fallback `respondSession.ts` documents: `crypto` is absent over plain
  // HTTP on some older engines, and a respondent facing a blank page is a worse
  // outcome than a weaker id. Nothing here is a secret — holding another tab's id
  // buys you the right to answer a survey you could already answer.
  const source = globalThis.crypto
  if (source && typeof source.randomUUID === 'function') return source.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/**
 * This tab's identity.
 *
 * One per JavaScript context, which is one per tab — a duplicated tab gets a fresh
 * module instance and therefore a fresh id, which is correct: it is a second tab and
 * must be treated as one.
 */
export const TAB_ID = mint()

type Lock = { tab: string; at: number }

/** The stored lock, or null when there is none, storage is blocked, or it is unreadable. */
function read(surveyId: string): Lock | null {
  try {
    const raw = window.localStorage.getItem(keyFor(surveyId))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { tab, at } = parsed as Partial<Lock>
    if (typeof tab !== 'string' || tab.length === 0) return null
    if (typeof at !== 'number' || !Number.isFinite(at)) return null
    return { tab, at }
  } catch {
    // Blocked storage, or a value somebody else wrote into our key. Either way there
    // is no lock we can honour, and treating it as absent lets the respondent answer.
    return null
  }
}

/**
 * Whether a lock has gone quiet long enough to be taken.
 *
 * The future-dated arm is not hypothetical: a lock written before the system clock was
 * moved backwards would otherwise read as fresh for as long as the offset, which on a
 * machine that just synchronised its time could be hours. A timestamp that is ahead of
 * now by more than the window cannot have come from a tab beating in real time.
 */
function isStale(lock: Lock, now: number): boolean {
  return now - lock.at > STALE_MS || lock.at - now > STALE_MS
}

/**
 * Whether another tab holds this survey open right now.
 *
 * False when storage is unavailable — a reader who cannot be told about other tabs is
 * simply allowed to answer, which is the correct thing to degrade to for the same
 * reason `hasAnswered` degrades to "not answered": withholding a survey somebody owes
 * an answer to is the worse failure.
 */
export function heldElsewhere(surveyId: string, tab: string = TAB_ID, now: number = Date.now()): boolean {
  const lock = read(surveyId)
  return lock !== null && lock.tab !== tab && !isStale(lock, now)
}

/**
 * Take the lock if it is free, stale, or already ours.
 *
 * Returns whether this tab may open the survey. True when storage is blocked: see
 * `heldElsewhere` for why that degradation is the right one.
 */
export function claimLock(surveyId: string, tab: string = TAB_ID, now: number = Date.now()): boolean {
  const lock = read(surveyId)
  if (lock !== null && lock.tab !== tab && !isStale(lock, now)) return false

  try {
    window.localStorage.setItem(keyFor(surveyId), JSON.stringify({ tab, at: now }))
  } catch {
    // Nothing can be written, so nothing can be coordinated. Let them answer.
    return true
  }
  // Read back rather than trust the write: another tab may have claimed between our
  // read and our write, and whichever write landed second is the one both tabs can
  // see. Losing here is how the racing tab finds out it lost.
  const stored = read(surveyId)
  return stored === null || stored.tab === tab
}

/**
 * Rewrite the heartbeat, and report whether this tab still holds the lock.
 *
 * A false return means another tab took it — which can only happen after this one went
 * quiet for `STALE_MS` — and the caller's job is then to stop answering, not to take
 * it back. Taking it back is how both tabs end up writing to one response, which is
 * the whole thing this module exists to prevent.
 */
export function refreshLock(surveyId: string, tab: string = TAB_ID, now: number = Date.now()): boolean {
  const lock = read(surveyId)
  if (lock === null) {
    // Ours expired and nobody took it, or storage was cleared under us. Re-take it:
    // there is no other holder to displace, and the alternative is a tab that is
    // plainly in use quietly giving up its claim.
    return claimLock(surveyId, tab, now)
  }
  if (lock.tab !== tab) return false

  try {
    window.localStorage.setItem(keyFor(surveyId), JSON.stringify({ tab, at: now }))
  } catch {
    // The lock stands until it goes stale; one unwritten beat is not worth acting on.
  }
  return true
}

/**
 * Give up the lock, if it is ours.
 *
 * Guarded on ownership so that a tab which already lost the lock cannot delete the
 * holder's — the losing tab's unmount must not free a survey somebody else is in the
 * middle of.
 */
export function releaseLock(surveyId: string, tab: string = TAB_ID): void {
  const lock = read(surveyId)
  if (lock === null || lock.tab !== tab) return
  try {
    window.localStorage.removeItem(keyFor(surveyId))
  } catch {
    // Already unreachable if storage is. It will go stale on its own.
  }
}
