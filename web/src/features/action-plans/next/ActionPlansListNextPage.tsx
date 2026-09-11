import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ChevronDown, ChevronRight, Clock, Ellipsis, Plus, Search } from 'lucide-react'
import { useTranslation, type TranslateFn } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { KpiTile } from '../../../components/charts'
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Chip,
  ConfirmationDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  LoadingRegion,
  NetworkError,
  SkeletonText,
  Table,
} from '../../../components/ui'
import { useCompanyScope } from '../../../company-context'
import { useViewerCapabilities } from '../../../auth/viewerCapabilities'
import { calendarDay } from '../../../lib/calendarDay'
import { cn } from '../../../lib/cn'
import { KpiRow } from '../../dashboard/components/dashboardGrammar'
import { CanvasSelect } from '../../org-structure/next/super/parts'
import SemaforoChip from '../../tracking/components/SemaforoChip'
import { ACTION_PLAN_PRIORITIES, ACTION_PLAN_STATUSES, priorityLabel, statusLabel } from '../actionPlanVocabulary'
import ActionPlanForm from '../components/ActionPlanForm'
import DueTimeline from './DueTimeline'
import {
  applyFilters,
  bindShortWords,
  daysToDue,
  dueTimeline,
  EMPTY_PLAN_FILTERS,
  findingReading,
  groupRows,
  isDueThisMonth,
  isFiltering,
  ownerReading,
  summarize,
  type PlanFilters,
} from './derive'
import type { ActionPlansListModel, PlanGroup, PlanRow } from './model'
import { useActionPlansListModel } from './useActionPlansListModel'

/**
 * The artboard's column header: 10px, bold, uppercase, the label ink, no tint — set at the TOP
 * of its cell, so every heading stands on one line whatever hangs under one of them.
 *
 * Cells pad on the LEFT only, 12px, and the last column on the right too: the artboard's
 * grid is `minmax(0,1fr) 210px 150px 120px 80px 120px` with 12px gaps and 12px at each end,
 * so a column is its content plus the gap before it — 222, 162, 132, 92 and 120 + 24 put the
 * finding, the owner, Vence, Prioridad and the actions exactly where the artboard does.
 *
 * The finding's heading carries the "Datos de muestra" chip the artboard does not draw. Beside
 * the heading it would need 243px (127 of heading, 6 of gap, 110 of chip) of the column's 210,
 * and it ran over "Responsable" (r1); so it hangs UNDER the heading (`HEAD_STACK`). The headings
 * keep the artboard's line and its columns; the header row is one chip taller while the finding
 * is sample-fed, and loses that line the day the finding reaches the payload.
 */
const HEAD = 'h-auto bg-transparent pl-3 pr-0 last:pr-3 pb-2 pt-0 align-top text-2xs font-bold uppercase tracking-label text-fg-label whitespace-nowrap'
/** A heading with the sample chip under it rather than beside it. */
const HEAD_STACK = 'flex flex-col items-start gap-1'
const CELL = 'pl-3 pr-0 last:pr-3 py-3 align-middle'
/** Shown from 1360px, where the finding and the owner have columns of their own. */
const WIDE_ONLY = 'hidden min-[1360px]:table-cell'
/** Shown below 1360px, where the finding and the owner fold into the plan's cell. */
const FOLDED_ONLY = 'min-[1360px]:hidden'

const GROUP_HEADING: Record<PlanGroup, string> = {
  overdue: 'actionPlans.next.groupOverdue',
  inProgress: 'actionPlans.next.groupInProgress',
  notStarted: 'actionPlans.next.groupNotStarted',
  completed: 'actionPlans.next.groupCompleted',
  cancelled: 'actionPlans.next.groupCancelled',
}

const GROUP_NOTE: Record<PlanGroup, string> = {
  overdue: 'actionPlans.next.groupOverdueNote',
  inProgress: 'actionPlans.next.groupInProgressNote',
  notStarted: 'actionPlans.next.groupNotStartedNote',
  completed: 'actionPlans.next.groupCompletedNote',
  cancelled: 'actionPlans.next.groupCancelledNote',
}

