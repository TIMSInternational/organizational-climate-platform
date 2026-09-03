import type { ReportListItem } from '../api/reports'
import { useTranslation } from '../../../i18n'
import { Badge, Button, EmptyState, Table } from '../../../components/ui'
import { calendarDay } from '../../../lib/calendarDay'

/**
 * Status values the backend actually writes (`ReportEndpoints.CreateAsync`), mapped to a
 * catalogue key.
 *
 * A status this map does not know is rendered as the raw server value rather than as a
 * missing translation. `status` is server data, not copy — inventing a key for a value
 * the backend may never emit is how catalogues rot.
 *
 * ## Why there is no `variant` here, and the badge is always `secondary`
 *
 * The obvious mapping is `success` / `warning` / `destructive`, which is what
 * `charts/RecommendationCard.tsx` does for priority. **Every one of those variants fails
 * WCAG AA 1.4.3 in at least one theme**, measured against `styles/tokens.css` in both:
 *
 * | variant | light | dark |
 * |---|---|---|
 * | `default` (accent-blue on blue-soft) | 3.45:1 | 4.25:1 |
 * | `success` (accent-green on green-soft) | 3.49:1 | 6.14:1 |
 * | `warning` (accent-amber on amber-soft) | 2.99:1 | 7.05:1 |
 * | `destructive` (white on accent-red) | 4.83:1 | 3.76:1 |
 * | `secondary` (font-secondary on icon-box) | **8.15:1** | **6.85:1** |
 * | `outline` (font-primary on panel) | **18.42:1** | **15.04:1** |
 *
 * Badge text is `text-xs`, so 4.5:1 applies. That is a defect in the primitive's token
 * pairings rather than in this page, and it is not fixed here: `badgeVariants.ts` is a
 * shared design-system file and repainting six variants belongs in its own change. What
 * this file does is decline to add a new instance of it. The status word carries the
 * meaning, which WCAG 1.4.1 wants regardless of whether the hue is legible.
 */
const STATUS_KEYS: Record<string, string> = {
  generating: 'reports.statusGenerating',
  completed: 'reports.statusCompleted',
  failed: 'reports.statusFailed',
}

/**
 * The same lookup for `type` and `format`, so a row reads the way the create form's
 * dropdown read when it was filled in. Without this the form offers "Summary" and the
 * table then shows `summary` — and in Spanish the form offers "Resumen" and the table
 * still shows `summary`, which looks like the choice was not saved.
 *
 * Both columns are free text on the wire (`CreateReportRequest` validates neither), so an
 * unknown value falls back to the raw string rather than to a missing key.
 */
const TYPE_KEYS: Record<string, string> = {
  summary: 'reports.type_summary',
  detailed: 'reports.type_detailed',
  comparison: 'reports.type_comparison',
  executive: 'reports.type_executive',
}

const FORMAT_KEYS: Record<string, string> = {
  pdf: 'reports.format_pdf',
  excel: 'reports.format_excel',
  csv: 'reports.format_csv',
}

/** `t(key)` when the value is one we ship a label for, otherwise the server's own value. */
function label(
  translate: (key: string) => string,
  keys: Record<string, string>,
  value: string,
): string {
  const key = keys[value]
  return key ? translate(key) : value
}

interface ReportListProps {
  reports: readonly ReportListItem[]
  /** `undefined` while a download is in flight for that id, so the row can disable itself. */
  downloadingId?: string
  onDownload: (report: ReportListItem) => void
  /**
   * Opens the share panel for that report.
   *
   * Offered only for a completed report, on the same rule as Download and for a sharper
   * reason: `GET /shared/reports/{token}` answers its flat 404 for a report that is not
   * `completed` (`ReportShareEndpoints.ResolveAsync`), so a link minted against a generating
   * report is a link that resolves to "not available" — an administrator would forward it and
   * the recipient would see nothing.
   */
  onShare: (report: ReportListItem) => void
}

export default function ReportList({
  reports,
  downloadingId,
  onDownload,
  onShare,
}: ReportListProps) {
  const { t, locale } = useTranslation()

  if (reports.length === 0) {
    return (
      <EmptyState
        title={t('reports.noReports')}
        description={t('reports.noReportsDescription')}
      />
    )
  }

  return (
    // `<Table>` rather than a bare `<table>`: it owns `w-full` and the
    // `overflow-x-auto` container, which the base layer stopped carrying in #218.
    // Six columns overflow a 320px viewport, so the container is what keeps the
    // page itself from scrolling sideways.
    <Table>
      <thead>
        <tr>
          <th>{t('reports.reportTitle')}</th>
          <th>{t('reports.type')}</th>
          <th>{t('reports.format')}</th>
          <th>{t('common.status')}</th>
          <th>{t('reports.createdAt')}</th>
          <th>{t('common.actions')}</th>
        </tr>
      </thead>
      <tbody>
        {reports.map((report) => {
          const isCompleted = report.status === 'completed'
          return (
            <tr key={report.id}>
              <td>{report.title}</td>
              <td>{label(t, TYPE_KEYS, report.type)}</td>
              <td>{label(t, FORMAT_KEYS, report.format)}</td>
              <td>
                <Badge variant="secondary">{label(t, STATUS_KEYS, report.status)}</Badge>
              </td>
              <td>{calendarDay(Date.parse(report.createdAt), locale)}</td>
              <td>
                {/* Only a completed report can be downloaded -- the backend answers
                    400 otherwise. Disabling the button is not belt-and-braces: the
                    alternative is an admin clicking Download on a generating report
                    and being shown a raw validation message they cannot act on.

                    Share is ABSENT rather than disabled for a report that is not
                    completed, which is a deliberate difference from Download. A disabled
                    Download says "not yet"; a disabled Share would advertise a public link
                    for a document that does not exist, on the one row where an admin is
                    most likely to try it. */}
                <div className="flex flex-wrap gap-inline">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!isCompleted || downloadingId === report.id}
                    onClick={() => onDownload(report)}
                  >
                    {t('reports.download')}
                  </Button>
                  {isCompleted && (
                    <Button type="button" variant="outline" onClick={() => onShare(report)}>
                      {t('reports.share')}
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </Table>
  )
}
