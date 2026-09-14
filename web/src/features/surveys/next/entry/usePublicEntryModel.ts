import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from '../../../../i18n'
import { getToken } from '../../../../auth/token'
import { SurveyLinkError, resolveSurveyPublicLink } from '../../api/surveyLinks'
import { SurveyRespondError, getSurveyRespondView } from '../../api/surveyResponses'
import { ensureSessionId } from '../../respondSession'
import { entryState, type EntryState, type LinkLoad, type ViewLoad } from './derive'

/**
 * The two requests behind `/s/:token`, and the one gesture that ends them.
 *
 * ## Why they are two effects and not one
 *
 * They have different dependency sets, and collapsing them would reopen a defect this
 * route already has a test for.
 *
 * `GET /survey-links/{token}` is the call that increments
 * `survey_distributions.total_accesses`, which is the only access figure an
 * administrator is given. It takes no `lang` and must be made **exactly once per
 * visit**, so it depends on the token and on nothing else. Putting `locale` anywhere
 * near it reports one respondent switching language as two visitors.
 *
 * `GET /surveys/{id}/respond` is read-only and locale-bearing: it is where the survey's
 * title, its question count and its anonymity come from, and all three have to come
 * back in the language the reader picked. So it depends on the locale, and re-reading
 * it costs nothing but a query.
 *
 * ## Why both stop once the respondent has begun
 *
 * `SurveyInvitationPage` has the same ref for the same reason and states it: once the
 * questions are mounted, an effect that calls `setState` here unmounts
 * `SurveyRespondForm`, and a remounted form starts with an empty answer map. A
 * respondent who changed language mid-survey was dropped back on the landing card
 * having lost every answer, on the one route whose visitor has no account, no draft and
 * no way back. The form owns its own language switch and guards re-hydration behind a
 * ref of its own precisely so the answers survive it.
 *
 * The ref holds the token rather than a bare boolean so a genuinely different link —
 * same component, new `:token` — still loads from scratch, and it is cleared when the
 * token changes so that B -> A resolves as well as A -> B.
 */
export function usePublicEntryModel(token: string | undefined): {
  state: EntryState
  begin: () => void
} {
  const { locale } = useTranslation('surveyRespond')
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  const [link, setLink] = useState<LinkLoad>({ status: 'resolving' })
  const [view, setView] = useState<ViewLoad>({ status: 'idle' })
  const [answering, setAnswering] = useState(false)

  const begunToken = useRef<string | null>(null)

  useEffect(() => {
    return () => {
      begunToken.current = null
    }
  }, [token])

  // The token lookup. No `locale`, and no dependency that could acquire one.
  useEffect(() => {
    if (!token) return
    if (begunToken.current === token) return

    let cancelled = false
    setLink({ status: 'resolving' })
    setView({ status: 'idle' })
    setAnswering(false)

    resolveSurveyPublicLink(baseUrl, token)
      .then((detail) => {
        if (!cancelled) setLink({ status: 'resolved', detail })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLink({
          status: 'dead',
          error: error instanceof SurveyLinkError ? error : null,
        })
      })

    return () => {
      cancelled = true
    }
  }, [baseUrl, token])

  const surveyId = link.status === 'resolved' ? link.detail.surveyId : null

  // The survey itself. Never reached for a token that did not resolve — `surveyId` is
  // null until it does — which is what keeps a dead link from producing a request that
  // could put a survey's name on the page.
  useEffect(() => {
    if (surveyId === null) return
    if (token !== undefined && begunToken.current === token) return

    let cancelled = false
    setView({ status: 'loading' })

    // The same resume key the form will send, so the `inProgress` this page reads is
    // the row the form would find. Asking with a different session id would let the
    // entry offer "Empezar" for a response the next screen reports as already complete.
    getSurveyRespondView(baseUrl, surveyId, {
      lang: locale,
      sessionId: ensureSessionId(surveyId),
    })
      .then((loaded) => {
        if (!cancelled) setView({ status: 'ready', view: loaded })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setView({
          status: 'failed',
          error: error instanceof SurveyRespondError ? error : null,
        })
      })

    return () => {
      cancelled = true
    }
  }, [baseUrl, surveyId, locale, token])

  const begin = useCallback(() => {
    // Set before the state change, not after: from here on a language switch must find
    // the guard already closed.
    if (token !== undefined) begunToken.current = token
    setAnswering(true)
  }, [token])

  return {
    state: entryState(link, view, answering, getToken() !== null),
    begin,
  }
}
