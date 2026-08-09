import { useCallback, useEffect, useRef, useState } from 'react'
import {
  SurveyDraftConflictError,
  autosaveSurveyDraft,
  createSurveyDraft,
  deleteSurveyDraft,
  getLatestSurveyDraft,
  recoverSurveyDraft,
  type SaveSurveyDraftInput,
  type SurveyDraftDetail,
} from './api/surveyDrafts'
import {
  draftLocalized,
  draftValuesFrom,
  hasDraftableContent,
  toDraftContent,
} from './draftContent'
import {
  adoptSurveyDraftSessionId,
  clearSurveyDraftSessionId,
  surveyDraftSessionId,
} from './draftSession'
import type { SurveyWizardValues } from './wizardValues'

/**
 * Autosave and recovery for the survey creation wizard (#266).
 *
 * `SurveyDraftEndpoints` (#105) shipped a complete server surface — create, autosave,
 * `/latest`, optimistic concurrency, expiry — and nothing ever called it, so #265's
 * wizard lost everything on a refresh. This is the client half.
 *
 * ## Every status is visible, because a dead autosave is worse than none
 *
 * The failure this hook has to avoid is not "the save failed"; it is "the save has been
 * failing for ten minutes and the page still looks fine". Someone who believes their
 * work is being saved stops taking care not to lose it. So there is no silent catch
 * anywhere below: every outcome lands in {@link SurveyDraftState.status}, and the two
 * bad ones are sticky until something actually succeeds.
 *
 * ## A conflict stops autosaving; an error does not
 *
 * Saves send `expectedVersion`, so a second tab editing the same draft produces a 409
 * instead of a silent overwrite. The two failures then get opposite treatment, and the
 * asymmetry is the point:
 *
 * - **Error** (network, 500) — retried on the next edit. Nothing is at stake but this
 *   request, and a transient blip should heal itself.
 * - **Conflict** — autosave *stops*. Retrying would either keep failing or, if the
 *   version were quietly refreshed, overwrite whatever the other tab wrote. Neither is
 *   the caller's decision to make, so `saveAnyway` exists and nothing happens until it
 *   is pressed.
 *
 * ## Nothing is written until there is something to write
 *
 * The draft row is created lazily, on the first edit that {@link hasDraftableContent}
 * recognises. Creating it on mount would leave a row behind every time someone opened
 * the wizard and changed their mind, and `/latest` would then offer an empty form back.
 *
 * ## Recovery decides before autosave starts
 *
 * While the recovery offer is on screen, autosave is held. Otherwise typing would mint a
 * second draft beside the one being offered, and whichever the user then chose, the
 * other would be the more recent — so `/latest` would offer the wrong one next time.
 */

export type DraftSaveStatus =
  /** No company scope, so there is nothing to draft against. */
  | 'off'
  /** Nothing to save yet, or the recovery offer has not been answered. */
  | 'idle'
  /** Edited; a save is scheduled. */
  | 'pending'
  | 'saving'
  | 'saved'
  /** The last save failed. Sticky, and retried on the next edit. */
  | 'error'
  /** The draft changed elsewhere. Sticky, and autosave is stopped until `saveAnyway`. */
  | 'conflict'

export interface SurveyDraftState {
  status: DraftSaveStatus
  /** `updatedAt` of the last successful save, ISO. Survives a later failure on purpose. */
  savedAt: string | null
  /** The server's own message for an error or conflict. */
  message: string | null
}

export interface SurveyDraftRecovery {
  draft: SurveyDraftDetail
  values: SurveyWizardValues
}

export interface UseSurveyDraftOptions {
  baseUrl: string
  /** Display locale for server messages. Not the survey's content language. */
  locale: string
  /** False until the page has a company scope; the hook reports `off` and does nothing. */
  enabled: boolean
  /** Distinct from the page's own counter, so restored React keys cannot collide. */
  keyPrefix: string
  values: SurveyWizardValues
  currentStep: number
  /** Applied when the user accepts a recovery offer. */
  onRestore: (values: SurveyWizardValues, currentStep: number) => void
}

