import { useState } from 'react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui'
import { useTranslation } from '../../../i18n'
import { downloadTextFile } from '../../../lib/downloadTextFile'
import { formatNotificationTimestamp } from '../../notifications/formatTimestamp'
import {
  exportTreatmentLabelPath,
  subjectLinkLabelPath,
  type SubjectAccessExport,
} from '../api/gdpr'

export interface DataAccessPanelProps {
  /** The export that has arrived, or null before one has been requested. */
  subjectExport: SubjectAccessExport | null
  requesting: boolean
  /** The server's own message, or '' when the failure carried none. */
  error: string | null
  onRequest: () => void
}

/**
 * Subject access (GDPR Art. 15), self-service.
 *
 * ## Why a button rather than a fetch on mount
 *
 * `GET /gdpr/access` writes an `audit_logs` row on every call, deliberately: the endpoint's
 * own comment says a subject access export "is a bulk disclosure of one person's data and
 * the fact that it happened is itself the thing an investigation needs". Fetching it when
 * the page mounts would file one of those per page view and turn a meaningful record into
 * noise. The request is also the largest read in the product — one section per table that
 * can hold subject data, records included — and this page exists to show a consent record
 * and an erasure statement as well, neither of which should wait on it.
 *
 * ## Everything stated here comes out of the response
 *
 * The completeness warning renders from `complete`, the stores from `sources`, the caveats
 * from `limitations` and the table list from `sections`. Not one of those sentences is
 * written in this file. That is the property this page needs most: the API already knows
 * that it cannot read `services/tracking-api` and says so in `TrackingUnavailableDetail`,
 * and a page that restated any of it in its own words would be a second copy free to drift
 * from what the code does. The catalogue holds only headings, column names and the words
 * for the two enums.
 *
 * ## The full payload is a download, not a screen
 *
 * `records` carries every mapped column of every row — an account, its answers, its audit
 * trail. Rendering that is neither readable nor what Art. 15(3) asks for ("in a commonly
 * used electronic form"); a summary on screen and the whole document as a file is. The file
 * is written without a byte order mark, because `JSON.parse` throws on one.
 */
