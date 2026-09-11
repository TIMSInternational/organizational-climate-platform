import { useState } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { Check, Download, MoreHorizontal, Plus, Shield } from 'lucide-react'
import { useTranslation, type TranslateFn } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { ANONYMITY_FLOOR, KpiTile } from '../../../components/charts'
import {
  Button,
  Chip,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  LoadingRegion,
  NetworkError,
  SkeletonText,
  Table,
  type ChipTone,
} from '../../../components/ui'
import { useViewerCapabilities } from '../../../auth/viewerCapabilities'
import { calendarDay } from '../../../lib/calendarDay'
import { cn } from '../../../lib/cn'
import ReportForm from '../components/ReportForm'
import ReportSchedulePanel from '../components/ReportSchedulePanel'
import ReportShareDialog from './ReportShareDialog'
import {
  commonSurvey,
  companyLinks,
  contentsReading,
  formatsSentence,
  linkReading,
  opensPhrase,
  recurrenceLabel,
  reportFormatLabel,
  reportStatusLabel,
  reportTypeLabel,
  scheduleReading,
} from './derive'
import type { ReportContents, ReportRow } from './model'
import { useReportsListModel } from './useReportsListModel'

// The canvas's `.label` head: 10px bold uppercase spaced .06em, 8px under it, over the
// default hairline — the same head `SurveysListNextPage` draws.
const HEAD =
  'px-3 pt-2 pb-2 text-left text-2xs font-bold uppercase leading-normal tracking-label text-fg-label whitespace-nowrap border-b border-line-default'
/** Every cell after the first: its column's left edge is the canvas's 12px gap. */
const GAP_CELL = 'pl-0'

const STATUS_TONE: Record<string, ChipTone> = {
  completed: 'good',
  generating: 'warning',
  failed: 'critical',
}

/**
 * `/admin/companies/:companyId/reports` — the redesigned Informes, which replaced
 * `pages/ReportsListPage.tsx` on this route (ruled 10 Sep; the old page stays in the tree,
 * unrouted, as the wiring reference), drawn as the ReportsList artboard.
 *
 * Summary first — how many reports, how many open without a login, how many generate
 * themselves — then the reports, each with ONE visible action (Descargar) and the rest in
 * its "···" menu, and the floor stated where a reader decides to send a file out. The share
 * dialog opens from the menu and is addressable as `?share=<id>`, as the benchmarks cohort
 * is as `?cohort=`: a dialog nobody can link to is a dialog nobody can review.
 *
 * Roles, off the seam (`auth/viewerCapabilities.ts`):
 * - `ReportEndpoints.CanAccessCompany` (`ReportEndpoints.cs:69-71`) is, token for token,
 *   the `CanAdminister` predicate `canOpenResults` mirrors — a super_admin for any company,
 *   a company_admin only for the one their claim names — asked about the URL's company. It
 *   gates the list, "Nuevo informe", Descargar and Programar. Anyone else gets a sentence,
 *   and no request is made that could only 403.
 * - `canShareReports` gates the links: the column, the tile and Compartir.
 */