const PRIORITY_TONE: Record<string, 'critical' | 'warning' | 'neutral'> = {
  critical: 'critical',
  high: 'warning',
}

/**
 * `/action-plans` — the redesigned Planes de Acción, the ActionPlansList artboard of
 * 10 Sep. It replaced `ActionPlansListPage` on this route; that page stays in the tree,
 * unrouted, as the wiring reference.
 *
 * One question per region: how many are open and what is behind (the tiles), when each
 * is due (the timeline), and then the plans grouped by state — overdue, en marcha, no
 * iniciados, completed — with the cancelled ones collapsed at the bottom instead of
 * sitting among open work.
 *
 * ## Roles, as the server rules them
 *
 * `GET /action-plans` is `CanAccessCompany` (`ActionPlanEndpoints.cs:72`): a
 * `super_admin` for the company they chose, a `company_admin` for their own, nobody else.
 * So a leader, a supervisor or an employee who types the URL is told whose screen this
 * is — never shown a table that 403s. Creating and cancelling are `Roles.Admin` plus
 * `CanAccessCompany` (`:103`, `:300`) — `canCreateActionPlan` in the seam — and are drawn
 * only for that viewer.
 *
 * ## Sample data
 *
 * The originating finding's dimension has no endpoint (see `sampleModel.ts`). Its column
 * and the tile that counts it wear the "Datos de muestra" chip; nothing else on the screen
 * does. The owner is not sample: the entity has no owner, so "Sin asignar" is the reading.
 */
export default function ActionPlansListNextPage() {
  const { t } = useTranslation()
  const scope = useCompanyScope()
  const capabilities = useViewerCapabilities()

  if (scope.status === 'needs-selection') {
    return <EmptyState title={t('companyContext.chooseACompany')} description={t('companyContext.chooseACompanyDescription')} />
  }
  if (scope.status === 'no-company') {
    return <p role="alert">{t('common.noCompanyAssociated')}</p>
  }
  if (!capabilities.seesWholeCompany) {
    return (
      <EmptyState
        fill
        title={t('actionPlans.next.restrictedTitle')}
        description={t('actionPlans.next.restrictedBody')}
        action={
          <Button asChild variant="outline">
            <Link to="/dashboard">{t('actionPlans.next.backToDashboard')}</Link>
          </Button>
        }
      />
    )
  }
  return <ActionPlansListBody />
}

function SampleChip({ t, className }: { t: TranslateFn; className?: string }) {
  return (
    <Chip
      tone="warning"
      label={t('dashboard.next.sampleChip')}
      data-slot="sample-chip"
      className={cn('normal-case tracking-normal', className)}
    />
  )
}

