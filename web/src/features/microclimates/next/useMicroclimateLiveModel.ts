import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '../../../i18n'
import { useViewerCapabilities } from '../../../auth/viewerCapabilities'
import { usePolling } from '../../../components/charts/usePolling'
import {
  getLiveResults,
  getMicroclimate,
  updateMicroclimate,
  type LiveResults,
  type MicroclimateDetail,
} from '../api/microclimates'
import type { MicroclimateLiveNextModel } from './model'
import { companyZone } from './companyZone'
import { describeApiError } from '../../../api/describeApiError'

/**
 * Milliseconds between polls. `usePolling` refuses anything outside 3000–5000; 4000 is
 * the old live page's value and its reasoning still holds — a session runs for minutes
 * in front of a room, so the figure has to be seconds old, not a minute old.
 */
export const LIVE_POLL_MS = 4000

export type MicroclimateLiveStatus =
  | 'loading'
  | 'ready'
  | 'error'
  /** A leader, supervisor or employee: `GetAsync` and `/live-results` answer them 403. */
  | 'forbidden'
  | 'not-found'

export interface MicroclimateLiveState {
  status: MicroclimateLiveStatus
  model: MicroclimateLiveNextModel | null
  /**
   * The session's company's IANA zone every date and time is printed on (`companyZone.ts`),
   * or `null` when it could not be read -- the page then prints the browser's and says so.
   */
  timeZone: string | null
  error: string | null
  reload: () => void
  /** The viewer may close this session, and it is open to close. */
  mayClose: boolean
  /** Closes the session; rejects with the server's message. */
  close: () => Promise<void>
}

/**
 * The model behind `/microclimates/:id/live` — THE wiring seam of the redesigned live
 * session, and the same three requests the old live page made
 * (`MicroclimateLivePage`):
 *
 * - `GET /microclimates/{id}` once — the title, the schedule, the questions and the
 *   anonymity do not move while a session runs;
 * - `GET /microclimates/{id}/live-results` on `usePolling`'s loop, **only while the
 *   session is open** — a page left on a draft or a closed session does not hit the API
 *   every four seconds for a number that cannot change;
 * - for a closed session, the same read once, so its final words are drawn (under the
 *   floor, like every other time) without a loop.
 *
 * ## Who is answered
 *
 * `GetAsync` (`MicroclimateEndpoints.cs:679`) and `GetLiveResultsAsync` (`:1420`) are
 * gated by `CanAccessCompany`: a `super_admin` for any session — with no company chosen,
 * since the id names the session — and a `company_admin` for their own tenant's. So an
 * admin role is the read gate (`!seesTeam && !seesOnlySelf`), not
 * `canLaunchMicroclimate`, which also wants a company selected. Closing is
 * `PUT /microclimates/{id}` through `LoadForAdminAsync` (`:1088`), the same helper, so
 * the viewer who may watch may also close — and only an open session is offered it.
 */
export function useMicroclimateLiveModel(id: string | undefined): MicroclimateLiveState {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const capabilities = useViewerCapabilities()
  const mayWatch = !capabilities.seesTeam && !capabilities.seesOnlySelf

  const [detail, setDetail] = useState<MicroclimateDetail | null>(null)
  const [timeZone, setTimeZone] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [final, setFinal] = useState<LiveResults | null>(null)

  const reload = useCallback(async () => {
    if (!id || !mayWatch) return
    setStatus('loading')
    setError(null)
    try {
      // The UI locale, sent explicitly: left to the server it resolves against the
      // session's own language, and a Spanish reader gets English on a bilingual one.
      const loaded = await getMicroclimate(baseUrl, id, locale)
      // The session's own company's zone, read before the page is drawn so no time is printed
      // on the wrong clock first. `companyZone` never throws: unreadable is `null`.
      const zone = await companyZone(baseUrl, loaded.companyId)
      setDetail(loaded)
      setTimeZone(zone)
      setStatus('ready')
    } catch (err) {
      setError(describeApiError(err, t))
      setStatus('error')
    }
  }, [baseUrl, id, locale, mayWatch, t])

  useEffect(() => {
    void reload()
  }, [reload])

  const sessionStatus = detail?.status
  const isOpen = sessionStatus === 'active'

  const fetchLive = useCallback(() => getLiveResults(baseUrl, id ?? ''), [baseUrl, id])
  const polling = usePolling(fetchLive, { intervalMs: LIVE_POLL_MS, enabled: mayWatch && isOpen })

  useEffect(() => {
    if (!mayWatch || !id || sessionStatus !== 'closed') return
    let cancelled = false
    getLiveResults(baseUrl, id)
      .then((read) => {
        if (!cancelled) setFinal(read)
      })
      .catch(() => {
        if (!cancelled) setFinal(null)
      })
    return () => {
      cancelled = true
    }
  }, [baseUrl, id, mayWatch, sessionStatus])

  const close = useCallback(async () => {
    if (!id) return
    // `PUT /microclimates/{id}` with the status, as `MicroclimateDetailPage` sends it;
    // then the detail re-read in the reader's locale, because the PUT's answer resolves
    // the title against the session's own language.
    await updateMicroclimate(baseUrl, id, { status: 'closed' })
    setDetail(await getMicroclimate(baseUrl, id, locale))
  }, [baseUrl, id, locale])

  const resolved: MicroclimateLiveStatus = !id ? 'not-found' : !mayWatch ? 'forbidden' : status

  return {
    status: resolved,
    model:
      resolved === 'ready' && detail
        ? {
            detail,
            live: isOpen ? polling.data : (final ?? polling.data),
            lastUpdatedAt: polling.lastUpdatedAt,
            isStale: polling.isStale,
          }
        : null,
    timeZone,
    error,
    reload: () => {
      void reload()
    },
    mayClose: mayWatch && isOpen,
    close,
  }
}
