import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from '../../../i18n'
import { downloadBlobFile } from '../../../lib/downloadBlobFile'
import {
  createReport,
  downloadReport,
  getReport,
  listReports,
  reportFileName,
  type Report,
  type ReportListItem,
} from '../api/reports'
import { listReportShares, type ReportShareSummary } from '../api/reportShares'
import { parseReportDocument } from '../reportDocument'
import type { ReportFormValues } from '../components/ReportForm'
import { contentsOf } from './derive'
import type { ReportContents, ReportRow, ReportsListModel } from './model'

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
 * `contents` is the report's own stored document: `GET /admin/reports/{id}` per COMPLETED
 * row, parsed by `parseReportDocument` and reduced by `contentsOf`. It used to be the same
 * invented `sampleContents` object stamped on every completed row — "Encuesta de Clima Q3 ·
 * 24 respuestas · 4 de 5 grupos · Finanzas protegido" on every line of the list, for every
 * tenant. A detail read that fails leaves THAT row's `contents` at `null`, like a failed
 * links read leaves its `shares`: the row is still listed, and describes itself as nothing
 * rather than borrowing another report's summary.
 *
 * ## One request per completed row, deliberately
 *
 * `GET /admin/reports` (`ReportListItem`) carries none of this, so the alternative is
 * adding three fields to the list projection. The lists are short, this ships without
 * touching the API, and the projection change stays a clean follow-up if it ever gets slow.
 * The reads run together with the links reads already made for the same rows.
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
  const [contents, setContentsMap] = useState<Record<string, ReportContents | null>>({})
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
      // Only a completed report has a document at all: a generating one has none yet and a
      // failed one never will, so neither is read and neither claims contents.
      const completed = list.filter((row) => row.status === 'completed')
      const [shareResults, documents] = await Promise.all([
        mayShare
          ? Promise.all(completed.map((row) => listReportShares(baseUrl, row.id).catch(() => null)))
          : Promise.resolve([]),
        Promise.all(
          completed.map((row) =>
            getReport(baseUrl, row.id, locale)
              .then((report) => contentsOf(parseReportDocument(report.reportOutput)))
              .catch(() => null),
          ),
        ),
      ])
      setItems(list)
      setSharesMap(mayShare ? Object.fromEntries(completed.map((row, index) => [row.id, shareResults[index]])) : {})
      setContentsMap(Object.fromEntries(completed.map((row, index) => [row.id, documents[index]])))
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
      contents: contents[item.id] ?? null,
    }))
    return { rows }
  }, [items, shares, contents])

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