export default function DataAccessPanel({
  subjectExport,
  requesting,
  error,
  onRequest,
}: DataAccessPanelProps) {
  const { t, locale } = useTranslation()
  const [showEmpty, setShowEmpty] = useState(false)

  const held = subjectExport?.sections.filter((section) => section.recordCount > 0) ?? []
  const empty = subjectExport?.sections.filter((section) => section.recordCount === 0) ?? []
  const missingSources = subjectExport?.sources.filter((source) => !source.included) ?? []

  function download() {
    if (!subjectExport) return
    // The date, not the instant: a colon is not a legal filename character on Windows.
    const day = subjectExport.generatedAt.slice(0, 10)
    downloadTextFile(
      t('privacy.downloadFileName', { date: day }),
      'application/json',
      JSON.stringify(subjectExport, null, 2),
      { byteOrderMark: false },
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('privacy.accessTitle')}</CardTitle>
        <CardDescription>{t('privacy.accessDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-panel-gap">
        {error !== null && (
          <Alert variant="destructive" role="alert">
            <AlertTitle>{t('privacy.accessError')}</AlertTitle>
            {error && <AlertDescription>{error}</AlertDescription>}
          </Alert>
        )}

        <div className="flex flex-wrap items-center gap-inline">
          <Button type="button" variant="primary" onClick={onRequest} disabled={requesting}>
            {requesting ? t('privacy.accessRequesting') : t('privacy.accessAction')}
          </Button>
          {subjectExport && (
            <Button type="button" onClick={download}>
              {t('privacy.download')}
            </Button>
          )}
        </div>

        {subjectExport && (
          <>
            <p className="text-sm text-fg-tertiary">
              {t('privacy.generatedAt')}{' '}
              {formatNotificationTimestamp(subjectExport.generatedAt, locale)}
            </p>

            {/* Rendered from the flag, never unconditionally. The API returns `false`
                today because it cannot read the tracking service's database — when that
                gap closes this warning disappears on its own rather than becoming a
                sentence nobody remembered to delete. */}
            {!subjectExport.complete && (
              <Alert variant="warning" role="status">
                <AlertTitle>{t('privacy.incompleteTitle')}</AlertTitle>
                <AlertDescription>
                  <p>{t('privacy.incompleteDescription')}</p>
                  <ul className="mt-2 grid gap-1 pl-4 [list-style:disc]">
                    {missingSources.map((source) => (
                      <li key={source.name}>
                        <strong>{source.name}</strong> — {source.detail}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <section className="grid gap-inline">
              <h3 className="text-base font-medium text-fg-primary">
                {t('privacy.sourcesTitle')}
              </h3>
              <ul className="grid gap-2">
                {subjectExport.sources.map((source) => (
                  <li key={source.name} className="flex flex-wrap items-baseline gap-inline">
                    {/* `warning`, not `destructive`: an unreachable store is a gap in
                        the answer, not a failure of the request. */}
                    <Badge variant={source.included ? 'success' : 'warning'}>
                      {source.included ? t('privacy.sourceRead') : t('privacy.sourceNotRead')}
                    </Badge>
                    <span className="text-sm text-fg-primary">{source.name}</span>
                  </li>
                ))}
              </ul>
            </section>

            {/* `min-w-0`, and it is load-bearing. This section is a grid item, and a grid
                item's automatic minimum size is its *content's* min-content width — the six
                columns of `SectionTable`, whose headers are `whitespace-nowrap` and whose
                first cell is an unbreakable table name like `question_responses`. Without
                it the track is sized to that content, the card grows past the viewport, and
                at 390px the right edge of every card on the page — including the page
                title's own description, which is nowhere near the table — is cut off. The
                `overflow-x-auto` on `Table`'s own container does not prevent this: it lets
                the table scroll, but this is the ancestor that must be allowed to be
                narrower than its contents first. Measured before and after: the top bar goes
                from right:361 to right:392 in a 390px viewport. Vitest runs on happy-dom and
                cannot see any of it; a screenshot can. */}
            <section className="grid min-w-0 gap-inline">
              <h3 className="text-base font-medium text-fg-primary">
                {t('privacy.sectionsTitle')}
              </h3>
              <p className="text-sm text-fg-tertiary">{t('privacy.sectionsDescription')}</p>
              <SectionTable sections={held} />
            </section>

            {empty.length > 0 && (
              // `min-w-0` for the same reason as the section above: expanding this reveals a
              // second `SectionTable`, and without it the page widens the moment it opens.
              <section className="grid min-w-0 gap-inline">
                {/* Wrapped so the button shrink-wraps. `Button`'s base is
                    `inline-flex justify-center`, and a bare child of this `grid`
                    stretches to the full column — which rendered the toggle as a line
                    of centred grey text with no control around it at all. Caught in a
                    PNG; the DOM assertions were all green. */}
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-expanded={showEmpty}
                    onClick={() => setShowEmpty((open) => !open)}
                  >
                    {t('privacy.emptyTablesToggle', { count: empty.length })}
                  </Button>
                </div>
                {showEmpty && (
                  <>
                    <p className="text-sm text-fg-tertiary">{t('privacy.emptyTablesNote')}</p>
                    <SectionTable sections={empty} />
                  </>
                )}
              </section>
            )}

            <section className="grid gap-inline">
              <h3 className="text-base font-medium text-fg-primary">
                {t('privacy.limitationsTitle')}
              </h3>
              <p className="text-sm text-fg-tertiary">{t('privacy.limitationsDescription')}</p>
              <ul className="grid gap-2 pl-4 text-sm text-fg-secondary [list-style:disc]">
                {subjectExport.limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            </section>
          </>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * One row per classified table.
 *
 * `link` and `treatment` are integers on the wire, and an integer this build has no word
 * for renders as the integer rather than as a blank cell — the same fallback
 * `ProfileActivityList` gives an unknown audit action, and for the same reason: a
 * compliance surface that silently omits a category it does not recognise is worse than one
 * that shows it untranslated.
 */
function SectionTable({
  sections,
}: {
  sections: SubjectAccessExport['sections']
}) {
  const { t } = useTranslation()

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('privacy.colTable')}</TableHead>
          <TableHead>{t('privacy.colHeld')}</TableHead>
          <TableHead>{t('privacy.colReturned')}</TableHead>
          <TableHead>{t('privacy.colRecords')}</TableHead>
          <TableHead>{t('privacy.colBasis')}</TableHead>
          <TableHead>{t('privacy.colRetention')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sections.map((section) => {
          const linkPath = subjectLinkLabelPath(section.link)
          const treatmentPath = exportTreatmentLabelPath(section.treatment)
          return (
            <TableRow key={section.entity}>
              <TableCell>
                <code className="text-sm">{section.table}</code>
              </TableCell>
              <TableCell>{linkPath === null ? String(section.link) : t(linkPath)}</TableCell>
              <TableCell>
                {treatmentPath === null ? String(section.treatment) : t(treatmentPath)}
              </TableCell>
              <TableCell>{section.recordCount}</TableCell>
              <TableCell className="max-w-[22rem] text-sm">{section.lawfulBasis}</TableCell>
              <TableCell className="max-w-[16rem] text-sm">{section.retention}</TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
