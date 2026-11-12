import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowRight, ChartColumn, ChevronDown, Clock, Ellipsis, Pencil, Plus, Shield, Target, Trash2 } from 'lucide-react'
import { useTranslation, type TranslateFn } from '../../../i18n'
import { PageHeader } from '../../../components/layout'
import { CanvasCard, FactList, IconBox, PageMeta } from '../../../components/canvas'
import {
  Alert,
  AlertDescription,
  Button,
  Chip,
  ConfirmationDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  LoadingRegion,
  Note,
  Progress,
  ProtectedState,
  SkeletonText,
} from '../../../components/ui'
import { useCompanyScope } from '../../../company-context'
import { useViewerCapabilities } from '../../../auth/viewerCapabilities'
import { calendarDay, calendarDayLong } from '../../../lib/calendarDay'
import { cn } from '../../../lib/cn'
import { dimensionLabel } from '../../surveys/dimensionLabel'
import { reading } from '../../dashboard/next/derive'
import { ANONYMITY_FLOOR, BandChip, bandOf } from '../../../components/charts'
import { useResultBands } from '../../result-bands/useResultBands'
import ProgressUpdateForm from '../components/ProgressUpdateForm'
import PlanEditForm from '../components/PlanEditForm'
import { ACTION_PLAN_PRIORITIES, ACTION_PLAN_STATUSES, kpiProgressPercent, priorityLabel, statusLabel } from '../actionPlanVocabulary'
import { daysToDue, dueDay, elapsedShare, type PlanFinding, type PlanMove } from './planDetailDerive'
import type { ActionPlanDetailModel, Settled } from './planDetailModel'
import { useActionPlanDetailModel, type ActionPlanDetailState } from './useActionPlanDetailModel'
import { byCount } from '../../../i18n/plural'
import { describeApiError } from '../../../api/describeApiError'

/**
 * `/action-plans/:id` — the redesigned Detalle de plan, drawn as the ActionPlanDetail board
 * of 10 Sep ("Follow Main's pattern: header with owner and due date, originating finding,
 * timeline of updates, one primary 'Registrar avance'"). It replaced `ActionPlanDetailPage`
 * on this route; that page stays in the tree, unrouted, as the wiring reference.
 *
 * The reads and the writes are the old page's (`useActionPlanDetailModel`); what changed is
 * the presentation, and three things the board draws that the old page did not: the
 * originating finding, the plan's author and creation day, and the Bitácora.
 */
export default function ActionPlanDetailNextPage() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const scope = useCompanyScope()
  // `GET /action-plans/{id}` answers an administrator of the plan's company and the plan's
  // OWNER (`ActionPlanEndpoints.CanReadAsOwner`) -- the person the due-date nudge links here.
  // Which of the two this reader is, only the server knows for certain, so anybody in a
  // company asks, and a 403 is drawn as the refusal it is rather than as a failure.
  const administers = scope.isSuperAdmin || scope.role === 'company_admin'
  const readable = administers || scope.status === 'ready'
  const state = useActionPlanDetailModel(id, readable, administers)

  if (!readable || state.forbidden) {
    return <EmptyState title={t('actionPlans.accessRestricted')} description={t('actionPlans.noPermissionMessage')} />
  }
  if (state.status === 'error') {
    return <ErrorState title={t('actionPlans.next.loadPlanFailed')} description={state.error ?? undefined} onRetry={state.reload} />
  }
  if (state.status === 'loading' || !state.model) {
    return (
      <LoadingRegion loading label={t('common.loading')}>
        <SkeletonText lines={6} />
      </LoadingRegion>
    )
  }
  return <ActionPlanDetailView state={state} model={state.model} />
}

const STATUS_KEY: Record<string, string> = {
  not_started: 'actionPlans.next.status.notStarted',
  in_progress: 'actionPlans.next.status.inProgress',
  completed: 'actionPlans.next.status.completed',
  overdue: 'actionPlans.next.status.overdue',
  cancelled: 'actionPlans.next.status.cancelled',
}


/** The board's sentence-case status ("No iniciado"); the server's own word for one it does not know. */
function statusWord(t: TranslateFn, status: string): string {
  const key = STATUS_KEY[status]
  return key ? t(key) : statusLabel(t, status)
}

/*
 * Every status and priority chip is gray. Blue is for what is live and what can be acted on;
 * green, amber and red are the three result areas and nothing else (ruling of 11 Nov, HIG
 * `color.md` › "Avoid using the same color to mean different things"). A plan's lateness is
 * said by the due sentence beside them, in the danger ink with a clock and the words.
 */