function ActionPlansListBody() {
  const { t, locale } = useTranslation()
  const capabilities = useViewerCapabilities()
  const state = useActionPlansListModel()
  const { model } = state
  const [filters, setFilters] = useState<PlanFilters>(EMPTY_PLAN_FILTERS)
  const [showCreate, setShowCreate] = useState(false)
  const [created, setCreated] = useState<{ id: string; title: string } | null>(null)
  const [cancelTarget, setCancelTarget] = useState<PlanRow | null>(null)
  const [cancelError, setCancelError] = useState<string | null>(null)

  const summary = summarize(model.rows, model.asOf)
  const filtering = isFiltering(filters)
  const groups = groupRows(applyFilters(model.rows, filters), model.asOf)
  const loading = state.status === 'loading' || state.status === 'idle'

  async function confirmCancel() {
    if (!cancelTarget) return
    setCancelError(null)
    try {
      await state.cancelPlan(cancelTarget.id)
      setCancelTarget(null)
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : t('errors.generic'))
    }
  }

  return (
    <div>
      <PageTopBar
        eyebrow={model.companyName}
        title={t('navigation.actionPlans')}
        description={t('actionPlans.next.description')}
        actions={
          capabilities.canCreateActionPlan ? (
            <Button
              type="button"
              variant={showCreate ? 'outline' : 'primary'}
              onClick={() => {
                setCreated(null)
                setShowCreate((open) => !open)
              }}
            >
              {!showCreate && <Plus aria-hidden="true" />}
              {showCreate ? t('common.cancel') : t('actionPlans.next.newPlan')}
            </Button>
          ) : undefined
        }
      />

      {created && (
        <Alert role="status" className="mb-panel-gap">
          <AlertDescription>
            {t('actionPlans.createdSuccess', { title: created.title })}{' '}
            <Link to={`/action-plans/${created.id}`}>{t('common.viewDetails')}</Link>
          </AlertDescription>
        </Alert>
      )}

      {showCreate && (
        <Card className="mb-panel-gap">
          <CardHeader>
            <CardTitle>{t('actionPlans.createActionPlan')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionPlanForm
              templates={[...state.templates]}
              onSubmit={async (values) => {
                const plan = await state.create(values)
                setShowCreate(false)
                setCreated(plan)
              }}
              onCancel={() => setShowCreate(false)}
            />
          </CardContent>
        </Card>
      )}

      {state.status === 'error' ? (
        <NetworkError
          title={t('errors.generic')}
          description={state.error ?? undefined}
          onRetry={state.reload}
          retryText={t('common.retry')}
        />
      ) : (
        <LoadingRegion loading={loading} label={t('common.loading')}>
          {loading ? (
            <SkeletonText lines={6} />
          ) : (
            <div className="flex flex-col gap-section">
              <Tiles model={model} t={t} locale={locale} />
              <TimelineCard model={model} t={t} locale={locale} />
              <Filters filters={filters} onChange={setFilters} summary={summary} t={t} />

              {(['overdue', 'inProgress', 'notStarted', 'completed'] as const).map((group) => {
                const rows = groups[group]
                // En marcha and No iniciados are the screen's spine and always stand, with
                // a sentence when empty; overdue and completed appear only when they hold
                // something, and any group empties out of the way while a filter is on.
                const standing = !filtering && (group === 'inProgress' || group === 'notStarted')
                if (rows.length === 0 && !standing) return null
                return (
                  <GroupSection
                    key={group}
                    group={group}
                    rows={rows}
                    model={model}
                    t={t}
                    locale={locale}
                    canManage={capabilities.canCreateActionPlan}
                    onCancel={(row) => {
                      setCancelError(null)
                      setCancelTarget(row)
                    }}
                  />
                )
              })}

              {groups.cancelled.length > 0 && (
                <CancelledGroup
                  rows={groups.cancelled}
                  model={model}
                  t={t}
                  locale={locale}
                  startOpen={filters.status === 'cancelled'}
                />
              )}
            </div>
          )}
        </LoadingRegion>
      )}

      <ConfirmationDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null)
        }}
        title={t('actionPlans.next.cancelTitle')}
        description={
          cancelError ?? t('actionPlans.next.cancelBody', { title: cancelTarget?.name ?? '' })
        }
        confirmText={t('actionPlans.next.cancelConfirm')}
        cancelText={t('common.cancel')}
        onConfirm={() => void confirmCancel()}
      />
    </div>
  )
}

function joinNames(names: readonly string[], locale: string): string {
  return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(names)
}

function dimensionName(t: TranslateFn, key: string): string {
  const messageKey = `surveyRespond.dimensions.${key}`
  const text = t(messageKey)
  return text === messageKey ? key : text
}

