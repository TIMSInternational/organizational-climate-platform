import { useCallback, useState } from 'react'
import { Download } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle, Button } from '../../../components/ui'
import { downloadBlobFile } from '../../../lib/downloadBlobFile'
import { useTranslation } from '../../../i18n'
import { dashboardExportFileName, type DashboardExportFormat } from '../api/dashboardExport'

interface DashboardExportControlProps {
  /**
   * What the dashboard is *of* — a company or a department name. Becomes the file name, so a
   * director can find it in a folder three months later. Null while the payload is loading,
   * which is also when the buttons are disabled.
   */
  subject: string | null

  /** Fetches the rendered file from the server. Never renders one in the browser. */
  fetchExport: (format: DashboardExportFormat) => Promise<Blob>
}

/**
 * Download this dashboard as a file (#134).
 *
 * ## Two buttons rather than a menu
 *
 * A format menu would be one more click for a two-item list, and the two items are not
 * variations of one action: a CSV goes into a spreadsheet and a PDF goes into a board pack.
 * Naming both is also what stops the pair being read as "export" plus an obscure alternative.
 *
 * ## A failure is shown, never swallowed
 *
 * The same rule `MicroclimateResultsPage` records: a download button that does nothing reads
 * as a broken build. The error lands in an inline alert beside the control rather than in the
 * page's load-error branch, which would replace a page that loaded perfectly well.
 */
export default function DashboardExportControl({ subject, fetchExport }: DashboardExportControlProps) {
  const { t } = useTranslation()
  const [exporting, setExporting] = useState(false)
  const [failed, setFailed] = useState(false)

  const download = useCallback(
    async (format: DashboardExportFormat) => {
      setExporting(true)
      setFailed(false)
      try {
        downloadBlobFile(
          dashboardExportFileName(subject ?? t('dashboard.title'), format),
          await fetchExport(format),
        )
      } catch {
        setFailed(true)
      } finally {
        setExporting(false)
      }
    },
    [fetchExport, subject, t],
  )

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={exporting || subject === null}
        onClick={() => void download('csv')}
      >
        <Download aria-hidden="true" />
        {t('dashboard.exportCsv')}
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={exporting || subject === null}
        onClick={() => void download('pdf')}
      >
        <Download aria-hidden="true" />
        {t('dashboard.exportPdf')}
      </Button>
      {failed ? (
        <Alert variant="destructive" role="alert" className="mt-panel-gap">
          <AlertTitle>{t('dashboard.exportFailedTitle')}</AlertTitle>
          <AlertDescription>{t('dashboard.exportFailed')}</AlertDescription>
        </Alert>
      ) : null}
    </>
  )
}
