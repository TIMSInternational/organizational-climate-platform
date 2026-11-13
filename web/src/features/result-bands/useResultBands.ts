import { useCallback, useEffect, useState } from 'react'
import { useCompanyScope } from '../../company-context'
import { DEFAULT_RESULT_BANDS, type ResultBands } from '../../components/charts'
import { getResultBands } from './api'

export type ResultBandsStatus = 'loading' | 'ready' | 'error'

export interface ResultBandsState {
  status: ResultBandsStatus
  /** Present exactly when `status === 'ready'`. */
  bands: ResultBands | null
  retry: () => void
}

/**
 * One read per company per page load: every banded screen asks, and the scale changes only
 * when an administrator saves it (`rememberResultBands`), so the answer is shared.
 */
const cache = new Map<string, Promise<ResultBands>>()

/** After a save: the scale every later screen reads is the one just written. */
export function rememberResultBands(companyId: string, bands: ResultBands): void {
  cache.set(companyId, Promise.resolve(bands))
}

/** For tests: forget every scale read so far. */
export function forgetResultBands(): void {
  cache.clear()
}

/**
 * For a screen about one record: whose scale to read. `string` that company's, `null` the
 * platform default, `undefined` not known yet (the hook reports `loading`).
 */
export interface ResultBandsFor {
  companyId: string | null | undefined
}

/**
 * The company's result bands, for every screen that colours a mean.
 *
 * **No fallback to the default on a failure.** A tenant that renamed or moved its bands
 * would otherwise see the product's 3,00 / 4,00 painted as if they were its own — a colour
 * the company never chose, on the very screen it reads to decide. So a failed read is an
 * error the page shows (and can retry), exactly like a failed read of the numbers. The one
 * case that reads the default without asking is a viewer with no company in scope — the
 * super administrator's platform view — where there is no company scale to ask for.
 */
export function useResultBands(options?: ResultBandsFor): ResultBandsState {
  const scope = useCompanyScope()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const headerCompanyId = scope.status === 'ready' ? (scope.companyId ?? null) : undefined
  // A screen about ONE record reads that record's company scale, never the header's: the results
  // of another client's survey were coloured by whichever client the header held
  // (docs/audits/2026-11-08-operator-ui-walkthrough.md). `undefined` there means "not known yet".
  const companyId = options ? options.companyId : headerCompanyId
  const [state, setState] = useState<{ key: string | null | undefined; bands: ResultBands | null; failed: boolean }>({
    key: undefined,
    bands: null,
    failed: false,
  })
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => {
    if (companyId) cache.delete(companyId)
    setState((previous) => ({ ...previous, key: undefined }))
    setAttempt((value) => value + 1)
  }, [companyId])

  useEffect(() => {
    if (companyId === undefined || companyId === null) return
    let cancelled = false
    let pending = cache.get(companyId)
    if (!pending) {
      pending = getResultBands(baseUrl, companyId)
      cache.set(companyId, pending)
      pending.catch(() => cache.delete(companyId))
    }
    pending.then(
      (bands) => {
        if (!cancelled) setState({ key: companyId, bands, failed: false })
      },
      () => {
        if (!cancelled) setState({ key: companyId, bands: null, failed: true })
      },
    )
    return () => {
      cancelled = true
    }
  }, [baseUrl, companyId, attempt])

  if (companyId === undefined) return { status: 'loading', bands: null, retry }
  if (companyId === null) return { status: 'ready', bands: DEFAULT_RESULT_BANDS, retry }
  if (state.key !== companyId) return { status: 'loading', bands: null, retry }
  if (state.failed) return { status: 'error', bands: null, retry }
  return { status: 'ready', bands: state.bands, retry }
}