export default function ReportsListNextPage() {
  const { t, locale } = useTranslation()
  const { companyId } = useParams<{ companyId: string }>()
  const capabilities = useViewerCapabilities()
  const mayRead = companyId !== undefined && capabilities.canOpenResults({ companyId })
  const mayShare = mayRead && capabilities.canShareReports
  const state = useReportsListModel(companyId, { mayRead, mayShare })
  const [searchParams, setSearchParams] = useSearchParams()
  const [creating, setCreating] = useState(false)
  const [scheduling, setScheduling] = useState<ReportRow | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  if (!companyId) {
    return <p role="alert">{t('common.noCompanyAssociated')}</p>
  }

  const rows = state.model.rows
  // The report the share dialog is open for: named by the URL, and only a completed one —
  // a link to anything else resolves to nothing (`ReportShareEndpoints.ResolveAsync`).
  const shareId = searchParams.get('share')
  const sharing = mayShare ? (rows.find((row) => row.id === shareId && row.status === 'completed') ?? null) : null

  function setShareParam(id: string | null) {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        if (id === null) next.delete('share')
        else next.set('share', id)
        return next
      },
      { replace: true },
    )
  }

  async function handleDownload(row: ReportRow) {
    setDownloadingId(row.id)
    setNotice(null)
    setActionError(null)
    try {
      const fileName = await state.download(row)
      setNotice(t('reports.downloaded', { title: row.title, fileName }))
    } catch (err) {
      // The server's own refusal, not a generic sentence: a download that does nothing
      // reads as a broken build.
      setActionError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setDownloadingId(null)
    }
  }

  const links = companyLinks(rows)
  const schedule = scheduleReading(rows)
  const survey = commonSurvey(rows)
  const formats = formatsSentence(t, rows)
  const sampleChip = state.model.isSample ? (
    <Chip data-slot="sample-chip" tone="warning" label={t('dashboard.next.sampleChip')} />
  ) : null

  return (
    <div>
      <PageTopBar
        // The artboard's eyebrow is the area the page belongs to, which the nav does not
        // say: Informes sits among the work surfaces in the sidebar, under the company.
        eyebrow={t('navigation.companySettings')}
        title={t('navigation.reports')}
        description={t('reports.next.description')}
        // `/admin/companies/:companyId` is loadable by exactly who can load this page.
        breadcrumbs={[
          { label: t('navigation.companySettings'), href: `/admin/companies/${companyId}` },
          { label: t('navigation.reports') },
        ]}
        actions={
          mayRead ? (
            <Button type="button" variant="primary" onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" />
              {t('reports.newReport')}
            </Button>
          ) : undefined
        }
      />

      {state.status === 'forbidden' ? (
        <EmptyState fill title={t('reports.next.noAccessTitle')} description={t('reports.next.noAccessDescription')} />
      ) : state.status === 'error' ? (
        <NetworkError
          title={t('errors.generic')}
          description={state.error ?? undefined}
          onRetry={state.reload}
          retryText={t('common.retry')}
        />
      ) : (
        <LoadingRegion loading={state.status === 'loading'} label={t('common.loading')}>
          {state.status === 'loading' ? (
            <SkeletonText lines={6} />
          ) : (
            <div className="flex flex-col gap-6">
              {notice && (
                <p role="status" className="m-0 text-sm text-fg-secondary">
                  {notice}
                </p>
              )}
              {actionError && (
                <p role="alert" className="m-0 text-sm text-accent-red-ink">
                  {actionError}
                </p>
              )}

              <div data-slot="reports-tiles" className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <KpiTile
                  size="large"
                  label={t('reports.next.tileReports')}
                  value={rows.length}
                  locale={locale}
                  unit={
                    survey ? (
                      <span className="inline-flex flex-wrap items-center gap-2">
                        {t('reports.next.tileReportsOf', { survey })}
                        {sampleChip}
                      </span>
                    ) : rows.length === 1 ? (
                      t('reports.next.tileReportsUnitOne')
                    ) : (
                      t('reports.next.tileReportsUnit')
                    )
                  }
                  sub={formats ? <span className="text-fg-label">{formats}</span> : undefined}
                />
                <KpiTile
                  size="large"
                  label={t('reports.next.tileLinks')}
                  value={mayShare && links ? links.active : null}
                  locale={locale}
                  unit={
                    mayShare && links
                      ? links.active === 1
                        ? t('reports.next.linksUnitOne')
                        : t('reports.next.linksUnit')
                      : undefined
                  }
                  sub={<LinksTileSub t={t} locale={locale} mayShare={mayShare} links={links} />}
                />
                <KpiTile
                  size="large"
                  label={t('reports.next.tileScheduled')}
                  value={schedule.count}
                  locale={locale}
                  unit={schedule.count === 1 ? t('reports.next.scheduledUnitOne') : t('reports.next.scheduledUnit')}
                  sub={
                    <span className="text-fg-label">
                      {schedule.next
                        ? t('reports.next.scheduledSubNext', { date: calendarDay(Date.parse(schedule.next), locale) })
                        : t('reports.next.scheduledSubNone')}
                    </span>
                  }
                />
              </div>

              {rows.length === 0 ? (
                <EmptyState fill title={t('reports.noReports')} description={t('reports.noReportsDescription')} />
              ) : (
                <section aria-labelledby="reports-generated" className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <div className="flex items-baseline gap-2.5">
                      <h2 id="reports-generated" className="m-0 text-2xl">
                        {t('reports.next.generatedHeading')}
                      </h2>
                      <span className="font-mono text-sm tabular-nums text-fg-label">{rows.length}</span>
                    </div>
                    <p className="m-0 text-sm text-fg-label">
                      {mayShare ? t('reports.next.menuNote') : t('reports.next.menuNoteSchedule')}
                    </p>
                  </div>
                  <div className="overflow-hidden rounded-xl border border-line-default bg-surface-card shadow-xs">
                    {/* The canvas's grid, `minmax(0,1fr) 300px 70px 110px 130px 150px` with 12px
                        between columns, from xl. A table has no column gap, so each fixed column
                        carries the gap before it (+12px) and its cells drop their left padding.
                        Narrower than xl the columns tighten and the table scrolls inside this
                        card rather than pushing the page. */}
                    <Table className="min-w-230 table-fixed">
                      <colgroup>
                        <col />
                        <col className="w-60 xl:w-78" />
                        <col className="w-19 xl:w-20.5" />
                        <col className="w-30.5" />
                        <col className="w-33 xl:w-35.5" />
                        <col className="w-40.5" />
                      </colgroup>
                      <thead>
                        <tr className="border-b border-line-default">
                          <th className={HEAD}>{t('reports.next.colReport')}</th>
                          <th className={cn(HEAD, GAP_CELL)}>
                            <span className="inline-flex items-center gap-2">
                              {t('reports.next.colContains')}
                              {sampleChip}
                            </span>
                          </th>
                          <th className={cn(HEAD, GAP_CELL)}>{t('reports.format')}</th>
                          <th className={cn(HEAD, GAP_CELL)}>{t('common.status')}</th>
                          <th className={cn(HEAD, GAP_CELL)}>{t('reports.next.colLinks')}</th>
                          <th className={cn(HEAD, GAP_CELL)}>
                            <span className="sr-only">{t('common.actions')}</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <ReportTableRow
                            key={row.id}
                            row={row}
                            t={t}
                            locale={locale}
                            mayShare={mayShare}
                            downloading={downloadingId === row.id}
                            onDownload={() => void handleDownload(row)}
                            onShare={() => setShareParam(row.id)}
                            onSchedule={() => setScheduling(row)}
                          />
                        ))}
                      </tbody>
                    </Table>
                  </div>
                </section>
              )}

              <p
                data-slot="floor-note"
                className="m-0 flex items-start gap-2.5 rounded-lg bg-surface-icon-box px-3.5 py-3 text-sm text-fg-secondary"
              >
                <Shield aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                <span>{t('reports.next.floorNote', { floor: ANONYMITY_FLOOR })}</span>
              </p>
            </div>
          )}
        </LoadingRegion>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent closeLabel={t('common.close')} className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-2xl font-normal">{t('reports.newReport')}</DialogTitle>
            <DialogDescription>{t('reports.next.newReportDescription', { floor: ANONYMITY_FLOOR })}</DialogDescription>
          </DialogHeader>
          <ReportForm
            onSubmit={async (values) => {
              await state.create(values)
              setCreating(false)
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Mounted only while a report is selected, as the old page did, so the panel resets
          from the row on every opening. */}
      {scheduling && (
        <ReportSchedulePanel
          open
          onOpenChange={(next) => {
            if (!next) setScheduling(null)
          }}
          baseUrl={import.meta.env.VITE_API_BASE_URL as string}
          report={{ ...scheduling, companyId }}
          onSaved={state.applySchedule}
        />
      )}

      {sharing && (
        <ReportShareDialog
          open
          onOpenChange={(next) => {
            if (!next) setShareParam(null)
          }}
          baseUrl={import.meta.env.VITE_API_BASE_URL as string}
          report={sharing}
          onSharesChange={(next) => state.setShares(sharing.id, next)}
        />
      )}
    </div>
  )
}

