import { useSyncExternalStore } from 'react'
import { Link } from 'react-router'
import { ChevronDown, MoreHorizontal, Plus, Search } from 'lucide-react'
import { useTranslation, type TranslateFn } from '../../../../i18n'
import { PageHeader } from '../../../../components/layout'
import {
  Alert,
  AlertDescription,
  Button,
  Chip,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  LoadingRegion,
  NetworkError,
  SegmentedControl,
  SkeletonText,
  Table,
  TableHead,
} from '../../../../components/ui'
import { useViewerCapabilities, type ViewerCapabilities } from '../../../../auth/viewerCapabilities'
import { StatusWorkbookButton } from '../StatusWorkbookButton'
import { formatMetric } from '../../../../components/charts/formatMetric'
import { calendarDay, calendarDayOf, todayCalendarDay } from '../../../../lib/calendarDay'
import { cn } from '../../../../lib/cn'
import { daysBetween, percentReading, printedMove, signedReading } from '../../../dashboard/next/derive'
import { useResultBands } from '../../../result-bands/useResultBands'
import { statusLabel, typeLabel } from '../../surveyVocabulary'
import { surveyResponseReading } from '../../surveyListView'
import {
  closedSummary,
  groupBySection,
  menuItemsFor,
  primaryActionFor,
  sectionOf,
  visibleFacets,
  type PrimaryActionKind,
} from './derive'
import type { SurveyRow, SurveySection, WaveReading } from './model'
import { useSurveysListModel } from './useSurveysListModel'
import { readViewerClaims } from '../../../../auth/viewerCapabilities'
import SuperSurveysListView from '../super/SuperSurveysListView'
import { byCount } from '../../../../i18n/plural'

const ACTION_KEY: Record<PrimaryActionKind, string> = {
  distribution: 'surveys.distribution.title',
  results: 'surveys.results',
  open: 'surveys.open',
}

/**
 * Below Tailwind's `sm` (640px) the six columns do not fit a phone, and a table that scrolls
 * sideways hides the reading and the row's actions behind a gesture nothing suggests
 * (HIG `layout.md` > "Best practices": adapt the layout to the width, don't make people
 * scroll to find content). There each survey becomes a two-line row instead. Rendered by
 * the query rather than by CSS so the tree holds ONE copy of every link and menu, not a
 * hidden second one a screen reader or a test would also find.
 */
// Exactly what Tailwind's `max-sm:` variant compiles to (`--breakpoint-sm` is 40rem), rather
// than a pixel value copied by hand from it.
const COMPACT_QUERY = '(width < 40rem)'

