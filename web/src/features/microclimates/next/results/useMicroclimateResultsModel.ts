import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '../../../../i18n'
import { downloadBlobFile } from '../../../../lib/downloadBlobFile'
import { getLiveResults, getMicroclimate, type LiveResults, type MicroclimateDetail } from '../../api/microclimates'
import { getMicroclimateCsv, microclimateCsvFileName } from '../../api/microclimateExport'
import { describeApiError } from '../../../../api/describeApiError'
import { companyZone } from '../companyZone'

export interface MicroclimateResultsState {
  status: 'loading' | 'ready' | 'error'
  error: string | null
  detail: MicroclimateDetail | null
  live: LiveResults | null
  /**
   * The session's company's IANA zone every date and time is printed on (`companyZone.ts`),
   * or `null` when it could not be read -- the page then prints the browser's and says so.
   */
  timeZone: string | null
  reload: () => void
  exporting: boolean
  exportError: string | null
  exportCsv: () => void
}

/**
 * THE wiring seam of `/microclimates/:id/results`, and the same three reads
 * `MicroclimateResultsPage` made: the detail (the questions), `/live-results` (the count, the
 * target and the words) and the server's CSV (`GET /{id}/export/csv`, fetched and handed over
 * as a Blob — an authorized download is never an `<a href>`).
 *
 * `/insights` is not read: it answers `generated: false, reason:
 * "no_insight_generator_configured"` on every call (measured on the tenant, 11 Sep), and the
 * sentiment banner that explained its absence is gone from this screen by ruling (triage row
 * 15).
 */
export function useMicroclimateResultsModel(id: string | undefined): MicroclimateResultsState {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [detail, setDetail] = useState<MicroclimateDetail | null>(null)
  const [live, setLive] = useState<LiveResults | null>(null)
  const [timeZone, setTimeZone] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [generation, setGeneration] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setStatus('loading')
    setError(null)
    // Both at once and both required: the count lives on `/live-results`, the questions on
    // the detail, and half a page for as long as the second request takes helps nobody.
    // The zone is the session's own company's, read before the page is drawn so no time is
    // printed on the wrong clock first; `companyZone` never throws (unreadable is `null`).
    Promise.all([
      getMicroclimate(baseUrl, id, locale).then(async (loaded) => ({ loaded, zone: await companyZone(baseUrl, loaded.companyId) })),
      getLiveResults(baseUrl, id),
    ])
      .then(([{ loaded: loadedDetail, zone }, loadedLive]) => {
        if (cancelled) return
        setDetail(loadedDetail)
        setLive(loadedLive)
        setTimeZone(zone)
        setStatus('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(describeApiError(err, t))
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [baseUrl, generation, id, locale, t])

  const exportCsv = useCallback(async () => {
    if (!id) return
    setExporting(true)
    setExportError(null)
    try {
      downloadBlobFile(microclimateCsvFileName(id), await getMicroclimateCsv(baseUrl, id, locale))
    } catch {
      setExportError(t('microclimates.failedToExportData'))
    } finally {
      setExporting(false)
    }
  }, [baseUrl, id, locale, t])

  return {
    status,
    error,
    detail,
    live,
    timeZone,
    reload: () => setGeneration((value) => value + 1),
    exporting,
    exportError,
    exportCsv: () => void exportCsv(),
  }
}
