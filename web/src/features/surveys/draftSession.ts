/**
 * The wizard tab's draft session id (#266).
 *
 * `SurveyDraft` is keyed on `(user, sessionId)` and `POST /surveys/drafts` is idempotent
 * per session, so this id is what decides whether reopening the wizard continues a draft
 * or starts a second one.
 *
 * ## `sessionStorage`, unlike `respondSession.ts`'s `localStorage`
 *
 * The two look alike and want opposite things. A respondent's session id must outlive a
 * closed tab, because resuming a long survey is the whole point. This one must **not**:
 * `sessionStorage` is per-tab, so two wizards open at once get two drafts and cannot
 * overwrite each other's work. Sharing one id between them would make every keystroke in
 * either tab a write to the same row.
 *
 * The case `sessionStorage` cannot serve — the tab was closed, and with it the id — is
 * covered by the other half of recovery: `GET /surveys/drafts/latest` ignores session
 * entirely and finds the abandoned draft. The two mechanisms are complementary, and
 * choosing `localStorage` here would break the first without improving the second.
 *
 * The residual wrinkle is stated rather than hidden: Chrome copies `sessionStorage` into
 * a duplicated tab, so a duplicate does share the draft. That is the case the
 * `expectedVersion` conflict handling exists for, and it surfaces rather than clobbers.
 */

const STORAGE_KEY = 'surveyDraftSession'

function mint(): string {
  // Same fallback as respondSession.ts: `crypto` is undefined over plain HTTP on some
  // older engines, and a weaker id is better than a wizard that cannot autosave. This is
  // a scratchpad key, not a credential -- the server scopes every draft to the
  // authenticated user regardless of what session id is claimed.
  const source = globalThis.crypto
  if (source && typeof source.randomUUID === 'function') return source.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/**
 * This tab's id, minting and persisting one on first use.
 *
 * Never throws: storage is blocked outright in some privacy modes, and the caller gets a
 * usable per-call id there. Autosave still works in that session; only continuing the
 * same draft across a reload does not, which is the correct thing to degrade to.
 */
export function surveyDraftSessionId(): string {
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY)
    if (stored && stored.length > 0) return stored
    const minted = mint()
    window.sessionStorage.setItem(STORAGE_KEY, minted)
    return minted
  } catch {
    return mint()
  }
}

/**
 * Adopt an existing draft's session id, so a reload of this tab continues the draft that
 * was just recovered rather than opening a second one beside it.
 */
export function adoptSurveyDraftSessionId(sessionId: string): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, sessionId)
  } catch {
    // Storage is blocked; this tab keeps the draft in memory for its lifetime.
  }
}

/**
 * Forget this tab's id, so the next call starts a fresh draft.
 *
 * Called after the survey is created and after the draft is discarded — in both cases
 * the row this id points at is gone, and reusing the id would have the next wizard open
 * try to continue a draft that no longer exists.
 */
export function clearSurveyDraftSessionId(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to clear if storage was never writable.
  }
}