function subscribeCompact(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const query = window.matchMedia(COMPACT_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function readCompact(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(COMPACT_QUERY).matches
}

function useCompactWidth(): boolean {
  return useSyncExternalStore(subscribeCompact, readCompact, () => false)
}

const SECTION_KEY: Record<SurveySection, string> = {
  open: 'surveys.next.list.openHeading',
  upcoming: 'surveys.next.list.upcomingHeading',
  closed: 'surveys.next.list.closedHeading',
  archived: 'surveys.next.list.archivedHeading',
}

/** The chip row's plural labels, as the canvas draws them: "Activas · 1", not "Activa · 1". */
const FACET_KEY: Record<string, string> = {
  '': 'surveys.next.list.facetAll',
  draft: 'surveys.next.list.facetDraft',
  scheduled: 'surveys.next.list.facetScheduled',
  active: 'surveys.next.list.facetActive',
  closed: 'surveys.next.list.facetClosed',
  archived: 'surveys.next.list.facetArchived',
}

// The column head is the `TableHead` primitive — the Apple board's `.tbl th`: 13px semibold in the
// tertiary ink, sentence case, never the 11px uppercase that the type ruling keeps for eyebrows.
// Its rule is the default hairline (`index.css` rules every bare th in the light one, and a
// cell's rule wins over its row's), in a 15px line box.
const HEAD = 'leading-normal border-b border-line-default'
/** Every cell after the first, from xl: its column's left edge is the canvas's gap. */
const GAP_CELL = 'xl:pl-0'

/** "Encuesta periódica": the type in sentence case, as a meta line reads. */
function sentenceCase(text: string, locale: string): string {
  return text.length === 0 ? text : text.charAt(0) + text.slice(1).toLocaleLowerCase(locale)
}

/**
 * `/surveys` — the redesigned Todas las Encuestas, which replaced `SurveysListPage` on
 * this route (the old page stays in the tree, unrouted, as the wiring reference), drawn
 * as the SurveysList artboard.
 *
 * Same request and same scoping as `SurveysListPage` (`useSurveysListModel`); what
 * changes is the reading: the open survey first, then what is coming, then what closed
 * newest-first with each wave's climate move under its date, and the archived rows last
 * and demoted; one primary action per row and a "···" menu for the rest, by status and
 * by what the viewer may do (`derive.ts`); "no invitation list" where the old table
 * printed an em dash; every filter in one row, the status filter as pills.
 *
 * Roles: `canAuthorSurveys` draws "New survey", the Distribution action and Duplicate;
 * `canOpenResults(row)` draws Results — a `company_admin` for their own tenant's rows,
 * a `super_admin` for any. A leader gets the list the server scopes for them, with
 * "Open" as the one action, which is what today's list already offers them, and no
 * climate moves: `GET /surveys/climate-trends` would answer them 403.
 */
export default function SurveysListNextPage() {
  // The per-role canvas (10 Sep): the super administrator's platform-wide list is its own view,
  // `../super/SuperSurveysListView` — an Empresa column and a company filter over the same
  // `GET /surveys` — read off the claim, as the tenant pages dispatch. Everyone else keeps this page.
  return readViewerClaims().role === 'super_admin' ? <SuperSurveysListView /> : <SurveysListForCompany />
}

function SurveysListForCompany() {
  const { t, locale } = useTranslation()
  const capabilities = useViewerCapabilities()
  const state = useSurveysListModel()
  const companyId = readViewerClaims().companyId
  const sections = groupBySection(state.visible)
  const facets = [{ status: '', count: state.model.rows.length }, ...visibleFacets(state.facets, state.statusFilter)]

  return (
    <div>
      {/* The board's `.hdr`: the company as the eyebrow, the serif title, the sub, the
          secondary actions bordered and ONE primary — Nueva encuesta — at the trailing edge. */}
      <PageHeader
        eyebrow={state.model.companyName}
        title={t('navigation.surveys')}
        description={t('surveys.next.list.description')}
        actions={
          capabilities.canAuthorSurveys ? (
            <>
              {companyId && (
                <StatusWorkbookButton
                  companyId={companyId}
                  companyName={state.model.companyName ?? ''}
                  baseUrl={import.meta.env.VITE_API_BASE_URL as string}
                  label={t('surveys.next.list.statusExport')}
                />
              )}
              <Button asChild variant="outline">
                <Link to="/surveys/import">{t('climateWorkbook.title')}</Link>
              </Button>
            </>
          ) : undefined
        }
        primaryAction={
          capabilities.canAuthorSurveys ? (
            <Button asChild variant="primary">
              <Link to="/surveys/new">
                <Plus aria-hidden="true" />
                {t('surveys.newSurvey')}
              </Link>
            </Button>
          ) : undefined
        }
      />

      <form
        role="search"
        data-slot="list-filters"
        className="mb-6 flex flex-wrap items-center gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          state.apply()
        }}
      >
        {/* The board's `.seg`: the status filter as one segmented control, its segments only
            the statuses this company has (`visibleFacets`) — no "Borradores · 0". It filters
            the rows already read; it never sends a request. One line at every width (HIG
            `segmented-controls.md`): at 390 it scrolls inside its own box instead of wrapping,
            and the 4px pad keeps the 3px focus ring inside the scroller. */}
        <div data-slot="segment-scroller" className="-m-1 min-w-0 max-w-[calc(100%+--spacing(2))] overflow-x-auto p-1 [scrollbar-width:none]">
        <SegmentedControl
          label={t('surveys.filterByStatus')}
          value={state.statusFilter}
          onChange={state.setStatusFilter}
          options={facets.map((facet) => ({
            value: facet.status,
            label: t('surveys.next.list.chipCount', {
              label: FACET_KEY[facet.status] ? t(FACET_KEY[facet.status]) : statusLabel(t, facet.status),
              count: facet.count,
            }),
          }))}
        />
        </div>
        <p className="m-0 text-sm text-fg-secondary tabular-nums sm:ml-auto">
          {t('surveys.next.list.countSummary', { count: state.model.rows.length })}
        </p>
        <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
          <div className="relative w-full sm:w-75">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-label"
            />
            <Input
              type="search"
              aria-label={t('surveys.next.list.searchPlaceholder')}
              placeholder={t('surveys.next.list.searchPlaceholder')}
              value={state.draft.q}
              onChange={(event) => state.setDraft({ ...state.draft, q: event.target.value })}
              // The artboard's 32px filter row (`h-control-lg`), the select's height beside it:
              // one control height on the bar (the review of 12 Nov). Touch keeps the primitive's 44.
              className="h-control-lg pl-8"
            />
          </div>
          {/* A native <select> (ui/select.tsx says to prefer one for a plain list), with no
              platform arrow and the board's thin 14px chevron. `mt-0 block`: `index.css` gives a
              select in a label 4px above it, and an inline one sits on the label's baseline. */}
          <label className="relative mb-0 w-full sm:w-42.5">
            <span className="sr-only">{t('surveys.typeLabel')}</span>
            <ChevronDown
              aria-hidden="true"
              data-slot="type-chevron"
              className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-label"
            />
            <select
              className="mt-0 block w-full appearance-none pr-8"
              value={state.draft.type}
              onChange={(event) => state.apply({ ...state.draft, type: event.target.value })}
            >
              <option value="">{t('surveys.next.list.allTypes')}</option>
              {state.availableTypes.map((type) => (
                <option key={type} value={type}>
                  {typeLabel(t, type)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </form>

      {state.actionError && (
        <Alert variant="destructive" role="alert" className="mb-6">
          <AlertDescription>{state.actionError}</AlertDescription>
        </Alert>
      )}

      {state.status === 'error' ? (
        <NetworkError
          title={t('errors.loadFailed')}
          description={state.error ?? undefined}
          onRetry={state.reload}
          retryText={t('common.retry')}
        />
      ) : (
        <LoadingRegion loading={state.status === 'loading'} label={t('common.loading')}>
          {state.status === 'loading' ? (
            <SkeletonText lines={4} />
          ) : sections.length === 0 ? (
            <EmptyState fill title={t('surveys.noSurveysFound')} description={t('surveys.tryAdjustingFilters')} />
          ) : (
            <div className="flex flex-col gap-section">
              {sections.map(({ section, rows }) => (
                <SurveySectionBlock
                  key={section}
                  section={section}
                  rows={rows}
                  readings={state.model.readings}
                  capabilities={capabilities}
                  onDuplicate={state.duplicate}
                  duplicating={state.duplicating}
                  t={t}
                  locale={locale}
                />
              ))}
            </div>
          )}
        </LoadingRegion>
      )}
    </div>
  )
}

function SurveySectionBlock({
  section,
  rows,
  readings,
  capabilities,
  onDuplicate,
  duplicating,
  t,
  locale,
}: {
  section: SurveySection
  rows: SurveyRow[]
  readings: ReadonlyMap<string, WaveReading>
  capabilities: ViewerCapabilities
  onDuplicate: (id: string) => void
  duplicating: string | null
  t: TranslateFn
  locale: string
}) {
  const archived = section === 'archived'
  const compact = useCompactWidth()
  const summary = section === 'closed' ? closedSummary(rows, readings) : null
  const note =
    section === 'open'
      ? t('surveys.next.list.openNote')
      : summary
        ? [
            ...(summary.each !== null ? [t('surveys.next.list.closedNoteEach', { count: summary.each })] : []),
            ...(summary.completion !== null
              ? [t('surveys.next.list.closedNoteCompletion', { percent: percentReading(summary.completion, locale) })]
              : []),
          ].join(' · ')
        : null

  return (
    <section
      aria-labelledby={`surveys-next-${section}`}
      data-section={section}
      data-demoted={archived ? 'true' : 'false'}
      className={cn('flex flex-col', archived ? 'gap-2.5' : 'gap-3')}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <h2
            id={`surveys-next-${section}`}
            // One section head for every group (the review of 12 Nov): the archived block is
            // told apart by its muted rows and its footnote, not by a heading of another face.
            className="m-0 text-2xl"
          >
            {t(SECTION_KEY[section])}
          </h2>
          <span className="text-sm tabular-nums text-fg-secondary">{rows.length}</span>
        </div>
        {note && <p className="m-0 text-sm text-fg-secondary">{note}</p>}
      </div>
      <div
        className={cn(
          // The board's `.card.flush`: 12px radius, the panel hairline, no shadow.
          'overflow-hidden rounded-xl border border-line-panel bg-surface-card',
          archived && 'border-dashed',
        )}
      >
        {compact ? (
          <ul data-slot="survey-compact-list" className="m-0 list-none p-0">
            {rows.map((row) => (
              <SurveyCompactRow
                key={row.id}
                row={row}
                t={t}
                locale={locale}
                capabilities={capabilities}
                onDuplicate={onDuplicate}
                duplicating={duplicating}
              />
            ))}
          </ul>
        ) : (
        <>
        {/* The canvas's columns from `xl`; below it they tighten and the participation bar
            steps aside for its percentage, so at 1024 the row's actions stay on screen
            instead of behind a horizontal scroll. Narrower than that, the table scrolls
            inside this card and never pushes the page; below `sm` the rows are the compact
            list above instead. */}
        <Table className="min-w-205 table-fixed lg:min-w-180 xl:min-w-240">
          <colgroup>
            <col />
            {/* From xl, the canvas's grid: `minmax(0,1fr) 110px 120px 210px 130px 190px`
                with 12px between columns. A table has no column gap, so each fixed
                column carries the gap before its neighbour (+12px) and its cells drop
                their left padding (`GAP_CELL`): every head and value then starts where
                the artboard starts it (583 / 705 / 837 / 1059 at 1440). */}
            <col className="w-24 xl:w-30.5" />
            <col className="w-26 xl:w-33" />
            <col className="w-30 xl:w-55.5" />
            <col className="w-27.5 xl:w-35.5" />
            <col className="w-40 xl:w-50.5" />
          </colgroup>
          {/* The archived block draws no header row, as the canvas does; the header
              stays in the tree for assistive technology. */}
          <thead className={archived ? 'sr-only' : undefined}>
            <tr className="border-b border-line-default">
              <TableHead className={HEAD}>{t('surveys.next.list.colSurvey')}</TableHead>
              <TableHead className={cn(HEAD, GAP_CELL)}>{t('common.status')}</TableHead>
              <TableHead className={cn(HEAD, GAP_CELL)}>{t('surveys.responses')}</TableHead>
              <TableHead className={cn(HEAD, GAP_CELL)}>{t('surveys.participation')}</TableHead>
              <TableHead className={cn(HEAD, GAP_CELL)}>{t('surveys.next.list.colClose')}</TableHead>
              <TableHead className={cn(HEAD, GAP_CELL, 'text-right')}>
                <span className="sr-only">{t('common.actions')}</span>
              </TableHead>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <SurveyTableRow
                key={row.id}
                row={row}
                reading={readings.get(row.id) ?? null}
                t={t}
                locale={locale}
                capabilities={capabilities}
                onDuplicate={onDuplicate}
                duplicating={duplicating}
              />
            ))}
          </tbody>
        </Table>
        </>
        )}
      </div>
      {archived && <p className="m-0 text-sm text-fg-secondary">{t('surveys.next.list.archivedNote')}</p>}
    </section>
  )
}

function SurveyTableRow({
  row,
  reading: wave,
  t,
  locale,
  capabilities,
  onDuplicate,
  duplicating,
}: {
  row: SurveyRow
  reading: WaveReading | null
  t: TranslateFn
  locale: string
  capabilities: ViewerCapabilities
  onDuplicate: (id: string) => void
  duplicating: string | null
}) {
  const section = sectionOf(row.status)
  // The company's scale for the move; the cached read every banded screen shares. Until it
  // is known the move reads on 1–5, exactly as before the scale existed.
  const scale = useResultBands().bands?.scale ?? 'mean'
  const archived = section === 'archived'
  const name = row.title ?? t('surveys.untitled')
  const counts = surveyResponseReading(row.responseCount, row.targetAudienceCount)
  const action = primaryActionFor(row, capabilities)
  const running = row.status === 'active'
  // Counted from TODAY AS A DAY (`todayCalendarDay`), as the Panel de Control counts:
  // from the instant, a close on 10 Oct read "en 29 días" here at three in the afternoon
  // while the dashboard said "a 30 días del cierre" for the same survey in the same minute.
  const daysLeft = running ? daysBetween(todayCalendarDay(), calendarDayOf(row.endDate)) : null
  const datePhrase =
    section === 'open'
      ? t('surveys.next.list.opened', { date: calendarDay(Date.parse(row.startDate), locale) })
      : section === 'upcoming'
        ? t('surveys.next.list.opens', { date: calendarDay(Date.parse(row.startDate), locale) })
        : archived
          ? // No archive date is on the wire (`SurveyListItem` carries `createdAt`, never an
            // `archivedAt`), so the archived row says when it was made, not when it was put away.
            t('surveys.next.list.createdOn', { date: calendarDay(Date.parse(row.createdAt), locale) })
          : t('surveys.next.list.closedOn', { date: calendarDay(Date.parse(row.endDate), locale) })
  const meta = [
    sentenceCase(typeLabel(t, row.type), locale),
    t(byCount(row.questionCount, 'surveys.reviewQuestionCountOne', 'surveys.reviewQuestionCount'), { count: row.questionCount }),
    datePhrase,
  ].join(' · ')
  const closeLine =
    section === 'open' && daysLeft !== null && daysLeft > 0
      ? t(byCount(daysLeft, 'surveys.next.list.inDaysOne', 'surveys.next.list.inDays'), { count: daysLeft })
      : section === 'closed' && wave
        ? wave.first
          ? t('surveys.next.list.firstReading')
          : wave.delta !== null && wave.previousCode
            ? t('surveys.next.list.vsWave', {
                delta:
                  scale === 'percent' && wave.between
                    ? signedReading(printedMove(wave.between.to, wave.between.from, 2, scale), locale, 2, scale)
                    : signedReading(wave.delta, locale, 2),
                wave: wave.previousCode,
              })
            : null
        : null
  const ink = archived ? 'text-fg-label' : 'text-fg-primary'

  return (
    <tr
      data-survey-id={row.id}
      data-status={row.status}
      className={cn('border-b border-line-light last:border-b-0')}
    >
      <td className="px-3 py-3">
        <div className="flex min-w-0 flex-col">
          <Link
            to={`/surveys/${row.id}`}
            aria-label={t('surveys.openNamed', { title: name })}
            className={cn('truncate text-base font-semibold', ink)}
          >
            {name}
          </Link>
          <span className="truncate text-xs leading-normal text-fg-label">{meta}</span>
        </div>
      </td>
      <td className="px-3 py-3 xl:pl-0">
        {/* The chip hugs its word (22px, 8px padding): a chip is a label, not a field. */}
        <Chip tone={running ? 'live' : 'neutral'} label={statusLabel(t, row.status)} />
      </td>
      <td className="px-3 py-3 xl:pl-0 whitespace-nowrap">
        <span className={cn('text-lg font-semibold tabular-nums', ink)}>{counts.count}</span>
        {section === 'closed' ? (
          <span className="ml-1.5 text-sm text-fg-secondary">{t('surveys.next.list.completedUnit')}</span>
        ) : counts.target !== null ? (
          <span className={cn('ml-1.5 text-sm', archived ? 'text-fg-label' : 'text-fg-secondary')}>
            {t('surveys.next.list.ofAudience', { target: counts.target })}
          </span>
        ) : null}
      </td>
      <td className="px-3 py-3 xl:pl-0">
        {counts.percent === null ? (
          <span data-slot="no-invite-list" className="text-sm text-fg-label">
            {archived && counts.count === 0 ? t('surveys.next.list.noSubmissions') : t('surveys.next.list.noInviteList')}
          </span>
        ) : archived ? (
          <span className="text-sm tabular-nums text-fg-secondary">
            {formatMetric(counts.percent, { kind: 'percentage' }, locale)}
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <span aria-hidden="true" className="hidden h-1.5 w-27.5 shrink-0 overflow-hidden rounded-full bg-surface-fill xl:block">
              <span
                className="block h-full rounded-full bg-accent-blue"
                style={{ width: `${Math.min(counts.percent, 100)}%` }}
              />
            </span>
            <span className="text-sm tabular-nums text-fg-secondary">
              {formatMetric(counts.percent, { kind: 'percentage' }, locale)}
            </span>
          </span>
        )}
      </td>
      <td className="px-3 py-3 xl:pl-0 whitespace-nowrap">
        {archived ? (
          <span aria-hidden="true" className="text-base text-fg-label">
            —
          </span>
        ) : (
          <span className="flex flex-col">
            <span className="text-base tabular-nums text-fg-primary">
              {calendarDay(Date.parse(row.endDate), locale)}
            </span>
            {closeLine && (
              <span data-slot={section === 'closed' ? 'wave-move' : 'close-note'} className="text-xs leading-normal text-fg-label">
                {closeLine}
              </span>
            )}
          </span>
        )}
      </td>
      <td className="px-3 py-3 xl:pl-0">
        <div className="flex items-center justify-end gap-2">
          {action && (
            <Button asChild variant="outline">
              <Link to={action.to} data-action={action.kind} aria-label={`${t(ACTION_KEY[action.kind])}: ${name}`}>
                {t(ACTION_KEY[action.kind])}
              </Link>
            </Button>
          )}
          <RowMenu
            row={row}
            name={name}
            capabilities={capabilities}
            onDuplicate={onDuplicate}
            duplicating={duplicating}
            t={t}
          />
        </div>
      </td>
    </tr>
  )
}

/**
 * One survey at phone width: its name and status chip, then «3 de 24 · 13 % · cierra el
 * 10 oct.», with the row's action and its menu trailing — the same figures the table row
 * prints (`surveyResponseReading`, the same percentage), only set as a line.
 */
function SurveyCompactRow({
  row,
  t,
  locale,
  capabilities,
  onDuplicate,
  duplicating,
}: {
  row: SurveyRow
  t: TranslateFn
  locale: string
  capabilities: ViewerCapabilities
  onDuplicate: (id: string) => void
  duplicating: string | null
}) {
  const section = sectionOf(row.status)
  const archived = section === 'archived'
  const name = row.title ?? t('surveys.untitled')
  const counts = surveyResponseReading(row.responseCount, row.targetAudienceCount)
  const action = primaryActionFor(row, capabilities)
  const running = row.status === 'active'
  const countPhrase =
    section === 'closed'
      ? `${counts.count} ${t('surveys.next.list.completedUnit')}`
      : counts.target !== null
        ? `${counts.count} ${t('surveys.next.list.ofAudience', { target: counts.target })}`
        : String(counts.count)
  const percentPhrase =
    counts.percent === null
      ? archived && counts.count === 0
        ? t('surveys.next.list.noSubmissions')
        : t('surveys.next.list.noInviteList')
      : formatMetric(counts.percent, { kind: 'percentage' }, locale)
  const datePhrase =
    section === 'open'
      ? t('surveys.next.list.closesOn', { date: calendarDay(Date.parse(row.endDate), locale) })
      : section === 'upcoming'
        ? t('surveys.next.list.opens', { date: calendarDay(Date.parse(row.startDate), locale) })
        : archived
          ? t('surveys.next.list.createdOn', { date: calendarDay(Date.parse(row.createdAt), locale) })
          : t('surveys.next.list.closedOn', { date: calendarDay(Date.parse(row.endDate), locale) })

  return (
    <li
      data-survey-id={row.id}
      data-status={row.status}
      className="flex items-center gap-3 border-b border-line-light px-4 py-3 last:border-b-0"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* The name takes the whole first line (beside the actions, it had room for
            «Encues…» once the chip shared it); the chip leads the second. */}
        <Link
          to={`/surveys/${row.id}`}
          aria-label={t('surveys.openNamed', { title: name })}
          className={cn('min-w-0 truncate text-base font-semibold', archived ? 'text-fg-label' : 'text-fg-primary')}
        >
          {name}
        </Link>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Chip tone={running ? 'live' : 'neutral'} label={statusLabel(t, row.status)} className="shrink-0" />
          <span data-slot="compact-reading" className="text-sm tabular-nums text-fg-secondary">
            {[countPhrase, percentPhrase, datePhrase].join(' · ')}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {action && (
          <Button asChild variant="outline">
            <Link to={action.to} data-action={action.kind} aria-label={`${t(ACTION_KEY[action.kind])}: ${name}`}>
              {t(ACTION_KEY[action.kind])}
            </Link>
          </Button>
        )}
        <RowMenu
          row={row}
          name={name}
          capabilities={capabilities}
          onDuplicate={onDuplicate}
          duplicating={duplicating}
          t={t}
        />
      </div>
    </li>
  )
}

function RowMenu({
  row,
  name,
  capabilities,
  onDuplicate,
  duplicating,
  t,
}: {
  row: SurveyRow
  name: string
  capabilities: ViewerCapabilities
  onDuplicate: (id: string) => void
  duplicating: string | null
  t: TranslateFn
}) {
  const items = menuItemsFor(capabilities)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          data-slot="row-menu"
          aria-label={t('surveys.next.list.moreActions', { title: name })}
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.includes('view') && (
          <DropdownMenuItem asChild>
            <Link to={`/surveys/${row.id}`}>{t('surveys.next.list.viewSurvey')}</Link>
          </DropdownMenuItem>
        )}
        {items.includes('duplicate') && (
          <DropdownMenuItem disabled={duplicating !== null} onSelect={() => onDuplicate(row.id)}>
            {t('surveys.duplicate')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
