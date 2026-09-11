import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from '../../../i18n'
import { useCompanyScope } from '../../../company-context'
import { useViewerCapabilities } from '../../../auth/viewerCapabilities'
import { getMicroclimate, listMicroclimates } from '../api/microclimates'
import { flowStepOf, groupSessions } from './derive'
import type { InProgressSession, MicroclimatesListNextModel } from './model'

export type MicroclimatesListStatus =
  | 'loading'
  | 'ready'
  | 'error'
  /** A leader, supervisor or employee: the server answers every read here 403. */
  | 'forbidden'
  /** A super admin with no company chosen: `GET /microclimates` needs one to name. */
  | 'needs-company'
  /** A company admin whose token names no tenant. */
  | 'no-company'

export interface MicroclimatesListState {
  status: MicroclimatesListStatus
  model: MicroclimatesListNextModel
  error: string | null
  reload: () => void
}

const EMPTY: MicroclimatesListNextModel = { inProgress: [], past: [], current: null, step: null }

/**
 * The model behind `/microclimates` — THE wiring seam of the redesigned list, and the
 * request the old list made (`MicroclimatesListPage`): `GET /microclimates?companyId=`
 * through `listMicroclimates`, the company from `useCompanyScope()`.
 *
 * One more read per session in progress — normally one — `GET /microclimates/{id}`,
 * for the three facts the artboard prints on the row that the list payload does not
 * carry: when it closes, how many questions, whether it is anonymous. A failed detail
 * costs that row its facts and nothing else (`Promise.allSettled`).
 *
 * ## Who is answered
 *
 * `ListAsync` and `GetAsync` are both gated by `CanAccessCompany`
 * (`MicroclimateEndpoints.cs:134-136`, `:220`, `:679`): a `super_admin` for any company,
 * a `company_admin` for their own, nobody else. That is exactly the predicate
 * `canLaunchMicroclimate` mirrors (`viewerCapabilities.ts`, `POST /microclimates` at
 * `:347` is `Roles.Admin` + the same helper), so a viewer it refuses is never sent a
 * request that could only come back 403: a leader, supervisor or employee reads
 * `forbidden`; a super admin with no company chosen is asked to choose one.
 */
export function useMicroclimatesListModel(): MicroclimatesListState {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const scope = useCompanyScope()
  const capabilities = useViewerCapabilities()

  const gate: MicroclimatesListStatus | null =
    capabilities.seesTeam || capabilities.seesOnlySelf
      ? 'forbidden'
      : scope.status === 'needs-selection'
        ? 'needs-company'
        : !capabilities.canLaunchMicroclimate || !scope.companyId
          ? 'no-company'
          : null
  const companyId = gate === null ? scope.companyId : undefined

  const [model, setModel] = useState<MicroclimatesListNextModel>(EMPTY)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  // The newest request wins: a switched company must never be overwritten by the
  // answer to the previous one arriving late.
  const latest = useRef(0)

  const reload = useCallback(async () => {
    if (!companyId) return
    const request = ++latest.current
    setStatus('loading')
    setError(null)
    try {
      const rows = await listMicroclimates(baseUrl, companyId, locale)
      const { inProgress, past } = groupSessions(rows)
      const details = await Promise.allSettled(
        inProgress.map((row) => getMicroclimate(baseUrl, row.id, locale)),
      )
      if (request !== latest.current) return
      const sessions: InProgressSession[] = inProgress.map((row, index) => {
        const read = details[index]
        return { row, detail: read.status === 'fulfilled' ? read.value : null }
      })
      const current = sessions[0] ?? null
      setModel({
        inProgress: sessions,
        past,
        current,
        step: current ? flowStepOf(current.row.status) : null,
      })
      setStatus('ready')
    } catch (err) {
      if (request !== latest.current) return
      setError(err instanceof Error ? err.message : t('errors.generic'))
      setStatus('error')
    }
  }, [baseUrl, companyId, locale, t])

  useEffect(() => {
    void reload()
  }, [reload])

  return {
    status: gate ?? status,
    model,
    error,
    reload: () => {
      void reload()
    },
  }
}
