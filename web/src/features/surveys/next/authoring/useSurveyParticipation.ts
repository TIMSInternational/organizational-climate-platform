import { useEffect, useState } from 'react'
import { getSurveyParticipation, type SurveyParticipationView } from '../../api/surveys'

export type ParticipationState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; view: SurveyParticipationView }

/**
 * `GET /surveys/{id}/participation`, fetched ONCE for the whole page.
 *
 * <p>
 * Two panels read this payload — Participación and the roster — and each fetching it for
 * itself meant two identical requests on every load. On ESPH's 800 people that is two rosters
 * of 800 rows, each carrying every person's demographics, and two passes of the same join, on
 * a deployment with one vCPU across four instances. It also silently broke the page's own
 * tests, where a `mockResolvedValueOnce` was consumed by whichever panel mounted first and the
 * other got nothing.
 * </p>
 *
 * <p>
 * `enabled` is false for a viewer who may not read the list at all, and the hook then stays
 * `idle` and asks for nothing. It is a parameter rather than a conditional call because a hook
 * cannot be called conditionally.
 * </p>
 */
export function useSurveyParticipation(surveyId: string, enabled: boolean): ParticipationState {
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [state, setState] = useState<ParticipationState>(enabled ? { status: 'loading' } : { status: 'idle' })

  useEffect(() => {
    if (!enabled) {
      setState({ status: 'idle' })
      return
    }

    let live = true
    setState({ status: 'loading' })
    getSurveyParticipation(baseUrl, surveyId)
      .then((view) => {
        if (live) setState({ status: 'ready', view })
      })
      .catch(() => {
        if (live) setState({ status: 'error' })
      })
    return () => {
      live = false
    }
  }, [baseUrl, surveyId, enabled])

  return state
}
