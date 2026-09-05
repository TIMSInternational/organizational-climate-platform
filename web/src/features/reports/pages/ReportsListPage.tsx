import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router'
import {
  createReport,
  downloadReport,
  listReports,
  reportFileName,
  type Report,
  type ReportListItem,
} from '../api/reports'
import ReportForm, { type ReportFormValues } from '../components/ReportForm'
import ReportList from '../components/ReportList'
import ReportSchedulePanel from '../components/ReportSchedulePanel'
import ReportSharePanel from '../components/ReportSharePanel'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { downloadBlobFile } from '../../../lib/downloadBlobFile'
import {
  Button,
  LoadingRegion,
  NetworkError,
  SkeletonText,
} from '../../../components/ui'

/**
 * Reports for one company.
 *
 * ## The SuperAdmin scoping trap, and why this page does not have it
 *
 * #94 warns that these pages repeat the Action Plans problem: a SuperAdmin landing on a
 * page with no company picker is silently scoped to whatever company their own user row
 * points at, which *looks* like a cross-company view and is not. `ActionPlansListPage`
 * and `MicroclimatesListPage` block SuperAdmin outright for exactly that reason.
 *
 * This page takes its company from the **URL**, `/admin/companies/:companyId/reports`, the
 * same way `UsersListPage` and `DemographicFieldsPage` already do — so there is no implicit
 * scope to be wrong about. A SuperAdmin here is looking at the company named in the address
 * bar because they navigated to it, and the backend agrees: `ReportEndpoints.CanAccessCompany`
 * admits a SuperAdmin for any company and a CompanyAdmin only for their own. Blocking
 * SuperAdmin as well would be cargo-culting the workaround without the defect.
 *
 * That is also why the nav entry (`navSections.ts`) exists only on the `company_admin`
 * branch: a SuperAdmin's nav carries no company id at all — asserted in `navSections.test.ts`
 * — so there is nothing to interpolate. A SuperAdmin reaches this page from the company they
 * opened, via `CompanyDetailPage`.
 *
 * ## Download produces a file
 *
 * It did not until now: `DownloadAsync` incremented a counter and handed back the record, and
 * this page carried a banner (`reports.generationStubbed`) saying so rather than letting an
 * admin conclude their download had failed. The banner is gone because the statement is no
 * longer true -- the endpoint renders the stored document as a PDF or a CSV
 * (`ReportRenderer`), and `handleDownload` saves the blob.
 *
 * The notice lost its number along with the banner. `downloadCount` had exactly one source --
 * the `ReportDetail` the download used to return -- and the response body is now the file, so
 * "downloaded 3 times in total" is a figure this page can no longer read. It named nothing an
 * admin acts on; what replaced it names the file that just landed.
 */