function Tiles({ model, t, locale }: { model: ActionPlansListModel; t: TranslateFn; locale: string }) {
  const summary = summarize(model.rows, model.asOf)
  const finding = findingReading(model.rows)
  const owner = ownerReading(model.rows)
  const { overdue } = model

  const dueThisMonth =
    summary.dueThisMonth === 0
      ? t('actionPlans.next.noneDueThisMonth')
      : summary.dueThisMonth === 1
        ? t('actionPlans.next.dueThisMonthOne')
        : t('actionPlans.next.dueThisMonthMany', { count: summary.dueThisMonth })
  const progress =
    summary.withProgress === 0
      ? t('actionPlans.next.noneWithProgress')
      : t('actionPlans.next.withProgress', { count: summary.withProgress })

  return (
    <KpiRow>
      <KpiTile
        label={t('actionPlans.next.tileOpen')}
        value={summary.open}
        locale={locale}
        unit={summary.open === 1 ? t('actionPlans.next.unitPlan') : t('actionPlans.next.unitPlans')}
        sub={
          <span className={cn(summary.dueThisMonth > 0 ? 'text-accent-red' : 'text-fg-secondary')}>
            {t('actionPlans.next.joined', { first: dueThisMonth, second: progress })}
          </span>
        }
      />
      <KpiTile
        label={t('actionPlans.next.tileFinding')}
        value={finding.withFinding}
        locale={locale}
        unit={t('actionPlans.next.ofTotal', { total: finding.open })}
        valueAside={model.findingsAreSample ? <SampleChip t={t} /> : undefined}
        sub={
          <span className="text-fg-label">
            {finding.dimensionKeys.length > 0
              ? finding.dimensionKeys.map((key) => dimensionName(t, key)).join(', ')
              : t('actionPlans.next.noFindings')}
          </span>
        }
      />
      <KpiTile
        label={t('actionPlans.next.tileOwner')}
        value={owner.unassigned}
        locale={locale}
        unit={t('actionPlans.next.ofTotal', { total: owner.open })}
        sub={
          <span className={owner.unassigned > 0 ? 'text-accent-amber-ink' : 'text-fg-label'}>
            {owner.unassigned > 0 ? t('actionPlans.next.ownerSub') : t('actionPlans.next.ownerAllAssigned')}
          </span>
        }
      />
      <KpiTile
        label={t('actionPlans.next.tileTracking')}
        value={overdue.count}
        locale={locale}
        unit={overdue.count === 1 ? t('actionPlans.next.overdueOne') : t('actionPlans.next.overdueMany')}
        aside={
          // The semáforo's own chip — the seguimiento's Rojo, drawn as the tracking screens draw it.
          overdue.count > 0 ? <SemaforoChip estado="Rojo" /> : undefined
        }
        sub={
          overdue.first ? (
            <span
              // One line, as the artboard's tile reads ("Finanzas · Reponer la reunión de
              // handover"): the line wraps at word boundaries and the tile shows its first line
              // only, so the plan's title stops after the last WHOLE word the tile has room for —
              // never "handove…", and never on a short word ("de", "la": `bindShortWords`). The
              // whole of it is in `title`, and a screen reader reads it all.
              className="block min-w-0 max-h-[1lh] overflow-hidden whitespace-normal text-accent-red"
              data-slot="seguimiento-first"
              data-source={overdue.source}
              title={overdue.first.placeName ? `${overdue.first.placeName} · ${overdue.first.name}` : overdue.first.name}
            >
              {overdue.first.placeName
                ? t('actionPlans.next.overdueFirst', { place: overdue.first.placeName, name: bindShortWords(overdue.first.name) })
                : bindShortWords(overdue.first.name)}
            </span>
          ) : (
            <span className="text-fg-label" data-source={overdue.source}>
              {t('actionPlans.next.noneOverdue')}
            </span>
          )
        }
      />
    </KpiRow>
  )
}

function TimelineCard({ model, t, locale }: { model: ActionPlansListModel; t: TranslateFn; locale: string }) {
  const timeline = dueTimeline(model.rows, model.asOf)
  const last = timeline.points[timeline.points.length - 1]
  return (
    <section
      aria-labelledby="plans-timeline"
      className="flex flex-col gap-3 rounded-lg border border-line-default bg-surface-card px-5 pb-2.5 pt-3.5 shadow-sm"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="plans-timeline" className="m-0">
          {t('actionPlans.next.timelineHeading')}
        </h2>
        <span className="text-xs text-fg-label">
          {last
            ? timeline.firstAhead !== null
              ? t('actionPlans.next.timelineRange', {
                  from: calendarDay(Date.parse(model.asOf), locale),
                  to: calendarDay(Date.parse(last.dueDate), locale),
                  days: timeline.firstAhead,
                })
              : t('actionPlans.next.timelineRangeNoneAhead', {
                  from: calendarDay(Date.parse(model.asOf), locale),
                  to: calendarDay(Date.parse(last.dueDate), locale),
                })
            : t('actionPlans.next.timelineEmpty')}
        </span>
      </div>
      {timeline.points.length > 0 && <DueTimeline timeline={timeline} asOf={model.asOf} locale={locale} t={t} />}
    </section>
  )
}

