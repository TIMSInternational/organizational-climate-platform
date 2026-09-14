import { useState } from 'react'
import { Download } from 'lucide-react'
import { useTranslation } from '../../../i18n'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../components/ui'
import { downloadBlobFile } from '../../../lib/downloadBlobFile'
import {
  dashboardExportFileName,
  getCompanyDashboardExport,
  getDepartmentDashboardExport,
  type DashboardExportFormat,
} from '../api/dashboardExport'

/**
 * The Panel de Control's one "Exportar" button, as the artboard draws it, opening the two
 * files the server renders — `GET /dashboard/company-admin/export?format=csv|pdf`
 * (`DashboardEndpoints.cs:121`, #134) through `getCompanyDashboardExport`, fetched with the
 * bearer and saved from a `Blob` (an `<a href>` would send cookies, not the header).
 *
 * The first cut drew the button and gave it no handler: a control that exists and does
 * nothing, which `viewerCapabilities.ts` names as worse than none. A failure is shown in
 * a sentence beside the actions, never swallowed.
 *
 * `companyId` is a SuperAdmin's chosen tenant and `undefined` for a CompanyAdmin, whose
 * scope the server takes from the claim — the same rule `useAdminDashboardModel` follows.
 *
 * `scope="department"` is the leader's Panel de Control (the canvas's LeaderDashboard):
 * the same button and menu, fetching `GET /dashboard/department-admin/export`
 * (`DashboardEndpoints.cs:124`) through `getDepartmentDashboardExport` with no department
 * id — the server reads the caller's own row, exactly as the screen's own read does.
 */
export default function DashboardExportMenu({
  subject,
  companyId,
  scope = 'company',
}: {
  subject: string
  companyId?: string
  scope?: 'company' | 'department'
}) {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [exporting, setExporting] = useState(false)
  const [failed, setFailed] = useState(false)

  function download(format: DashboardExportFormat) {
    setExporting(true)
    setFailed(false)
    const request =
      scope === 'department'
        ? getDepartmentDashboardExport(baseUrl, format, { lang: locale })
        : getCompanyDashboardExport(baseUrl, format, { companyId, lang: locale })
    request
      .then((file) => downloadBlobFile(dashboardExportFileName(subject, format), file))
      .catch(() => setFailed(true))
      .finally(() => setExporting(false))
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" disabled={exporting} data-slot="dashboard-export">
            <Download aria-hidden="true" />
            {t('dashboard.next.export')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => download('csv')}>{t('dashboard.exportCsv')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => download('pdf')}>{t('dashboard.exportPdf')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {failed && (
        <p role="alert" className="m-0 basis-full text-right text-sm text-accent-red-ink">
          {t('dashboard.exportFailed')}
        </p>
      )}
    </>
  )
}