/** A plan that is over: its due date no longer counts down. */
const SETTLED = new Set(['completed', 'cancelled'])

/**
 * The radio value standing for "nobody". Radix reads '' as "no item selected", so an empty
 * string would leave the menu unmarked for exactly the plans that need the row most.
 */
const UNASSIGNED = '__unassigned__'

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part.charAt(0).toLocaleUpperCase())
    .join('')
}

function valueOf<T>(region: Settled<T>): T | undefined {
  return region.status === 'ready' ? region.value : undefined
}

/** A calendar day with its year, as the Ficha and the Plazo boxes print it: "15 oct 2026". */
function dayWithYear(isoDay: string, locale: string): string {
  return new Date(`${isoDay}T00:00:00Z`).toLocaleDateString(locale, {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function ActionPlanDetailView({ state, model }: { state: ActionPlanDetailState; model: ActionPlanDetailModel }) {
  const { t, locale } = useTranslation()
  const capabilities = useViewerCapabilities()
  const { plan, asOf } = model
  const manages = capabilities.canManageActionPlan(plan)
  const navigate = useNavigate()
  const [progressOpen, setProgressOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function confirmDelete() {
    setDeleteError(null)
    try {
      await state.deletePlan()
    } catch (err) {
      setDeleteError(describeApiError(err, t))
      // Rethrown so the dialog stays open with the reason in it (`ConfirmationDialog`).
      throw err
    }
    void navigate('/action-plans', { replace: true })
  }

  const due = dueDay(plan.dueDate)
  const days = daysToDue(asOf, plan.dueDate)
  const dueLong = calendarDayLong(Date.parse(`${due}T00:00:00Z`), locale)
  const dueShort = calendarDay(Date.parse(`${due}T00:00:00Z`), locale)
  const settled = SETTLED.has(plan.status)
  const department = valueOf(model.departmentName)
  const scopeName = department === null ? t('actionPlans.next.companyWide') : (department ?? null)
  const createdAt = valueOf(model.createdAt) ?? null
  const createdDay = createdAt ? dueDay(createdAt) : null
  const author = valueOf(model.authorName) ?? null
  const priorityWord = priorityLabel(t, plan.priority).toLocaleLowerCase(locale)

  const dueSentence = settled
    ? t('actionPlans.next.due.settled', { date: dueLong })
    : days > 1
      ? t(byCount(days, 'actionPlans.next.due.futureOne', 'actionPlans.next.due.future'), { date: dueLong, days })
      : days === 1
        ? t('actionPlans.next.due.tomorrow', { date: dueLong })
        : days === 0
          ? t('actionPlans.next.due.today', { date: dueLong })
          : days === -1
            ? t('actionPlans.next.due.yesterday', { date: dueLong })
            : t(byCount(-days, 'actionPlans.next.due.pastOne', 'actionPlans.next.due.past'), { date: dueLong, days: -days })

  return (
    <div>
      <PageHeader
        title={plan.title}
        eyebrow={scopeName ? t('actionPlans.next.eyebrow', { scope: scopeName }) : t('actionPlans.next.eyebrowPlain')}
        breadcrumbs={[{ label: t('navigation.actionPlans'), href: '/action-plans' }, { label: plan.title }]}
        meta={
          <PageMeta>
            <Chip label={statusWord(t, plan.status)} />
            <Chip label={t('actionPlans.next.priorityChip', { priority: priorityWord })} />
            <span data-slot="plan-due-sentence" className={cn('inline-flex items-center gap-1', !settled && days < 0 && 'text-accent-red-ink')}>
              {!settled && days < 0 && <Clock aria-hidden="true" className="size-3.5 shrink-0" />}
              {dueSentence}
            </span>
          </PageMeta>
        }
        primaryAction={
          manages ? (
            <Button variant="primary" size="canvas" onClick={() => setProgressOpen(true)}>
              <Plus aria-hidden="true" />
              {t('actionPlans.next.recordProgress')}
            </Button>
          ) : undefined
        }
        actions={
          manages ? (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="canvas" disabled={state.saving}>
                    {t('actionPlans.next.changeStatus')}
                    <ChevronDown aria-hidden="true" className="text-fg-tertiary" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuRadioGroup value={plan.status} onValueChange={(next) => void state.changeStatus(next)}>
                    {ACTION_PLAN_STATUSES.map((status) => (
                      <DropdownMenuRadioItem key={status} value={status}>
                        {statusWord(t, status)}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon-canvas" disabled={state.saving} aria-label={t('actionPlans.next.moreActions', { title: plan.title })}>
                    <Ellipsis aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                    <Pencil aria-hidden="true" />
                    {t('actionPlans.next.edit.menu')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>{t('actionPlans.next.priorityMenu')}</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={plan.priority} onValueChange={(next) => void state.changePriority(next)}>
                    {ACTION_PLAN_PRIORITIES.map((priority) => (
                      <DropdownMenuRadioItem key={priority} value={priority}>
                        {priorityLabel(t, priority)}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                  {/* The plan's owner. `UNASSIGNED` is a sentinel rather than an empty string
                      because Radix treats '' as "no value" and would stop marking the row. */}
                  <DropdownMenuLabel>{t('actionPlans.next.ownerMenu')}</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={plan.ownerId ?? UNASSIGNED}
                    onValueChange={(next) => void state.changeOwner(next === UNASSIGNED ? null : next)}
                  >
                    <DropdownMenuRadioItem value={UNASSIGNED}>{t('actionPlans.next.unassigned')}</DropdownMenuRadioItem>
                    {(valueOf(model.owners) ?? []).map((owner) => (
                      <DropdownMenuRadioItem key={owner.id} value={owner.id}>
                        {owner.name}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                  {/* Deleting is administrators only on the server (`ActionPlanEndpoints.DeleteAsync`),
                      the same rule as every write in this menu; the confirm says what goes with it. */}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => {
                      setDeleteError(null)
                      setDeleteOpen(true)
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                    {t('actionPlans.next.delete.menu')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : undefined
        }
      />

      {state.actionError && (
        <Alert variant="destructive" role="alert" className="mb-panel-gap">
          <AlertDescription>{state.actionError}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <DeadlineCard model={model} days={days} dueLong={dueLong} dueShort={dueShort} createdDay={createdDay} author={author} />
          <WhatCard model={model} scopeName={scopeName} manages={manages} />
          <MeasuresCard model={model} />
          <LogCard
            model={model}
            author={author}
            createdDay={createdDay}
            scopeName={scopeName}
            priorityWord={priorityWord}
            dueShort={dueShort}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <CanvasCard title={t('actionPlans.next.sheet.title')} inset="side">
            <FactList
              termWidth="lg"
              facts={[
                {
                  id: 'department',
                  term: t('actionPlans.next.sheet.department'),
                  value:
                    department === null ? (
                      <span>{t('actionPlans.next.companyWide')}</span>
                    ) : department ? (
                      <Link to="/departments" className="inline-flex items-center gap-1.5 font-medium text-fg-primary">
                        {department}
                        <ArrowRight aria-hidden="true" className="size-3 text-fg-tertiary" />
                      </Link>
                    ) : (
                      <span className="text-fg-tertiary">{t('actionPlans.next.sheet.unknown')}</span>
                    ),
                },
                {
                  id: 'owner',
                  term: t('actionPlans.next.sheet.owner'),
                  value: plan.ownerName ? (
                    <span className="font-medium text-fg-primary">{plan.ownerName}</span>
                  ) : (
                    // In words, not amber: unassigned is a task to settle before the first
                    // progress note (the list's "Sin responsable" tile says so), not a result area.
                    <span className="text-fg-secondary">{t('actionPlans.next.unassigned')}</span>
                  ),
                },
                {
                  id: 'priority',
                  term: t('actionPlans.next.sheet.priority'),
                  value: <Chip label={priorityLabel(t, plan.priority)} />,
                },
                {
                  id: 'status',
                  term: t('actionPlans.next.sheet.status'),
                  value: <Chip label={statusWord(t, plan.status)} />,
                },
                {
                  id: 'created',
                  term: t('actionPlans.next.sheet.created'),
                  value: createdDay ? (
                    <span className="tabular-nums">{dayWithYear(createdDay, locale)}</span>
                  ) : (
                    <span className="text-fg-tertiary">{t('actionPlans.next.sheet.unknown')}</span>
                  ),
                },
                {
                  id: 'due',
                  term: t('actionPlans.next.sheet.due'),
                  value: <span className="tabular-nums">{dayWithYear(due, locale)}</span>,
                },
                {
                  id: 'template',
                  term: t('actionPlans.next.sheet.template'),
                  value: (
                    <span className={cn(valueOf(model.templateName) ? 'text-fg-primary' : 'text-fg-tertiary')}>
                      {/* "Sin plantilla" only when the plan really has none; a read that did
                          not answer is not evidence that there is no template. */}
                      {valueOf(model.templateName) ??
                        (model.templateName.status === 'failed'
                          ? t('actionPlans.next.sheet.unknown')
                          : t('actionPlans.next.sheet.noTemplate'))}
                    </span>
                  ),
                },
              ]}
            />
          </CanvasCard>
          <Note icon={<Shield />}>{t('actionPlans.next.guard')}</Note>
        </div>
      </div>

      {manages && (
        <Dialog open={progressOpen} onOpenChange={setProgressOpen}>
          <DialogContent closeLabel={t('common.close')}>
            <DialogHeader>
              <DialogTitle>{t('actionPlans.next.progressDialogTitle')}</DialogTitle>
              <DialogDescription>{t('actionPlans.next.progressDialogDescription')}</DialogDescription>
            </DialogHeader>
            <ProgressUpdateForm
              kpis={plan.kpis}
              objectives={plan.objectives}
              onSubmit={async (values) => {
                await state.recordProgress(values)
                setProgressOpen(false)
              }}
            />
          </DialogContent>
        </Dialog>
      )}

      {manages && (
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent closeLabel={t('common.close')}>
            <DialogHeader>
              <DialogTitle>{t('actionPlans.next.edit.title')}</DialogTitle>
              <DialogDescription>{t('actionPlans.next.edit.description')}</DialogDescription>
            </DialogHeader>
            {/* Mounted only while open, so every opening starts from what the plan says now. */}
            {editOpen && (
              <PlanEditForm
                initial={{ title: plan.title, description: plan.description, dueDay: due, tags: plan.tags }}
                onCancel={() => setEditOpen(false)}
                onSubmit={async (values) => {
                  await state.editPlan(values)
                  setEditOpen(false)
                }}
              />
            )}
          </DialogContent>
        </Dialog>
      )}

      {manages && (
        <ConfirmationDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          variant="destructive"
          title={t('actionPlans.next.delete.title')}
          description={deleteError ?? t('actionPlans.next.delete.body', { title: plan.title })}
          confirmText={t('actionPlans.next.delete.confirm')}
          cancelText={t('common.cancel')}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  )
}

function Box({ label, value, note }: { label: string; value: ReactNode; note: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg bg-surface-fill-subtle px-3 py-2.5">
      <span className="text-2xs font-semibold uppercase tracking-tile text-fg-label">{label}</span>
      {value}
      <span className="text-sm text-fg-tertiary">{note}</span>
    </div>
  )
}

function DeadlineCard({
  model,
  days,
  dueLong,
  dueShort,
  createdDay,
  author,
}: {
  model: ActionPlanDetailModel
  days: number
  dueLong: string
  dueShort: string
  createdDay: string | null
  author: string | null
}) {
  const { t, locale } = useTranslation()
  const { plan, asOf } = model
  const late = days < 0
  const count = Math.abs(days)
  const share = elapsedShare(createdDay, asOf, plan.dueDate)
  const createdIsToday = createdDay === asOf
  const noMeasures = plan.kpis.length === 0 && plan.objectives.length === 0
  const lead =
    days === 0
      ? t('actionPlans.next.deadline.dueToday', { date: dueLong })
      : late
        ? t(count === 1 ? 'actionPlans.next.deadline.dayLate' : 'actionPlans.next.deadline.daysLate', { date: dueLong })
        : t(count === 1 ? 'actionPlans.next.deadline.dayLeft' : 'actionPlans.next.deadline.daysLeft', { date: dueLong })
  const inDays =
    days === 0
      ? t('actionPlans.next.deadline.todayShort')
      : late
        ? t(count === 1 ? 'actionPlans.next.deadline.agoOne' : 'actionPlans.next.deadline.ago', { days: count })
        : t(count === 1 ? 'actionPlans.next.deadline.inOne' : 'actionPlans.next.deadline.inDays', { days: count })

  return (
    <CanvasCard title={t('actionPlans.next.deadline.title')}>
      <div className="flex items-end gap-5">
        <span className={cn('shrink-0 text-[2.5rem] font-semibold leading-none tracking-display tabular-nums', late ? 'text-accent-red-ink' : 'text-fg-primary')}>
          {count}
        </span>
        <div className="flex min-w-0 flex-col gap-1 pb-1">
          <span className="text-base text-fg-secondary">{lead}</span>
          <span className="text-sm text-fg-tertiary">
            {noMeasures
              ? t('actionPlans.next.deadline.noMeasures')
              : t('actionPlans.next.deadline.measured', { kpis: plan.kpis.length, objectives: plan.objectives.length })}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="relative h-2 rounded-md bg-surface-fill">
          <div className="absolute inset-y-0 left-0 rounded-md bg-line-default" style={{ width: `${share * 100}%` }} />
          <div
            aria-hidden="true"
            className="absolute -top-1 h-4 w-0.5 bg-fg-primary"
            style={{ left: `calc(${share * 100}% - ${share * 2}px)` }}
          />
          <div aria-hidden="true" className="absolute -top-1 right-0 h-4 w-0.5 bg-line-hover" />
        </div>
        <div className="flex justify-between gap-3 text-sm text-fg-tertiary">
          <span className="tabular-nums text-fg-primary">
            {createdDay
              ? t(createdIsToday ? 'actionPlans.next.deadline.todayMark' : 'actionPlans.next.deadline.createdMark', {
                  date: calendarDay(Date.parse(`${createdDay}T00:00:00Z`), locale),
                })
              : t('actionPlans.next.deadline.todayMark', { date: calendarDay(Date.parse(`${asOf}T00:00:00Z`), locale) })}
          </span>
          <span className="tabular-nums">{t('actionPlans.next.deadline.dueMark', { date: dueShort })}</span>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Box
          label={t('actionPlans.next.deadline.createdLabel')}
          value={
            <span className="text-lg tabular-nums text-fg-primary">
              {createdDay ? dayWithYear(createdDay, locale) : t('actionPlans.next.sheet.unknown')}
            </span>
          }
          note={author ? t('actionPlans.next.deadline.by', { name: author }) : t('actionPlans.next.deadline.byUnknown')}
        />
        <Box
          label={t('actionPlans.next.deadline.dueLabel')}
          value={<span className="text-lg tabular-nums text-fg-primary">{dayWithYear(dueDay(plan.dueDate), locale)}</span>}
          note={inDays}
        />
        <Box
          label={t('actionPlans.next.deadline.nextLabel')}
          value={<span className="text-lg text-fg-primary">{t('actionPlans.next.deadline.nextValue')}</span>}
          note={t('actionPlans.next.deadline.nextNote')}
        />
      </div>
    </CanvasCard>
  )
}

function Label({ children }: { children: ReactNode }) {
  // The spec's `dl.kv` term: secondary ink at the body's step down, sentence case. Uppercase at
  // 11px is the eyebrow's alone.
  return <span className="pt-0.5 text-sm font-medium text-fg-tertiary">{children}</span>
}

function WhatCard({
  model,
  scopeName,
  manages,
}: {
  model: ActionPlanDetailModel
  scopeName: string | null
  /**
   * False for the plan's owner when they are not an administrator. The finding is joined
   * from `GET /surveys/climate-trends`, an administrator read, so the model never asks for
   * it on their behalf and this says who does read it instead of "no se pudo leer".
   */
  manages: boolean
}) {
  const { t } = useTranslation()
  const { plan } = model
  const proposed = model.finding.status === 'ready' && model.finding.value.status !== 'none' && model.finding.value.proposed
  return (
    <CanvasCard title={t('actionPlans.next.what.title')}>
      {/* One column at phone width — the 136px term column left the answer ~130px at 390. */}
      <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-base sm:grid-cols-[136px_minmax(0,1fr)] sm:gap-y-3">
        <Label>{t('actionPlans.next.what.what')}</Label>
        <p className="m-0 text-fg-primary">{plan.title}</p>
        <Label>{t('actionPlans.next.what.why')}</Label>
        <p className={cn('m-0', plan.description.trim() ? 'text-fg-primary' : 'text-fg-tertiary')}>
          {plan.description.trim() || t('actionPlans.next.what.noWhy')}
        </p>
        <div className="flex flex-col items-start gap-1.5">
          <Label>{t('actionPlans.next.what.origin')}</Label>
          {/* Only when the screen really did propose it. The chip says "the plan does not
              store its finding", which stopped being true when the detail response started
              carrying `sourceSurveyId` and the `dimension:` tag; a plan raised from a cell
              now shows what it recorded, and says so by not wearing this. */}
          {proposed && <Chip label={t('actionPlans.next.proposed')} title={t('actionPlans.next.proposedHint')} />}
        </div>
        {manages ? (
          <FindingBlock finding={model.finding} move={model.move} scopeName={scopeName} />
        ) : (
          <p className="m-0 text-sm text-fg-tertiary">{t('actionPlans.next.finding.adminOnly')}</p>
        )}
      </div>
    </CanvasCard>
  )
}

function FindingBlock({
  finding,
  move,
  scopeName,
}: {
  finding: Settled<PlanFinding>
  move: Settled<PlanMove>
  scopeName: string | null
}) {
  const { t, locale } = useTranslation()
  // The finding's band is the company's scale; until it is read (or if it cannot be), the
  // reading prints without a band rather than under the product default.
  const bands = useResultBands().bands
  if (finding.status === 'loading') {
    return <p className="m-0 text-sm text-fg-tertiary">{t('actionPlans.next.finding.loading')}</p>
  }
  if (finding.status === 'failed') {
    return <p className="m-0 text-sm text-fg-tertiary">{t('actionPlans.next.finding.failed')}</p>
  }
  const value = finding.value
  if (value.status === 'none') {
    return <p className="m-0 text-sm text-fg-tertiary">{t('actionPlans.next.finding.none')}</p>
  }
  const scope = scopeName ?? t('actionPlans.next.companyWide')
  const openLink = (
    <Link
      to={`/surveys/${value.surveyId}/results`}
      className="inline-flex items-center gap-1 whitespace-nowrap text-sm text-fg-secondary hover:text-fg-primary"
    >
      {t('actionPlans.next.finding.open', { code: value.code })}
      <ArrowRight aria-hidden="true" className="size-3 text-fg-tertiary" />
    </Link>
  )
  if (value.status === 'protected') {
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Chip label={scope} />
          {/* The padlock and "Menos de {floor}": the floor `planFinding` withheld this group
              under, and no number of its own. */}
          <ProtectedState floor={ANONYMITY_FLOOR} />
        </div>
        <span className="text-sm text-fg-tertiary">
          {t('actionPlans.next.finding.protectedNote', { survey: value.surveyTitle, scope, floor: ANONYMITY_FLOOR })}
        </span>
        {openLink}
      </div>
    )
  }
  const band = bands === null ? null : bandOf(value.score, bands)
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Chip label={scope} />
        <span className="font-medium text-fg-primary">{dimensionLabel(value.dimensionKey, t)}</span>
        {/* The figure in the label ink; the band chip beside it carries the area's colour,
            glyph and name, so the colour never stands alone. */}
        <span className="font-semibold tabular-nums text-fg-primary">
          {reading(value.score, locale, 1, bands?.scale)}
        </span>
        {band !== null && bands !== null && <BandChip band={band} bands={bands} />}
      </div>
      <span className="text-sm text-fg-tertiary">
        {[
          value.surveyTitle,
          value.lowestOfMap ? t('actionPlans.next.finding.lowestOfMap') : t('actionPlans.next.finding.lowestOfRow', { scope }),
        ].join(' · ')}
      </span>
      <MoveLine move={move} />
      {openLink}
    </div>
  )
}

/**
 * Did the plan move the number?
 *
 * The one line that turns a measuring instrument into evidence that acting on it works —
 * the plan's own cell, as it read when the plan was raised and as it reads now. Every
 * number comes out of `planMove`, which reads the server's already-floored payload, so a
 * group too small to disclose has no score here to print.
 *
 * The three non-answers are deliberately three different sentences. "Nothing has closed
 * since" is the state every plan starts in and is not a failure; "the later waves withhold
 * this group" is a privacy outcome; and a plan with no recorded cell has nothing to say at
 * all, so it says nothing rather than inventing a baseline.
 */
function MoveLine({ move }: { move: Settled<PlanMove> }) {
  const { t, locale } = useTranslation()
  // The company's scale for the two readings and the move; 1–5 until it is read.
  const scale = useResultBands().bands?.scale ?? 'mean'
  if (move.status !== 'ready') return null
  const value = move.value
  if (value.status === 'none') return null
  if (value.status === 'awaiting') {
    return (
      <span className="text-sm text-fg-tertiary">{t('actionPlans.next.finding.moveAwaiting', { code: value.code })}</span>
    )
  }
  if (value.status === 'protected') {
    return (
      <span className="text-sm text-fg-tertiary">{t('actionPlans.next.finding.moveProtected', { code: value.code, floor: ANONYMITY_FLOOR })}</span>
    )
  }
  const delta = value.to - value.from
  // The sign carries the direction, in the label ink: ▲ and ▼ are the result areas' glyphs
  // and green and red their colours, so a move wears neither (ruling of 11 Nov).
  const flat = Math.abs(delta) < 0.05
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
      <span className="text-fg-secondary">{t('actionPlans.next.finding.moveLabel')}</span>
      <span className="tabular-nums text-fg-secondary">
        {t('actionPlans.next.finding.moveReading', {
          fromCode: value.fromCode,
          from: reading(value.from, locale, 1, scale),
          toCode: value.toCode,
          to: reading(value.to, locale, 1, scale),
        })}
      </span>
      {!flat && (
        <span data-slot="plan-move-delta" className="font-semibold tabular-nums text-fg-primary">
          {delta > 0 ? '+' : '\u2212'}
          {reading(Math.abs(delta), locale, 1, scale)}
        </span>
      )}
      {flat && <span className="text-fg-tertiary">{t('actionPlans.next.finding.moveFlat')}</span>}
    </span>
  )
}

function MeasuresCard({ model }: { model: ActionPlanDetailModel }) {
  const { t } = useTranslation()
  const { plan } = model
  const none = plan.kpis.length === 0 && plan.objectives.length === 0
  return (
    <CanvasCard title={t('actionPlans.next.measures.title')}>
      {plan.kpis.length === 0 ? (
        <div className="flex items-center gap-3">
          <IconBox className="text-fg-tertiary">
            <ChartColumn />
          </IconBox>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="font-semibold text-fg-primary">{t('actionPlans.next.measures.kpis')}</span>
            <span className="text-sm text-fg-tertiary">{t('actionPlans.noKpisDescription')}</span>
          </div>
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {plan.kpis.map((kpi) => {
            const percent = kpiProgressPercent(kpi.currentValue, kpi.targetValue)
            return (
              <li key={kpi.id} className="flex flex-wrap items-center gap-3">
                <IconBox>
                  <ChartColumn />
                </IconBox>
                <div className="flex min-w-48 flex-1 flex-col gap-1">
                  <span className="font-semibold text-fg-primary">{kpi.name}</span>
                  <span className="text-sm text-fg-tertiary">
                    {t('actionPlans.next.measures.kpiReading', { current: kpi.currentValue, target: kpi.targetValue, unit: kpi.unit })}
                  </span>
                </div>
                {percent === null ? (
                  <span className="text-sm text-fg-tertiary">{t('actionPlans.notApplicable')}</span>
                ) : (
                  <div className="flex w-40 items-center gap-2 max-sm:min-w-40 max-sm:flex-1">
                    <Progress value={percent} className="min-w-16 flex-1" aria-label={kpi.name} />
                    <span className="text-sm tabular-nums text-fg-secondary">
                      {t('actionPlans.percentValue', { percent: Math.round(percent) })}
                    </span>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {plan.objectives.length === 0 ? (
        <div className="flex items-center gap-3">
          <IconBox className="text-fg-tertiary">
            <Target />
          </IconBox>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="font-semibold text-fg-primary">{t('actionPlans.next.measures.objectives')}</span>
            <span className="text-sm text-fg-tertiary">{t('actionPlans.noObjectivesDescription')}</span>
          </div>
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {plan.objectives.map((objective) => (
            <li key={objective.id} className="flex flex-wrap items-center gap-3">
              <IconBox>
                <Target />
              </IconBox>
              <div className="flex min-w-48 flex-1 flex-col gap-1">
                <span className="font-semibold text-fg-primary">{objective.description}</span>
                <span className="text-sm text-fg-tertiary">{objective.successCriteria}</span>
              </div>
              <Chip label={statusWord(t, objective.currentStatus)} />
              <div className="flex w-40 items-center gap-2 max-sm:min-w-40 max-sm:flex-1">
                <Progress
                  value={Math.max(0, Math.min(100, objective.completionPercentage))}
                  className="min-w-16 flex-1"
                  aria-label={objective.description}
                />
                <span className="text-sm tabular-nums text-fg-secondary">
                  {t('actionPlans.percentValue', { percent: objective.completionPercentage })}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {none && <span className="text-sm text-fg-tertiary">{t('actionPlans.next.measures.footer')}</span>}
    </CanvasCard>
  )
}

/**
 * A log row: date, mark, entry, as the artboard draws them from 640px. Under it the 96px date
 * column left the entry ~130px at 390 ("Operaciones y / Logística · prioridad / alta"), so
 * the date moves to a small line above the entry and the entry takes the row beside the mark.
 */
const LOG_ROW =
  'grid grid-cols-[28px_minmax(0,1fr)] items-start gap-x-3 gap-y-0.5 border-t border-line-light py-2.5 sm:grid-cols-[96px_28px_minmax(0,1fr)] sm:gap-3'
const LOG_DATE = 'col-start-2 row-start-1 text-sm tabular-nums text-fg-tertiary sm:col-start-1 sm:pt-1.5'
const LOG_MARK =
  'col-start-1 row-span-2 row-start-1 inline-flex size-7 items-center justify-center rounded-full border border-line-default bg-surface-icon-box text-fg-secondary sm:col-start-2 sm:row-span-1'
const LOG_BODY = 'col-start-2 row-start-2 flex min-w-0 flex-col gap-0.5 sm:col-start-3 sm:row-start-1 sm:pt-1'

function LogCard({
  model,
  author,
  createdDay,
  scopeName,
  priorityWord,
  dueShort,
}: {
  model: ActionPlanDetailModel
  author: string | null
  createdDay: string | null
  scopeName: string | null
  priorityWord: string
  dueShort: string
}) {
  const { t, locale } = useTranslation()
  const history = model.history.status === 'ready' ? model.history.value : []
  const entries = 1 + history.length
  return (
    <CanvasCard
      title={t('actionPlans.next.log.title')}
      aside={
        model.history.status === 'ready'
          ? entries === 1
            ? t('actionPlans.next.log.entryOne')
            : t('actionPlans.next.log.entries', { count: entries })
          : undefined
      }
    >
      <ol className="m-0 flex list-none flex-col p-0">
        <li className={LOG_ROW}>
          <span className={LOG_DATE}>
            {createdDay ? calendarDay(Date.parse(`${createdDay}T00:00:00Z`), locale) : t('actionPlans.next.sheet.unknown')}
          </span>
          <span
            aria-hidden="true"
            className={cn(LOG_MARK, 'text-xs font-semibold')}
          >
            {author ? initials(author) : null}
          </span>
          <div className={LOG_BODY}>
            <span className="text-base text-fg-primary">
              {author ? (
                <>
                  {t('actionPlans.next.log.createdBy')} <b className="font-semibold">{author}</b>
                </>
              ) : (
                t('actionPlans.next.log.created')
              )}
            </span>
            <span className="text-sm text-fg-tertiary">
              {t('actionPlans.next.log.createdMeta', {
                scope: scopeName ?? t('actionPlans.next.companyWide'),
                priority: priorityWord,
                date: dueShort,
              })}
            </span>
          </div>
        </li>
        {history.map((update) => (
          <li key={update.id} className={LOG_ROW}>
            <span className={LOG_DATE}>
              {calendarDay(Date.parse(update.updateDate), locale)}
            </span>
            <span
              aria-hidden="true"
              className={LOG_MARK}
            >
              <Clock className="size-3.5" />
            </span>
            <div className={LOG_BODY}>
              <span className="text-base text-fg-primary">
                {update.updatedByName ? (
                  <>
                    {t('actionPlans.next.log.progressBy')} <b className="font-semibold">{update.updatedByName}</b>
                  </>
                ) : (
                  t('actionPlans.next.log.progress')
                )}
              </span>
              <span className="break-words text-sm text-fg-tertiary">{update.overallNotes}</span>
            </div>
          </li>
        ))}
      </ol>
      {model.history.status === 'loading' && (
        <p className="m-0 text-sm text-fg-tertiary">{t('actionPlans.next.log.historyLoading')}</p>
      )}
      {model.history.status === 'failed' && (
        <p className="m-0 text-sm text-fg-tertiary">{t('actionPlans.next.log.historyFailed')}</p>
      )}
      <Note icon={<Clock />} className="text-fg-secondary">
        <span>
          {t('actionPlans.next.log.noteBefore')} <b className="font-semibold text-fg-primary">{t('actionPlans.next.log.noteAction')}</b>
          {t('actionPlans.next.log.noteAfter')}
        </span>
      </Note>
    </CanvasCard>
  )
}