function Filters({
  filters,
  onChange,
  summary,
  t,
}: {
  filters: PlanFilters
  onChange: (next: PlanFilters) => void
  summary: ReturnType<typeof summarize>
  t: TranslateFn
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative w-full sm:w-70">
        <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-label" />
        <Input
          type="search"
          aria-label={t('actionPlans.next.searchPlaceholder')}
          placeholder={t('actionPlans.next.searchPlaceholder')}
          value={filters.q}
          onChange={(event) => onChange({ ...filters, q: event.target.value })}
          className="pl-8"
        />
      </div>
      <CanvasSelect
        aria-label={t('actionPlans.next.statusFilter')}
        value={filters.status}
        onChange={(event) => onChange({ ...filters, status: event.target.value })}
        className="w-full sm:w-[170px]"
      >
        <option value="">{t('actionPlans.next.allStates')}</option>
        {ACTION_PLAN_STATUSES.map((status) => (
          <option key={status} value={status}>
            {statusLabel(t, status)}
          </option>
        ))}
      </CanvasSelect>
      <CanvasSelect
        aria-label={t('actionPlans.next.priorityFilter')}
        value={filters.priority}
        onChange={(event) => onChange({ ...filters, priority: event.target.value })}
        className="w-full sm:w-[180px]"
      >
        <option value="">{t('actionPlans.allPriorities')}</option>
        {ACTION_PLAN_PRIORITIES.map((priority) => (
          <option key={priority} value={priority}>
            {priorityLabel(t, priority)}
          </option>
        ))}
      </CanvasSelect>
      <p className="m-0 ml-auto text-xs text-fg-label">
        {t('actionPlans.next.countSummary', { total: summary.total, open: summary.open, cancelled: summary.cancelled })}
      </p>
    </div>
  )
}

function GroupSection({
  group,
  rows,
  model,
  t,
  locale,
  canManage,
  onCancel,
}: {
  group: PlanGroup
  rows: readonly PlanRow[]
  model: ActionPlansListModel
  t: TranslateFn
  locale: string
  canManage: boolean
  onCancel: (row: PlanRow) => void
}) {
  const headingId = `plans-group-${group}`
  return (
    <section aria-labelledby={headingId} data-group={group} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <h2 id={headingId} className="m-0">
            {t(GROUP_HEADING[group])}
          </h2>
          <span className="font-mono text-xs text-fg-label tabular-nums">{rows.length}</span>
        </div>
        <p className="m-0 text-xs text-fg-label">{t(GROUP_NOTE[group])}</p>
      </div>
      <PlanTable
        rows={rows}
        model={model}
        t={t}
        locale={locale}
        canManage={canManage}
        onCancel={onCancel}
        empty={group === 'inProgress' ? t('actionPlans.next.inProgressEmpty') : t('actionPlans.next.groupEmpty')}
      />
    </section>
  )
}

