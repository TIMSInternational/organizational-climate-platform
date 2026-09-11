import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from '../../../i18n'
import { downloadBlobFile } from '../../../lib/downloadBlobFile'
import {
  createReport,
  downloadReport,
  listReports,
  reportFileName,
  type Report,
  type ReportListItem,
} from '../api/reports'
import { listReportShares, type ReportShareSummary } from '../api/reportShares'
import type { ReportFormValues } from '../components/ReportForm'
import type { ReportRow, ReportsListModel } from './model'
import { sampleContents } from './sampleModel'

export type ReportsListStatus = 'forbidden' | 'loading' | 'ready' | 'error'

/** What the viewer may do with the company in the URL, as the page read it off the seam. */
export interface ReportsListAccess {
  /** `ReportEndpoints.CanAccessCompany` for that company: list, create, download, schedule. */
  mayRead: boolean
  /** `ReportShareEndpoints.CanAccessCompany`, as `canShareReports` rules it: list, mint, revoke links. */
  mayShare: boolean
}

export interface ReportsListState {
  status: ReportsListStatus
  model: ReportsListModel
  error: string | null
  reload: () => void
  /** Creates a report and reloads the list; throws the server's refusal to the form. */
  create: (values: ReportFormValues) => Promise<void>
  /** Saves the rendered file; resolves to the name it was saved under. */
  download: (row: ReportRow) => Promise<string>
  /** Folds a saved schedule back into its row — the PUT/DELETE return the whole report. */
  applySchedule: (saved: Report) => void
  /** Replaces one report's links after the share dialog minted or revoked one. */
  setShares: (reportId: string, shares: readonly ReportShareSummary[]) => void
}

/**
 * The model behind `/admin/companies/:companyId/reports` — THE wiring seam of the screen.
 *
 * Real: `GET /admin/reports?companyId&lang` through `listReports` (the company is the URL's,
 * never a claim — `ReportsListPage.tsx` records why that is what makes the page safe for a
 * super_admin), and, when the viewer may list links, `GET /admin/reports/{id}/shares` for
 * every COMPLETED report through `listReportShares`. A link to a report that is not
 * completed resolves to nothing, so those are not read. A failed links read leaves that
 * row's `shares` at `null` rather than failing the page: the reports are still there.
 *
 * Sample: `contents`, from `sampleModel.ts`, and only that — `isSample` is true exactly
 * while it feeds a row.
 *
 * Nothing is requested for a viewer the server would refuse (`status: 'forbidden'`): a
 * request that can only 403 is a control that exists and then fails.
 */
export function useReportsListModel(companyId: string | undefined, access: ReportsListAccess): ReportsListState {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const { mayRead, mayShare } = access
  const [items, setItems] = useState<ReportListItem[]>([])
  const [shares, setSharesMap] = useState<Record<string, readonly ReportShareSummary[] | null>>({})
  const [status, setStatus] = useState<ReportsListStatus>(mayRead && companyId ? 'loading' : 'forbidden')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!companyId || !mayRead) {
      setStatus('forbidden')
      return
    }
    setStatus('loading')
    setError(null)
    try {
      // `lang` rides along so the bilingual titles come back in the reader's language.
      const list = await listReports(baseUrl, companyId, locale)
      let read: Record<string, readonly ReportShareSummary[] | null> = {}
      if (mayShare) {
        const completed = list.filter((row) => row.status === 'completed')
        const results = await Promise.all(
          completed.map((row) => listReportShares(baseUrl, row.id).catch(() => null)),
        )
        read = Object.fromEntries(completed.map((row, index) => [row.id, results[index]]))
      }
      setItems(list)
      setSharesMap(read)
      setStatus('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
      setStatus('error')
    }
  }, [baseUrl, companyId, locale, mayRead, mayShare, t])

  useEffect(() => {
    void load()
  }, [load])

  const model = useMemo<ReportsListModel>(() => {
    const rows: ReportRow[] = items.map((item) => ({
      id: item.id,
      title: item.title,
      type: item.type,
      format: item.format,
      status: item.status,
      createdAt: item.createdAt,
      isRecurring: item.isRecurring,
      recurrencePattern: item.recurrencePattern,
      nextGeneration: item.nextGeneration,
      shares: shares[item.id] ?? null,
      // Only a completed report has a document to contain anything: a generating one has
      // none yet and a failed one never will, so the sample is not stamped on them — it
      // would claim "24 respuestas · 4 de 5 grupos" for a file that does not exist.
      contents: item.status === 'completed' ? sampleContents : null,
    }))
    return { isSample: rows.some((row) => row.contents === sampleContents), rows }
  }, [items, shares])

  const create = useCallback(
    async (values: ReportFormValues) => {
      if (!companyId) return
      await createReport(baseUrl, {
        title: values.title,
        // Omitted rather than sent as `''`: `Description` is nullable on the entity.
        ...(values.description.trim() ? { description: values.description.trim() } : {}),
        type: values.type,
        companyId,
        format: values.format,
      })
      await load()
    },
    [baseUrl, companyId, load],
  )

  const download = useCallback(
    async (row: ReportRow) => {
      const fileName = reportFileName(row.id, row.format)
      // The reader's locale rides along: the server heads the document for it.
      downloadBlobFile(fileName, await downloadReport(baseUrl, row.id, locale))
      return fileName
    },
    [baseUrl, locale],
  )

  const applySchedule = useCallback((saved: Report) => {
    setItems((current) =>
      current.map((row) =>
        row.id === saved.id
          ? {
              ...row,
              isRecurring: saved.isRecurring,
              recurrencePattern: saved.recurrencePattern,
              nextGeneration: saved.nextGeneration,
            }
          : row,
      ),
    )
  }, [])

  const setShares = useCallback((reportId: string, next: readonly ReportShareSummary[]) => {
    setSharesMap((current) => ({ ...current, [reportId]: next }))
  }, [])

  const reload = useCallback(() => {
    void load()
  }, [load])

  return { status, model, error, reload, create, download, applySchedule, setShares }
}