function LinksTileSub({
  t,
  locale,
  mayShare,
  links,
}: {
  t: TranslateFn
  locale: string
  mayShare: boolean
  links: ReturnType<typeof companyLinks>
}) {
  if (!mayShare) return <span className="text-fg-label">{t('reports.next.linksHidden')}</span>
  if (links === null) return <span className="text-fg-label">{t('reports.next.linksUnread')}</span>
  if (links.active === 0 || links.firstExpiry === null) {
    return <span className="text-fg-label">{t('reports.next.linksSubNone')}</span>
  }
  const date = calendarDay(Date.parse(links.firstExpiry), locale)
  // Amber: a link that opens without a password is the one thing on this screen a reader
  // should re-check before forwarding, and the sentence says so in words too.
  return (
    <span data-slot="links-warning" className="text-accent-amber-ink">
      {links.active === 1 ? t('reports.next.linksSubOne', { date }) : t('reports.next.linksSubMany', { date })}
    </span>
  )
}

function ReportTableRow({
  row,
  t,
  locale,
  mayShare,
  downloading,
  onDownload,
  onShare,
  onSchedule,
}: {
  row: ReportRow
  t: TranslateFn
  locale: string
  mayShare: boolean
  downloading: boolean
  onDownload: () => void
  onShare: () => void
  onSchedule: () => void
}) {
  const completed = row.status === 'completed'
  const schedule =
    row.isRecurring && row.recurrencePattern
      ? row.nextGeneration
        ? t('reports.next.scheduleNext', {
            pattern: recurrenceLabel(t, row.recurrencePattern),
            date: calendarDay(Date.parse(row.nextGeneration), locale),
          })
        : recurrenceLabel(t, row.recurrencePattern)
      : t('reports.scheduleNotRecurring')
  const meta = t('reports.next.rowMeta', {
    type: reportTypeLabel(t, row.type),
    date: calendarDay(Date.parse(row.createdAt), locale),
    schedule,
  })
  const links = linkReading(row.shares)
  const canShareRow = mayShare && completed

  return (
    <tr data-report-id={row.id} data-status={row.status} className="border-b border-line-light last:border-b-0">
      <td className="px-3 py-3.5">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-base font-semibold text-fg-primary">{row.title}</span>
          <span data-slot="report-meta" className="truncate text-xs leading-normal text-fg-light">
            {meta}
          </span>
        </div>
      </td>
      <td className="py-3.5 pr-3">
        {row.contents ? <ContentsCell contents={row.contents} t={t} /> : null}
      </td>
      <td className="py-3.5 pr-3">
        <Chip tone="neutral" label={reportFormatLabel(t, row.format)} className="w-full justify-start" />
      </td>
      <td className="py-3.5 pr-3">
        <Chip
          tone={STATUS_TONE[row.status] ?? 'neutral'}
          label={reportStatusLabel(t, row.status)}
          icon={completed ? <Check strokeWidth={2.25} /> : undefined}
          className="w-full justify-start"
        />
      </td>
      <td data-slot="report-links" className="py-3.5 pr-3">
        {links === null ? (
          <span className="text-sm text-fg-light">{mayShare && completed ? t('reports.next.linksNotRead') : t('reports.next.linksNone')}</span>
        ) : links.active === 0 || links.firstExpiry === null ? (
          <span className="text-sm text-fg-light">{t('reports.next.linksNone')}</span>
        ) : (
          <span className="flex flex-col">
            <span className="text-base text-fg-primary">
              {links.active === 1
                ? t('reports.next.linksActiveOne')
                : t('reports.next.linksActiveMany', { count: links.active })}
            </span>
            <span className="text-xs leading-normal text-fg-light">
              {t('reports.next.linksExpiry', {
                date: calendarDay(Date.parse(links.firstExpiry), locale),
                opens: opensPhrase(t, links.opens),
              })}
            </span>
          </span>
        )}
      </td>
      <td className="py-3.5 pr-3">
        <div className="flex items-center justify-end gap-2">
          {/* The one visible action. Disabled, not hidden, for a report still generating:
              the server answers 400 until it is completed, and "not yet" is the truth. */}
          <Button type="button" variant="outline" disabled={!completed || downloading} onClick={onDownload}>
            <Download aria-hidden="true" />
            {t('reports.download')}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                data-slot="row-menu"
                aria-label={t('reports.next.moreActions', { title: row.title })}
              >
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {/* Share is absent, not disabled, for a report that is not completed: a
                  disabled Share would advertise a public link to a document that does not
                  exist. */}
              {canShareRow && <DropdownMenuItem onSelect={onShare}>{t('reports.share')}</DropdownMenuItem>}
              <DropdownMenuItem onSelect={onSchedule}>{t('reports.schedule')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </td>
    </tr>
  )
}

function ContentsCell({ contents, t }: { contents: ReportContents; t: TranslateFn }) {
  const reading = contentsReading(contents)
  const protectedLine =
    reading.protectedGroups.length === 0
      ? null
      : reading.protectedGroups.length === 1
        ? t('reports.next.containsProtectedOne', { group: reading.protectedGroups[0] })
        : t('reports.next.containsProtectedMany', { count: reading.protectedGroups.length })
  return (
    <div data-slot="report-contents" className="flex flex-col gap-0.5 text-sm text-fg-secondary">
      <span>
        {reading.suppressed
          ? t('reports.next.containsSurveySuppressed', { survey: contents.surveyName })
          : t('reports.next.containsSurvey', { survey: contents.surveyName, responses: contents.responses })}
      </span>
      {!reading.suppressed && reading.total > 0 && (
        <span>
          {[t('reports.next.containsGroups', { shown: reading.shown, total: reading.total }), protectedLine]
            .filter((part): part is string => part !== null)
            .join(' · ')}
        </span>
      )}
      <span className="inline-flex items-center gap-1 text-fg-label">
        <Shield aria-hidden="true" className="size-3 shrink-0" />
        {t('reports.next.containsFloor', { floor: contents.floor })}
      </span>
    </div>
  )
}