function PlanTable({
  rows,
  model,
  t,
  locale,
  canManage,
  onCancel,
  empty,
  demoted = false,
}: {
  rows: readonly PlanRow[]
  model: ActionPlansListModel
  t: TranslateFn
  locale: string
  canManage: boolean
  onCancel?: (row: PlanRow) => void
  empty: string
  demoted?: boolean
}) {
  return (
    <div className="rounded-lg border border-line-default bg-surface-card pt-2 shadow-sm">
      {/* No minimum width: at 1024 the table fits its card instead of scrolling inside it.
          From 1360px the finding and the owner are columns, as the artboard draws them;
          below that they fold into the plan's cell (`PlanTableRow`), and the sample chip
          moves with them to the Plan heading. Widths sit on the header cells, because a
          `<col>` would keep a hidden column's width in the fixed layout. */}
      <Table className="table-fixed">
        <thead>
          <tr className="border-b border-line-default">
            <th className={HEAD}>
              <span className={HEAD_STACK}>
                {t('actionPlans.next.colPlan')}
                {model.findingsAreSample && <SampleChip t={t} className={FOLDED_ONLY} />}
              </span>
            </th>
            <th className={cn(HEAD, WIDE_ONLY, 'w-[222px]')} data-col="finding">
              <span className={HEAD_STACK}>
                {t('actionPlans.next.colFinding')}
                {model.findingsAreSample && <SampleChip t={t} />}
              </span>
            </th>
            <th className={cn(HEAD, WIDE_ONLY, 'w-[162px]')} data-col="owner">
              {t('actionPlans.next.colOwner')}
            </th>
            <th className={cn(HEAD, 'w-[132px]')} data-col="due">
              {t('actionPlans.next.colDue')}
            </th>
            <th className={cn(HEAD, 'w-[92px]')} data-col="priority">
              {t('actionPlans.next.colPriority')}
            </th>
            <th className={cn(HEAD, 'w-[144px]')} data-col="actions">
              <span className="sr-only">{t('common.actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <PlanTableRow
              key={row.id}
              row={row}
              asOf={model.asOf}
              t={t}
              locale={locale}
              canManage={canManage && !demoted}
              onCancel={onCancel}
            />
          ))}
        </tbody>
      </Table>
      {rows.length === 0 && (
        // Under the headings rather than in a row of the table: a cell spanning the six
        // columns the artboard draws added two phantom columns below 1360px, where four are
        // shown, and squeezed the Plan heading into its neighbour (the r1 shot at 1024).
        <p data-slot="plan-group-empty" className="m-0 flex items-center gap-2.5 px-3 py-3.5 text-xs text-fg-secondary">
          <Clock aria-hidden="true" className="size-3.5 shrink-0 text-fg-label" />
          {empty}
        </p>
      )}
    </div>
  )
}