export interface UseSurveyDraftResult {
  state: SurveyDraftState
  /** The draft `/latest` found, or null once answered. */
  recovery: SurveyDraftRecovery | null
  restore: () => void
  discardRecovered: () => void
  dismissRecovery: () => void
  /** Re-run the blocked save, ignoring the version guard. Only meaningful on `conflict`. */
  saveAnyway: () => void
  /** Called once the survey exists: the draft has served its purpose. */
  discardAfterCreate: () => Promise<void>
}

/** Long enough not to save on every keystroke, short enough to beat an accidental close. */
const AUTOSAVE_DELAY_MS = 1500

export function useSurveyDraft(options: UseSurveyDraftOptions): UseSurveyDraftResult {
  const { baseUrl, locale, enabled, keyPrefix, values, currentStep, onRestore } = options

  const [state, setState] = useState<SurveyDraftState>({
    status: enabled ? 'idle' : 'off',
    savedAt: null,
    message: null,
  })
  const [recovery, setRecovery] = useState<SurveyDraftRecovery | null>(null)
  const [decided, setDecided] = useState(false)

  // Refs, not state: the save loop reads these and must never be the reason a render
  // happens, or every keystroke would reschedule itself.
  const draftIdRef = useRef<string | null>(null)
  const versionRef = useRef<number | null>(null)
  const inFlightRef = useRef(false)
  const blockedRef = useRef(false)
  const mountedRef = useRef(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestRef = useRef({ values, currentStep })
  const savedSignatureRef = useRef<string | null>(null)
  const onRestoreRef = useRef(onRestore)

  latestRef.current = { values, currentStep }
  onRestoreRef.current = onRestore

  const publish = useCallback((next: SurveyDraftState) => {
    if (mountedRef.current) setState(next)
  }, [])

  /**
   * One save. `force` drops the version guard, which is what `saveAnyway` needs and what
   * nothing else may do.
   */
  const save = useCallback(
    async (force: boolean): Promise<void> => {
      if (inFlightRef.current) return
      const { values: current, currentStep: step } = latestRef.current
      if (!hasDraftableContent(current)) return

      const content = toDraftContent(current)
      const signature = JSON.stringify({ content, step })
      if (!force && signature === savedSignatureRef.current) return

      inFlightRef.current = true
      setState((previous) => ({ ...previous, status: 'saving' }))

      const body: SaveSurveyDraftInput = {
        title: draftLocalized(current.language, current.titleEn, current.titleEs),
        description: draftLocalized(
          current.language,
          current.descriptionEn,
          current.descriptionEs,
        ),
        content,
        currentStep: step,
        language: current.language,
      }

      try {
        const id = draftIdRef.current
        const draft =
          id === null
            ? await createSurveyDraft(baseUrl, { sessionId: surveyDraftSessionId(), ...body }, locale)
            : await autosaveSurveyDraft(
                baseUrl,
                id,
                force ? body : { ...body, expectedVersion: versionRef.current ?? undefined },
                locale,
              )

        draftIdRef.current = draft.id
        versionRef.current = draft.version
        savedSignatureRef.current = signature
        blockedRef.current = false
        publish({ status: 'saved', savedAt: draft.updatedAt, message: null })
      } catch (error) {
        if (error instanceof SurveyDraftConflictError) {
          // versionRef is deliberately NOT advanced to the winner's. Doing so would make
          // the next autosave succeed and overwrite the other tab's work -- the exact
          // silent clobber expectedVersion was sent to prevent.
          blockedRef.current = true
          setState((previous) => ({
            status: 'conflict',
            savedAt: previous.savedAt,
            message: error.message,
          }))
        } else {
          setState((previous) => ({
            status: 'error',
            savedAt: previous.savedAt,
            message: error instanceof Error ? error.message : null,
          }))
        }
      } finally {
        inFlightRef.current = false
      }
    },
    [baseUrl, locale, publish],
  )

  // Recovery: ask once, before anything is written.
  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    getLatestSurveyDraft(baseUrl, locale)
      .then((draft) => {
        if (cancelled) return
        const restored =
          draft === null ? null : draftValuesFrom(draft.content, `${keyPrefix}-r`, 'en')
        if (draft !== null && restored !== null && hasDraftableContent(restored)) {
          setRecovery({ draft, values: restored })
          return
        }
        setDecided(true)
      })
      .catch(() => {
        // Recovery is the one place a failure is not surfaced: the wizard works without
        // it, and an alarming banner about a draft the user may not even have would be
        // noise. Autosave is unaffected, and its own failures are never silent.
        if (!cancelled) setDecided(true)
      })

    return () => {
      cancelled = true
    }
  }, [baseUrl, enabled, keyPrefix, locale])

  // The debounce. Re-armed by any change to the values or the step.
  useEffect(() => {
    if (!enabled || !decided || blockedRef.current) return
    if (!hasDraftableContent(values)) return

    const signature = JSON.stringify({ content: toDraftContent(values), step: currentStep })
    if (signature === savedSignatureRef.current) return

    setState((previous) =>
      previous.status === 'saving' ? previous : { ...previous, status: 'pending' },
    )

    timerRef.current = setTimeout(() => {
      void save(false)
    }, AUTOSAVE_DELAY_MS)

    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    }
  }, [currentStep, decided, enabled, save, values])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      // A last attempt on the way out, so navigating away inside the debounce window does
      // not lose the edit. Fire and forget: there is no component left to tell, and
      // `publish` is already guarded by mountedRef.
      if (!blockedRef.current) void save(false)
    }
  }, [save])

  const restore = useCallback(() => {
    const offer = recovery
    if (offer === null) return

    setRecovery(null)
    setDecided(true)
    draftIdRef.current = offer.draft.id
    versionRef.current = offer.draft.version
    // Seeded so the restore itself is not immediately re-saved as a change.
    savedSignatureRef.current = JSON.stringify({
      content: toDraftContent(offer.values),
      step: offer.draft.currentStep,
    })
    // A reload of this tab should continue the recovered draft, not open a second one.
    adoptSurveyDraftSessionId(offer.draft.sessionId)
    onRestoreRef.current(offer.values, offer.draft.currentStep)
    publish({ status: 'saved', savedAt: offer.draft.updatedAt, message: null })

    // Records that it was recovered and pushes the expiry out. Its failure changes
    // nothing the user can see -- the values are already in the form -- so it does not
    // get to put the indicator into an error state.
    void recoverSurveyDraft(baseUrl, offer.draft.id, locale).catch(() => undefined)
  }, [baseUrl, locale, publish, recovery])

  const discardRecovered = useCallback(() => {
    const offer = recovery
    if (offer === null) return
    setRecovery(null)
    setDecided(true)
    void deleteSurveyDraft(baseUrl, offer.draft.id).catch(() => undefined)
  }, [baseUrl, recovery])

  const dismissRecovery = useCallback(() => {
    // Keeps the draft. "Not now" must not destroy work -- it expires on its own, and
    // `/latest` will offer it again next time.
    setRecovery(null)
    setDecided(true)
  }, [])

  const saveAnyway = useCallback(() => {
    blockedRef.current = false
    void save(true)
  }, [save])

  const discardAfterCreate = useCallback(async () => {
    const id = draftIdRef.current
    // Stop the unmount flush from recreating what is about to be deleted.
    blockedRef.current = true
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    draftIdRef.current = null
    clearSurveyDraftSessionId()
    if (id === null) return
    // The survey now exists; a leftover draft would be offered back as unfinished work.
    // Its deletion failing is not worth an error on a page that just succeeded -- the
    // retention sweep collects it either way.
    await deleteSurveyDraft(baseUrl, id).catch(() => undefined)
  }, [baseUrl])

  return {
    state,
    recovery,
    restore,
    discardRecovered,
    dismissRecovery,
    saveAnyway,
    discardAfterCreate,
  }
}
