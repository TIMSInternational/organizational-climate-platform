import { useEffect, useState } from 'react'
import { useTranslation } from '../../../../i18n'
import { useCompanyScope } from '../../../../company-context'
import { getLiveResults, getMicroclimate, listMicroclimates, type Microclimate, type MicroclimateDetail } from '../../api/microclimates'
import { suppressWordCloud } from '../../microclimatePrivacy'
import { belowFloor, newestFirst } from '../derive'

export type Settled<T> = { status: 'loading' } | { status: 'ready'; value: T } | { status: 'failed' }

export interface SessionRow {
  session: Microclimate
  /** The session's detail: its window, its anonymity and how many questions it asks. */
  detail: Settled<MicroclimateDetail>
  /**
   * Words the session may show, counted after both floors — read only for a session at or
   * over the floor, so a protected one never has its words fetched at all.
   */
  words: Settled<number> | { status: 'protected' }
}

export interface MicroclimateAnalyticsState {
  status: 'loading' | 'ready' | 'error'
  error: string | null
  rows: readonly SessionRow[]
  reload: () => void
}

/** Sessions whose detail is read for the table's second line. Beyond it the row keeps the list's own fields. */
export const DETAILED_SESSIONS = 20

/**
 * THE wiring seam of `/microclimates/analytics`. `MicroclimateAnalyticsPage` built its page
 * from `GET /microclimates` alone — there is no analytics endpoint — and so does this one,
 * plus two existing reads per session for what the board prints beside each: the detail
 * (`GET /microclimates/{id}`: window, anonymity, question count) and, only for a session at
 * or over the floor, `GET /{id}/live-results` for how many words it may show.
 *
 * The board's "Pulso en el tiempo" needs a 1–5 average per session, and none exists: a
 * microclimate folds its answers into a count and a word map and keeps nothing per question
 * (`MicroclimateEndpoints.cs`, the dropped `GET /{id}/responses`). So no average is read,
 * none is sampled, and the screen prints none.
 */
export function useMicroclimateAnalyticsModel(): MicroclimateAnalyticsState {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const companyId = useCompanyScope().companyId
  const [rows, setRows] = useState<SessionRow[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    setStatus('loading')
    setError(null)
    listMicroclimates(baseUrl, companyId, locale)
      .then((list) => {
        if (cancelled) return
        const sessions = newestFirst(list)
        const initial: SessionRow[] = sessions.map((session, index) => ({
          session,
          detail: index < DETAILED_SESSIONS ? { status: 'loading' } : { status: 'failed' },
          words: belowFloor(session.responseCount) ? { status: 'protected' } : { status: 'loading' },
        }))
        setRows(initial)
        setStatus('ready')

        const patchRow = (id: string, next: Partial<SessionRow>) => {
          if (cancelled) return
          setRows((current) => current.map((row) => (row.session.id === id ? { ...row, ...next } : row)))
        }
        sessions.slice(0, DETAILED_SESSIONS).forEach((session) => {
          getMicroclimate(baseUrl, session.id, locale)
            .then((detail) => patchRow(session.id, { detail: { status: 'ready', value: detail } }))
            .catch(() => patchRow(session.id, { detail: { status: 'failed' } }))
        })
        sessions
          .filter((session) => !belowFloor(session.responseCount))
          .forEach((session) => {
            getLiveResults(baseUrl, session.id)
              .then((live) => {
                const kept = suppressWordCloud(live.wordCloud, live.responseCount)
                patchRow(session.id, {
                  words: kept.isSuppressed ? { status: 'protected' } : { status: 'ready', value: kept.words.length },
                })
              })
              .catch(() => patchRow(session.id, { words: { status: 'failed' } }))
          })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : t('errors.generic'))
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [baseUrl, companyId, generation, locale, t])

  return { status, error, rows, reload: () => setGeneration((value) => value + 1) }
}