function PlanTableRow({
  row,
  asOf,
  t,
  locale,
  canManage,
  onCancel,
}: {
  row: PlanRow
  asOf: string
  t: TranslateFn
  locale: string
  canManage: boolean
  onCancel?: (row: PlanRow) => void
}) {
  const days = daysToDue(row, asOf)
  const open = row.status !== 'cancelled' && row.status !== 'completed'
  const urgent = open && days !== null && (days < 0 || isDueThisMonth(row, asOf))
  const progressNote = row.status === 'in_progress' ? t('actionPlans.next.withProgressNote') : t('actionPlans.next.noProgressNote')

  return (
    <tr data-plan-row={row.id} className="border-b border-line-light last:border-0">
      <td className={CELL}>
        <div className="flex min-w-0 flex-col">
          <Link
            to={`/action-plans/${row.id}`}
            className="truncate text-base font-semibold text-fg-primary no-underline hover:underline"
          >
            {row.name}
          </Link>
          <span className="text-xs text-fg-label">
            {open
              ? t('actionPlans.next.createdMeta', { date: calendarDay(Date.parse(row.createdAt), locale), note: progressNote })
              : t('actionPlans.next.createdOn', { date: calendarDay(Date.parse(row.createdAt), locale) })}
          </span>
          <span data-slot="plan-row-folded" className={cn('mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1', FOLDED_ONLY)}>
            <FindingCell row={row} t={t} />
            <span className={cn('text-xs', row.ownerName ? 'text-fg-secondary' : 'text-fg-label')}>
              {t('actionPlans.next.ownerInline', { name: row.ownerName ?? t('actionPlans.next.unassigned') })}
            </span>
          </span>
        </div>
      </td>
      <td className={cn(CELL, WIDE_ONLY)}>
        <FindingCell row={row} t={t} />
      </td>
      <td className={cn(CELL, WIDE_ONLY)}>
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed border-line-default bg-surface-icon-box text-xs text-fg-label"
          >
            {row.ownerName ? row.ownerName.slice(0, 1) : '·'}
          </span>
          <span className={cn('truncate text-sm', row.ownerName ? 'text-fg-primary' : 'text-fg-label')}>
            {row.ownerName ?? t('actionPlans.next.unassigned')}
          </span>
        </div>
      </td>
      <td className={CELL}>
        <div className="flex flex-col">
          <span className={cn('font-mono text-base tabular-nums', urgent ? 'text-accent-red' : 'text-fg-primary')}>
            {calendarDay(Date.parse(row.dueDate), locale)}
          </span>
          {open && days !== null && (
            <span className={cn('whitespace-nowrap text-xs', urgent ? 'text-accent-red' : 'text-fg-label')}>{dueNote(t, days, isDueThisMonth(row, asOf))}</span>
          )}
        </div>
      </td>
      <td className={CELL}>
        <Chip
          tone={PRIORITY_TONE[row.priority] ?? 'neutral'}
          label={priorityLabel(t, row.priority)}
          className="w-20 justify-start"
        />
      </td>
      <td className={CELL}>
        <div className="flex justify-end gap-2">
          <Button asChild variant="outline">
            <Link to={`/action-plans/${row.id}`}>{t('actionPlans.next.open')}</Link>
          </Button>
          {canManage && onCancel && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="icon" aria-label={t('actionPlans.next.moreActions', { title: row.name })}>
                  <Ellipsis aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link to={`/action-plans/${row.id}`}>{t('actionPlans.recordProgress')}</Link>
                </DropdownMenuItem>
                {open && (
                  <DropdownMenuItem onSelect={() => onCancel(row)}>{t('actionPlans.next.cancelPlan')}</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </td>
    </tr>
  )
}

function dueNote(t: TranslateFn, days: number, thisMonth: boolean): string {
  if (days < 0) return t('actionPlans.next.overdueBy', { days: -days })
  const when =
    days === 0 ? t('actionPlans.next.dueToday') : days === 1 ? t('actionPlans.next.dueTomorrow') : t('actionPlans.next.dueIn', { days })
  return thisMonth ? t('actionPlans.next.joined', { first: when, second: t('actionPlans.next.thisMonth') }) : when
}

function FindingCell({ row, t }: { row: PlanRow; t: TranslateFn }): ReactNode {
  if (!row.departmentId) {
    return (
      <span className="text-sm text-fg-label">
        {row.finding
          ? t('actionPlans.next.findingCompanyWide', { dimension: dimensionName(t, row.finding.dimensionKey) })
          : t('actionPlans.next.noFinding')}
      </span>
    )
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-sm text-fg-secondary">
      <Chip label={row.departmentName ?? t('actionPlans.fromUnlistedDepartment')} />
      {row.finding && <span className="truncate">{dimensionName(t, row.finding.dimensionKey)}</span>}
    </span>
  )
}

function CancelledGroup({
  rows,
  model,
  t,
  locale,
  startOpen,
}: {
  rows: readonly PlanRow[]
  model: ActionPlansListModel
  t: TranslateFn
  locale: string
  startOpen: boolean
}) {
  const [open, setOpen] = useState(startOpen)
  const allCompanyWide = rows.every((row) => !row.departmentId)
  const names = joinNames(
    rows.map((row) => row.name),
    locale,
  )
  return (
    <section aria-label={t(GROUP_HEADING.cancelled)} data-group="cancelled" className="flex flex-col gap-3">
      {/* One line at every width: the names give way (truncated, whole on the list below)
          and "Mostrar" keeps its place at the end, where the artboard puts it. */}
      <div
        data-slot="cancelled-strip"
        className="flex items-center justify-between gap-3 rounded-lg border border-line-default bg-surface-outer px-4 py-3"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {open ? (
            <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-fg-label" />
          ) : (
            <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-fg-label" />
          )}
          <span className="text-base font-semibold text-fg-secondary">{t(GROUP_HEADING.cancelled)}</span>
          <span className="font-mono text-xs text-fg-label tabular-nums">{rows.length}</span>
          <span className="truncate text-xs text-fg-label">
            {allCompanyWide ? t('actionPlans.next.cancelledSummaryCompanyWide', { names }) : names}
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? t('actionPlans.next.hide') : t('actionPlans.next.show')}
          <ChevronRight aria-hidden="true" className={cn('size-3.5', open && 'rotate-90')} />
        </Button>
      </div>
      {open && (
        <div className="opacity-80">
          <PlanTable rows={rows} model={model} t={t} locale={locale} canManage={false} empty={t('actionPlans.next.groupEmpty')} demoted />
        </div>
      )}
    </section>
  )
}