export default function ReportsListPage() {
  const { t } = useTranslation()
  const { companyId } = useParams<{ companyId: string }>()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [reports, setReports] = useState<ReportListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | undefined>(undefined)
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null)
  // The report the share panel is open for, not a boolean plus an id: two pieces of state
  // that have to agree is how a dialog ends up open against the wrong row.
  const [sharing, setSharing] = useState<ReportListItem | null>(null)
  // Same shape and the same reason as `sharing`: the report the schedule panel is open for,
  // not a boolean plus an id.
  const [scheduling, setScheduling] = useState<ReportListItem | null>(null)

  // `useCallback` rather than a plain function plus a deps-array lie: the web lint
  // budget is `--max-warnings 10` and it is exactly full, so a new
  // `react-hooks(exhaustive-deps)` warning fails CI. `t` is stable per locale
  // (TranslationProvider memoises it), so this refetches on a language switch and at
  // no other time.
  const reload = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    setError(null)
    try {
      setReports(await listReports(baseUrl, companyId))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [baseUrl, companyId, t])

  useEffect(() => {
    reload()
  }, [reload])

  async function handleCreate(values: ReportFormValues) {
    if (!companyId) return
    await createReport(baseUrl, {
      title: values.title,
      // Omitted rather than sent as `''`: `Description` is nullable on the entity, and an
      // empty string would read as "described, with nothing" in every later consumer.
      ...(values.description.trim() ? { description: values.description.trim() } : {}),
      type: values.type,
      companyId,
      format: values.format,
    })
    setShowCreateForm(false)
    await reload()
  }

  async function handleDownload(report: ReportListItem) {
    setDownloadingId(report.id)
    setDownloadNotice(null)
    try {
      // The blob, then the save. A failure lands in the page's own error banner rather than
      // in a silent no-op, because a download button that does nothing reads as a broken
      // build -- the same call SurveyResultsPage makes for the survey PDF.
      const fileName = reportFileName(report.id, report.format)
      downloadBlobFile(fileName, await downloadReport(baseUrl, report.id))
      setDownloadNotice(t('reports.downloaded', { title: report.title, fileName }))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setDownloadingId(undefined)
    }
  }

  /**
   * Folds the saved schedule back into the row in place rather than refetching the list.
   *
   * The `PUT`/`DELETE` return the whole report, so the three columns this page displays are
   * already in hand. Reloading would also collapse the create form and clear the download
   * notice, both of which are unrelated to having changed a schedule.
   */
  function handleScheduleSaved(saved: Report) {
    setReports((current) =>
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
  }

  if (!companyId) {
    return <p role="alert">{t('common.noCompanyAssociated')}</p>
  }

  return (
    <div>
      <PageTopBar
        title={t('navigation.reports')}
        description={t('navigation.reportsDesc')}
        // `/admin/companies/:companyId` is loadable by a super_admin and by that
        // company's own company_admin -- precisely who can load this page -- so the
        // crumb never points somewhere the viewer would be 403'd. A crumb to
        // /admin/companies would, since that page is SuperAdmin-only. Same reasoning
        // as UsersListPage.
        breadcrumbs={[
          { label: t('navigation.companySettings'), href: `/admin/companies/${companyId}` },
          { label: t('navigation.reports') },
        ]}
        actions={
          <Button type="button" onClick={() => setShowCreateForm((value) => !value)}>
            {showCreateForm ? t('common.cancel') : t('reports.newReport')}
          </Button>
        }
      />

      {showCreateForm && <ReportForm onSubmit={handleCreate} />}

      {/* `role="status"`, not `alert`: a completed download is not an error. It is still
          announced, because a screen-reader user gets no indication at all from the
          browser's own download chrome that the click did anything. */}
      {downloadNotice && <p role="status">{downloadNotice}</p>}

      {error ? (
        <NetworkError
          title={t('errors.generic')}
          description={error}
          onRetry={reload}
          retryText={t('common.retry')}
        />
      ) : (
        // `LoadingRegion` already announces `common.loading` in an sr-only live
        // region, so the visible placeholder is a skeleton rather than a second copy
        // of the same word — one announcement, and a shape that shows where the rows
        // will land.
        <LoadingRegion loading={loading} label={t('common.loading')}>
          {loading ? (
            <SkeletonText lines={4} />
          ) : (
            <ReportList
              reports={reports}
              downloadingId={downloadingId}
              onDownload={handleDownload}
              onShare={setSharing}
              onSchedule={setScheduling}
            />
          )}
        </LoadingRegion>
      )}

      {/* Mounted only while a report is selected, so the panel's own effect refetches the
          share list on every opening rather than showing a stale one. */}
      {scheduling && (
        <ReportSchedulePanel
          open
          onOpenChange={(next) => {
            if (!next) setScheduling(null)
          }}
          baseUrl={baseUrl}
          report={scheduling}
          onSaved={handleScheduleSaved}
        />
      )}

      {sharing && (
        <ReportSharePanel
          open
          onOpenChange={(next) => {
            if (!next) setSharing(null)
          }}
          baseUrl={baseUrl}
          reportId={sharing.id}
          reportTitle={sharing.title}
        />
      )}
    </div>
  )
}
