import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ChevronDown, ChevronRight, Clock, Ellipsis, Plus, Search } from 'lucide-react'
import { useTranslation, type TranslateFn } from '../../../i18n'
import { PageHeader } from '../../../components/layout'
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
  ErrorState,
  Input,
  KpiCard,
  LoadingRegion,
  SkeletonText,
  Table,
} from '../../../components/ui'
import { useCompanyScope } from '../../../company-context'
import { useViewerCapabilities } from '../../../auth/viewerCapabilities'
import { calendarDay } from '../../../lib/calendarDay'
import { cn } from '../../../lib/cn'
import { KpiRow } from '../../dashboard/components/dashboardGrammar'
import { CanvasSelect } from '../../org-structure/next/super/parts'
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
import { byCount } from '../../../i18n/plural'
import { describeApiError } from '../../../api/describeApiError'

/**
 * The column header, as the spec's `.tbl th` draws it: 12px semibold in the label ink, sentence
 * case — uppercase at 11px is the eyebrow's alone (type ruling of 11 Nov). Set at the TOP of its
 * cell, so every heading stands on one line whatever hangs under one of them.
 *
 * Cells pad on the LEFT only, 12px, and the last column on the right too: the artboard's
 * grid is `minmax(0,1fr) 210px 150px 120px 80px 120px` with 12px gaps and 12px at each end,
 * so a column is its content plus the gap before it — 222, 162, 176 (Vence holds "vencido hace 42 días" with its clock at 13px), 92 and 120 + 24 put the
 * finding, the owner, Vence, Prioridad and the actions exactly where the artboard does.
 *
 * The finding's heading used to carry a "Datos de muestra" chip, hung UNDER it (`HEAD_STACK`)
 * because beside it the chip ran over "Responsable". The finding is now read from the plan's
 * own `dimension:` tag (`findingFromTags`), `sampleModel.ts` is gone, and no chip is drawn
 * (`ActionPlansListNextPage.test.tsx` asserts none); `HEAD_STACK` stays as the headings' box.
 */
const HEAD = 'h-auto bg-transparent pl-3 pr-0 last:pr-3 pb-2.5 pt-0 align-top text-xs font-semibold normal-case tracking-normal text-fg-label whitespace-nowrap'
/** A heading's box — it once stacked the sample chip under the heading; nothing does now. */
const HEAD_STACK = 'flex flex-col items-start gap-1'
const CELL = 'pl-3 pr-0 last:pr-3 py-3 align-middle max-md:border-0 max-md:p-0 max-md:last:pr-0'
/**
 * Under 768px the table stops being a grid: each row becomes the spec's `.row` — the plan's
 * name and folded finding and owner on the first line, then Vence, Prioridad and Abrir on one
 * line under it. A fixed-layout table at 390 squeezed the plan's column to a letter per line.
 *
 * The cells drop the base layer's `td` rule (`index.css`) there, or the first cell — a block
 * now — drew a rule across the middle of the row. Vence takes what Prioridad and the actions
 * leave (`flex-1`, its note may wrap), so the three share one line instead of pushing Abrir
 * onto a third.
 *
 * A table whose parts change `display` can lose its semantics in Safari/VoiceOver, so every
 * part also says its role explicitly (`role="table"`, `"rowgroup"`, `"row"`, `"columnheader"`,
 * `"cell"`), and since the headings are hidden there, Vence and Prioridad carry their column's
 * name for a screen reader (`sr-only md:hidden`) — "Prioridad Alta", not a bare "Alta".
 */
const ROW_STACK = 'max-md:flex max-md:flex-wrap max-md:items-center max-md:gap-x-3 max-md:gap-y-2 max-md:px-4 max-md:py-3'
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
 * `GET /action-plans` (`ActionPlanEndpoints.ListAsync`) answers an administrator with the
 * whole tenant — a `super_admin` for the company they chose, a `company_admin` for their
 * own — and anybody else in the tenant with the plans they OWN, an empty list when they own
 * none. So a non-administrator gets the same screen in owner mode: their plans, under a
 * description that says whose they are, without the "sin responsable" tile (every plan on
 * it is theirs) and without the administrator reads the model then skips. This is where the
 * due-date nudge sends an owner; a refusal here was the product contradicting its own mail.
 *
 * Creating and cancelling are `Roles.Admin` plus `CanAccessCompany` — `canCreateActionPlan`
 * in the seam — and are drawn only for that viewer.
 *
 * The originating finding's dimension is read from the plan's own `dimension:` tag
 * (`findingFromTags`); a plan raised by hand has none, which is the truth.
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
  return <ActionPlansListBody ownerView={!capabilities.seesWholeCompany} />
}

