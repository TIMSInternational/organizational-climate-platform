import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from '../../../../i18n'
import { getToken } from '../../../../auth/token'
import {
  MicroclimateLinkError,
  getMicroclimateInvitation,
  recordMicroclimateInvitationStep,
} from '../../api/microclimateLinks'
import { invitationView, type InvitationView, type ResolveState } from './derive'

export interface MicroclimateInvitationModel {
  /** The one view the screen draws; `answering` is tracked separately below. */
  view: InvitationView
  /** True once the respondent has pressed the button and the questions are mounted. */
  answering: boolean
  /** Moves from the landing card to the questions and records `started`. */
  begin: () => void
  /** Records `completed` once the server has accepted the answers. */
  reportCompleted: () => void
}

/**
 * The wiring seam of `/microclimate-invitations/:token`.
 *
 * Everything below is carried over verbatim in behaviour from `MicroclimateInvitationPage`
 * — the page this route rendered before the redesign, still in the tree as the wiring
 * reference — because every line of it was paid for by a defect. The remarks are kept with
 * the code rather than left behind in the old file.
 *
 * ## What the tracking is allowed to cost
 *
 * Nothing. All three writes are fired and their failures swallowed: they are telemetry
 * about an invitation, not a precondition for answering, and a respondent blocked from a
 * pulse because a counter would not increment is a product that has confused whose page
 * this is. The server is idempotent (`MicroclimateInvitationStatuses.Advances` is strictly
 * monotonic), so a lost ping costs one row's precision and a repeated one costs nothing.
 *
 * ## `opened` and `started` are two events, not one
 *
 * The ladder's whole value to an administrator is telling "they saw it" apart from "they
 * began". Recording both on page load would make the funnel a straight line by
 * construction. So `opened` is recorded when the invitation resolves and `started` when
 * the respondent presses the button.
 *
 * ## Anonymity is the server's to enforce
 *
 * `started` and `completed` are posted whether or not the session is anonymous — the
 * server's own instruction: the later states "are accepted by the API (the respondent's
 * client should not have to branch on anonymity) and deliberately not persisted". One
 * implementation of the ceiling, in the one place that owns the rows.
 *
 * ## The re-resolve guard
 *
 * `locale` is a dependency because the landing card renders the session's own title and
 * description and they have to come back in the language the reader switched to. But once
 * the questions are on screen this effect is the only thing that could take them away, and
 * on a language change that is exactly what it would do — a remounted form starts with an
 * empty answer map, i.e. a respondent with no account and no draft silently losing their
 * answers. So a token that has been begun under is never resolved again.
 *
 * A ref rather than state because the effect has to READ it without being re-run by it,
 * and it holds the TOKEN rather than a boolean so a genuinely different invitation still
 * resolves from scratch. The cleanup is keyed on `[token]` alone: a cleanup that also ran
 * on a language change would reopen the very teardown the guard exists to prevent.
 */
export function useMicroclimateInvitationModel(token: string | undefined): MicroclimateInvitationModel {
  const { locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  const [state, setState] = useState<ResolveState>({ status: 'loading' })
  const [answering, setAnswering] = useState(false)
  const begunToken = useRef<string | null>(null)

  useEffect(() => {
    return () => {
      begunToken.current = null
      setAnswering(false)
    }
  }, [token])

  useEffect(() => {
    if (!token) return
    if (begunToken.current === token) return

    let cancelled = false
    setState({ status: 'loading' })

    getMicroclimateInvitation(baseUrl, token, { lang: locale })
      .then((detail) => {
        if (cancelled) return
        setState({ status: 'resolved', detail })
        // Here rather than in an effect of its own, so it fires exactly once per
        // successful resolve and never for a dead token — an invitation the server has
        // just refused has not been "opened" by anybody.
        void recordMicroclimateInvitationStep(baseUrl, token, 'opened').catch(ignoreTrackingFailure)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setState({
          status: 'dead',
          error: error instanceof MicroclimateLinkError ? error : null,
        })
      })

    return () => {
      cancelled = true
    }
  }, [baseUrl, token, locale])

  const begin = useCallback(() => {
    if (!token) return
    // Set before the state change, not after: from here on a language switch must find
    // the guard already closed.
    begunToken.current = token
    void recordMicroclimateInvitationStep(baseUrl, token, 'started').catch(ignoreTrackingFailure)
    // Not awaited. The respondent pressed a button to answer a two-minute pulse; making
    // them wait on a round trip that only an administrator will ever read would be
    // charging them for somebody else's analytics.
    setAnswering(true)
  }, [baseUrl, token])

  const reportCompleted = useCallback(() => {
    if (!token) return
    void recordMicroclimateInvitationStep(baseUrl, token, 'completed').catch(ignoreTrackingFailure)
  }, [baseUrl, token])

  // `getToken()` is read on every render rather than captured once: the respondent may
  // have signed in in another tab, and `localStorage` is shared across them.
  return { view: invitationView(state, getToken() !== null), answering, begin, reportCompleted }
}

/**
 * The invitation ladder is an administrator's view of a link, and this page belongs to the
 * person answering. A failed ping is dropped rather than surfaced, retried or logged:
 * there is nothing the respondent could do about it, nothing they would want to do about
 * it, and a toast about a tracking call is a way of telling somebody their pulse went
 * wrong when it did not.
 */
function ignoreTrackingFailure(): void {
  // Intentionally empty; see above.
}