function ActionPlansListBody({ ownerView }: { ownerView: boolean }) {
  const { t, locale } = useTranslation()
  const capabilities = useViewerCapabilities()
  const state = useActionPlansListModel(!ownerView)
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
      setCancelError(describeApiError(err, t))
    }
  }

  return (
    <div>
      <PageHeader
        // The section, as Microclimas and its analytics say it: the two pages sit side by side
        // under Seguimiento in the sidebar and share one header pattern. The company is
        // already named by the active-company chip in the frame.
        eyebrow={t('navigation.sectionFollowUp')}
        title={t('navigation.actionPlans')}
        description={t(ownerView ? 'actionPlans.next.ownerDescription' : 'actionPlans.next.description')}
        primaryAction={
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
              owners={state.owners}
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
        <ErrorState title={t('actionPlans.next.loadListFailed')} description={state.error ?? undefined} onRetry={state.reload} />
      ) : (
        <LoadingRegion loading={loading} label={t('common.loading')}>
          {loading ? (
            <SkeletonText lines={6} />
          ) : ownerView && model.rows.length === 0 ? (
            <EmptyState
              fill
              title={t('actionPlans.next.ownerEmptyTitle')}
              description={t('actionPlans.next.ownerEmptyBody')}
              action={
                <Button asChild variant="outline">
                  <Link to="/dashboard">{t('actionPlans.next.backToDashboard')}</Link>
                </Button>
              }
            />
          ) : (
            <div className="flex flex-col gap-section">
              <Tiles model={model} t={t} locale={locale} ownerView={ownerView} />
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
                    filtering={filtering}
                    // Not `rows.length`: the group is empty either way, and what decides
                    // which sentence is true is whether the COMPANY has any plan at all.
                    firstRun={model.rows.length === 0}
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

function Tiles({
  model,
  t,
  locale,
  ownerView,
}: {
  model: ActionPlansListModel
  t: TranslateFn
  locale: string
  /** Every plan on an owner's screen is theirs, so "sin responsable" would always read 0. */
  ownerView: boolean
}) {
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

  // Danger ink only where a date has gone by — with the clock and the words, never by colour
  // alone (HIG `color.md` › "Avoid relying solely on color"). Due this month is not late, so it
  // reads in the secondary ink like every other fact; sin responsable is a task, not a result,
  // so it is no longer amber (green, amber and red are the three result areas only).
  return (
    <KpiRow>
      <KpiCard
        label={t('actionPlans.next.tileOpen')}
        value={summary.open.toLocaleString(locale)}
        unit={summary.open === 1 ? t('actionPlans.next.unitPlan') : t('actionPlans.next.unitPlans')}
        footnote={<span className="text-fg-secondary">{t('actionPlans.next.joined', { first: dueThisMonth, second: progress })}</span>}
      />
      <KpiCard
        label={t('actionPlans.next.tileFinding')}
        value={finding.withFinding.toLocaleString(locale)}
        unit={t('actionPlans.next.ofTotal', { total: finding.open })}
        footnote={
          finding.dimensionKeys.length > 0
            ? finding.dimensionKeys.map((key) => dimensionName(t, key)).join(', ')
            : t('actionPlans.next.noFindings')
        }
      />
      {!ownerView && (
        <KpiCard
          label={t('actionPlans.next.tileOwner')}
          value={owner.unassigned.toLocaleString(locale)}
          unit={t('actionPlans.next.ofTotal', { total: owner.open })}
          footnote={
            <span className={owner.unassigned > 0 ? 'text-fg-secondary' : undefined}>
              {owner.unassigned > 0 ? t('actionPlans.next.ownerSub') : t('actionPlans.next.ownerAllAssigned')}
            </span>
          }
        />
      )}
      <KpiCard
        label={t('actionPlans.next.tileTracking')}
        value={overdue.count.toLocaleString(locale)}
        unit={overdue.count === 1 ? t('actionPlans.next.overdueOne') : t('actionPlans.next.overdueMany')}
        footnote={
          overdue.first ? (
            <span className="flex min-w-0 items-start gap-1.5 text-fg-secondary" data-slot="seguimiento-line">
              {/* The clock is the tile's one red cue; the place and plan read in secondary ink. */}
              <Clock aria-hidden="true" data-slot="overdue-clock" className="mt-0.75 size-3.5 shrink-0 text-accent-red-ink" />
              <span
                // Up to two lines: at 13px with the clock, one line held only "Personas ·
                // Programa" — no plan named (review of 12 Nov). The line wraps at word boundaries
                // and the tile shows its first two lines, so the plan's title stops after the last
                // WHOLE word there is room for — never "handove…", and never on a short word or a
                // preposition ("de", "la", "entre": `bindShortWords`). The whole of it is in
                // `title`, and a screen reader reads it all.
                className="block min-w-0 max-h-[2lh] overflow-hidden whitespace-normal"
                data-slot="seguimiento-first"
                data-source={overdue.source}
                title={overdue.first.placeName ? `${overdue.first.placeName} · ${overdue.first.name}` : overdue.first.name}
              >
                {overdue.first.placeName
                  ? t('actionPlans.next.overdueFirst', { place: overdue.first.placeName, name: bindShortWords(overdue.first.name) })
                  : bindShortWords(overdue.first.name)}
              </span>
            </span>
          ) : (
            <span data-source={overdue.source}>{t('actionPlans.next.noneOverdue')}</span>
          )
        }
      />
    </KpiRow>
  )
}

/**
 * "Cuándo vence cada plan" draws the plans still AHEAD of today, from today to the last of them.
 *
 * A plan past its date used to be pinned to today's mark, so when four were late their four
 * dates and names printed in the same pixels ("30 sept", "15 oct", "25 oct" and "9 nov" as one
 * smear) and the range read backwards ("11 nov → 9 nov"). Those plans are already the Vencidos
 * table right under this card, so the drawing leaves them to it and says how many it left out;
 * when every open plan is late there is nothing ahead to draw, and the card says so in a
 * sentence instead (HIG `charting-data.md` › "Not every collection of data needs to be displayed
 * in a chart … consider offering the data in other ways, such as in a list").
 */
function TimelineCard({ model, t, locale }: { model: ActionPlansListModel; t: TranslateFn; locale: string }) {
  const full = dueTimeline(model.rows, model.asOf)
  const ahead = full.points.filter((point) => point.days >= 0)
  const late = full.points.length - ahead.length
  const span = Math.max(1, ...ahead.map((point) => point.days))
  // Re-spread over what is ahead: with the late ones gone, the last plan still ends the axis.
  const timeline = { points: ahead.map((point) => ({ ...point, position: Math.min(1, point.days / span) })), firstAhead: full.firstAhead }
  const last = timeline.points[timeline.points.length - 1]
  const aside = [
    last
      ? t(byCount(full.firstAhead ?? 0, 'actionPlans.next.timelineRangeOne', 'actionPlans.next.timelineRange'), {
          from: calendarDay(Date.parse(model.asOf), locale),
          to: calendarDay(Date.parse(last.dueDate), locale),
          days: full.firstAhead ?? 0,
        })
      : late === 0
        ? t('actionPlans.next.timelineEmpty')
        : null,
    late > 0 && last ? t(byCount(late, 'actionPlans.next.timelineLateOne', 'actionPlans.next.timelineLate'), { count: late }) : null,
  ].filter((part): part is string => part !== null)
  return (
    <section
      aria-labelledby="plans-timeline"
      className="flex flex-col gap-3 rounded-xl border border-line-panel bg-surface-card px-5 pb-3 pt-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="plans-timeline" className="m-0 text-2xl">
          {t('actionPlans.next.timelineHeading')}
        </h2>
        {aside.length > 0 && <span className="text-sm text-fg-tertiary tabular-nums">{aside.join(' · ')}</span>}
      </div>
      {timeline.points.length > 0 ? (
        <DueTimeline timeline={timeline} asOf={model.asOf} locale={locale} t={t} />
      ) : (
        late > 0 && (
          <p data-slot="timeline-all-late" className="m-0 flex items-center gap-2 text-base text-fg-secondary">
            <Clock aria-hidden="true" className="size-4 shrink-0 text-accent-red-ink" />
            {t(byCount(late, 'actionPlans.next.timelineAllLateOne', 'actionPlans.next.timelineAllLate'), { count: late })}
          </p>
        )
      )}
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
        className="w-full sm:w-42.5"
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
        className="w-full sm:w-auto"
      >
        <option value="">{t('actionPlans.allPriorities')}</option>
        {ACTION_PLAN_PRIORITIES.map((priority) => (
          <option key={priority} value={priority}>
            {priorityLabel(t, priority)}
          </option>
        ))}
      </CanvasSelect>
      <p className="m-0 ml-auto text-sm text-fg-tertiary tabular-nums">
        {t('actionPlans.next.countSummary', { total: summary.total, open: summary.open, cancelled: summary.cancelled })}
      </p>
    </div>
  )
}

/**
 * Which sentence an empty group gets, and why there are four of them.
 *
 * The screen used to choose by GROUP alone — `inProgress` got its own line and everything
 * else got "no plan matches the filters". So a company on its first day, with no plans and
 * no filter set, was told its filters excluded everything. That is the first thing a new
 * client reads on this page, and it blames them for a state they did not create.
 *
 * The three states are distinct and each is now said plainly: a filter really is on; the
 * company has no plans at all, which is the one case worth explaining where plans come
 * from; or this group happens to be empty while others are not.
 */
function emptyLineFor(
  group: PlanGroup,
  { filtering, firstRun }: { filtering: boolean; firstRun: boolean },
  t: TranslateFn,
): ReactNode {
  if (filtering) return t('actionPlans.next.groupEmpty')
  if (firstRun) {
    return (
      <span>
        {t('actionPlans.next.firstPlanEmpty')}{' '}
        <Link to="/surveys" className="underline underline-offset-2">
          {t('actionPlans.next.firstPlanLink')}
        </Link>
      </span>
    )
  }
  return group === 'inProgress'
    ? t('actionPlans.next.inProgressEmpty')
    : t('actionPlans.next.groupEmptyUnfiltered')
}

function GroupSection({
  group,
  rows,
  model,
  t,
  locale,
  filtering,
  firstRun,
  canManage,
  onCancel,
}: {
  group: PlanGroup
  rows: readonly PlanRow[]
  model: ActionPlansListModel
  t: TranslateFn
  locale: string
  filtering: boolean
  firstRun: boolean
  canManage: boolean
  onCancel: (row: PlanRow) => void
}) {
  const headingId = `plans-group-${group}`
  return (
    <section aria-labelledby={headingId} data-group={group} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <h2 id={headingId} className="m-0 text-2xl">
            {t(GROUP_HEADING[group])}
          </h2>
          <span className="text-sm text-fg-tertiary tabular-nums">{rows.length}</span>
        </div>
        <p className="m-0 text-sm text-fg-tertiary">{t(GROUP_NOTE[group])}</p>
      </div>
      <PlanTable
        rows={rows}
        model={model}
        t={t}
        locale={locale}
        canManage={canManage}
        onCancel={onCancel}
        empty={emptyLineFor(group, { filtering, firstRun }, t)}
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
  empty: ReactNode
  demoted?: boolean
}) {
  return (
    <div className="rounded-xl border border-line-panel bg-surface-card pt-2.5 max-md:pt-0">
      {/* No minimum width: at 1024 the table fits its card instead of scrolling inside it.
          From 1360px the finding and the owner are columns, as the artboard draws them;
          below that they fold into the plan's cell (`PlanTableRow`). Widths sit on the header cells, because a
          `<col>` would keep a hidden column's width in the fixed layout. */}
      <Table role="table" className="table-fixed max-md:block">
        <thead role="rowgroup" className="max-md:hidden">
          <tr role="row" className="border-b border-line-default">
            <th role="columnheader" className={HEAD}>
              <span className={HEAD_STACK}>
                {t('actionPlans.next.colPlan')}
              </span>
            </th>
            <th role="columnheader" className={cn(HEAD, WIDE_ONLY, 'w-55.5')} data-col="finding">
              <span className={HEAD_STACK}>
                {t('actionPlans.next.colFinding')}
              </span>
            </th>
            <th role="columnheader" className={cn(HEAD, WIDE_ONLY, 'w-40.5')} data-col="owner">
              {t('actionPlans.next.colOwner')}
            </th>
            <th role="columnheader" className={cn(HEAD, 'w-44')} data-col="due">
              {t('actionPlans.next.colDue')}
            </th>
            <th role="columnheader" className={cn(HEAD, 'w-23')} data-col="priority">
              {t('actionPlans.next.colPriority')}
            </th>
            <th role="columnheader" className={cn(HEAD, 'w-36')} data-col="actions">
              <span className="sr-only">{t('common.actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup" className="max-md:block">
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
        <p data-slot="plan-group-empty" className="m-0 flex items-center gap-2.5 px-3 py-3.5 text-sm text-fg-secondary">
          <Clock aria-hidden="true" className="size-3.5 shrink-0 text-fg-tertiary" />
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
  // Danger ink is for a date that has GONE BY, with the clock and "vencido hace N días" beside
  // it; due later this month is said in words ("en 20 días · este mes") in the ordinary ink.
  const late = open && days !== null && days < 0
  const progressNote = row.status === 'in_progress' ? t('actionPlans.next.withProgressNote') : t('actionPlans.next.noProgressNote')

  return (
    <tr role="row" data-plan-row={row.id} className={cn('border-b border-line-light last:border-0', ROW_STACK)}>
      <td role="cell" className={cn(CELL, 'max-md:block max-md:basis-full')}>
        <div className="flex min-w-0 flex-col">
          <Link
            to={`/action-plans/${row.id}`}
            className="truncate text-base font-semibold text-fg-primary no-underline hover:underline"
          >
            {row.name}
          </Link>
          <span className="text-sm text-fg-tertiary">
            {open
              ? t('actionPlans.next.createdMeta', { date: calendarDay(Date.parse(row.createdAt), locale), note: progressNote })
              : t('actionPlans.next.createdOn', { date: calendarDay(Date.parse(row.createdAt), locale) })}
          </span>
          <span data-slot="plan-row-folded" className={cn('mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1', FOLDED_ONLY)}>
            <FindingCell row={row} t={t} />
            <span className={cn('text-sm', row.ownerName ? 'text-fg-secondary' : 'text-fg-tertiary')}>
              {t('actionPlans.next.ownerInline', { name: row.ownerName ?? t('actionPlans.next.unassigned') })}
            </span>
          </span>
        </div>
      </td>
      <td role="cell" className={cn(CELL, WIDE_ONLY)}>
        <FindingCell row={row} t={t} />
      </td>
      <td role="cell" className={cn(CELL, WIDE_ONLY)}>
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed border-line-default bg-surface-icon-box text-xs text-fg-label"
          >
            {row.ownerName ? row.ownerName.slice(0, 1) : '·'}
          </span>
          <span className={cn('truncate text-sm', row.ownerName ? 'text-fg-primary' : 'text-fg-tertiary')}>
            {row.ownerName ?? t('actionPlans.next.unassigned')}
          </span>
        </div>
      </td>
      <td role="cell" className={cn(CELL, 'max-md:block max-md:min-w-0 max-md:flex-1')}>
        <span className="sr-only md:hidden">{t('actionPlans.next.colDue')}</span>
        <div className="flex flex-col">
          {/* The date stays in primary ink: the row's one red cue is the clock and the words
              under it, so a late row does not shout in two places (one colour per meaning). */}
          <span data-slot="plan-due-date" className="text-base tabular-nums text-fg-primary">
            {calendarDay(Date.parse(row.dueDate), locale)}
          </span>
          {open && days !== null && (
            <span
              data-slot="plan-due-note"
              className={cn('flex items-center gap-1 whitespace-nowrap text-sm max-md:whitespace-normal', late ? 'text-accent-red-ink' : 'text-fg-tertiary')}
            >
              {late && <Clock aria-hidden="true" className="size-3.5 shrink-0" />}
              {bindCount(dueNote(t, days, isDueThisMonth(row, asOf)))}
            </span>
          )}
        </div>
      </td>
      <td role="cell" className={cn(CELL, 'max-md:block max-md:shrink-0')}>
        <span className="sr-only md:hidden">{t('actionPlans.next.colPriority')}</span>
        {/* Gray, hugging its word: a priority is not one of the three result areas, so it
            wears none of their colours, and a chip is a label, not a 80px field. */}
        <Chip label={priorityLabel(t, row.priority)} />
      </td>
      <td role="cell" className={cn(CELL, 'max-md:block max-md:shrink-0')}>
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

/**
 * A count tied to the words either side by no-break spaces, so where Vence's note wraps at
 * phone width it breaks as "vencido / hace 43 días", never leaving "días" alone on a line.
 */
function bindCount(text: string): string {
  return text.replace(/ (\d+) /, '\u00A0$1\u00A0')
}

function dueNote(t: TranslateFn, days: number, thisMonth: boolean): string {
  if (days < 0) return t(byCount(-days, 'actionPlans.next.overdueByOne', 'actionPlans.next.overdueBy'), { days: -days })
  const when =
    days === 0 ? t('actionPlans.next.dueToday') : days === 1 ? t('actionPlans.next.dueTomorrow') : t('actionPlans.next.dueIn', { days })
  return thisMonth ? t('actionPlans.next.joined', { first: when, second: t('actionPlans.next.thisMonth') }) : when
}

/**
 * Where a plan came from, and — since the list endpoint started returning it — a way back.
 *
 * The dimension is read from the plan's own `dimension:<key>` tag and the survey from
 * `sourceSurveyId`, both written by the results screen when the plan was raised. A plan
 * created by hand has neither and says so; it is not a gap to paper over.
 */
function FindingCell({ row, t }: { row: PlanRow; t: TranslateFn }): ReactNode {
  const dimension = row.finding ? dimensionName(t, row.finding.dimensionKey) : null
  // The cell the finding was measured in. `?from=` is read by nothing yet; the results
  // screen opens on its own map and the reader picks the row up from there.
  const origin = row.sourceSurveyId === null ? null : `/surveys/${row.sourceSurveyId}/results`
  const wrap = (children: ReactNode) =>
    origin === null ? (
      children
    ) : (
      // `block`, not the default inline: `min-w-0` does nothing on an inline box, so an
      // inline link let its flex child keep its content width and overflow the cell.
      <Link to={origin} className="block min-w-0 hover:underline" title={t('actionPlans.next.openOrigin')}>
        {children}
      </Link>
    )

  if (!row.departmentId) {
    return (
      <span className="block min-w-0 text-sm break-words text-fg-label">
        {wrap(
          dimension
            ? t('actionPlans.next.findingCompanyWide', { dimension })
            : t('actionPlans.next.noFinding'),
        )}
      </span>
    )
  }
  // The column is 222px wide in a `table-fixed` table, and the group's name sat in a chip
  // that is `shrink-0 whitespace-nowrap` by construction — a status chip is built for one
  // word. "Ventanilla Única de Comercio Exterior" is 240px, so the cell overflowed and
  // painted ON TOP OF the owner beside it: two columns' text in the same pixels. It could
  // only appear once a plan had provenance to show, which is why nothing caught it. The
  // group and the dimension now stack, the chip's own name wraps inside it, and the
  // dimension wraps rather than truncating — a group is not a word, so it does not get a
  // word's typography.
  return (
    <span className="flex min-w-0 flex-col items-start gap-1 text-sm text-fg-secondary">
      {wrap(
        <span className="flex min-w-0 flex-col items-start gap-1">
          <Chip
            label={row.departmentName ?? t('actionPlans.fromUnlistedDepartment')}
            className="h-auto max-w-full py-0.5 leading-snug whitespace-normal"
          />
          {dimension && <span className="break-words">{dimension}</span>}
        </span>,
      )}
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
        className="flex items-center justify-between gap-3 rounded-xl border border-line-panel bg-surface-fill-subtle px-4 py-3"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {open ? (
            <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-fg-label" />
          ) : (
            <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-fg-label" />
          )}
          <span className="text-base font-semibold text-fg-secondary">{t(GROUP_HEADING.cancelled)}</span>
          <span className="text-sm text-fg-tertiary tabular-nums">{rows.length}</span>
          <span className="truncate text-sm text-fg-tertiary">
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
        <div>
          <PlanTable rows={rows} model={model} t={t} locale={locale} canManage={false} empty={t('actionPlans.next.groupEmpty')} demoted />
        </div>
      )}
    </section>
  )
}
