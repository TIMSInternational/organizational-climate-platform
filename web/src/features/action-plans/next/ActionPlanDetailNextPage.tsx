import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowRight, ChartColumn, ChevronDown, Clock, Ellipsis, Plus, Target } from 'lucide-react'
import { useTranslation, type TranslateFn } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { CanvasCard, FactList, HatchTag, IconBox, NoteBand, PageMeta } from '../../../components/canvas'
import {
  Alert,
  AlertDescription,
  Button,
  Chip,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  EmptyState,
  LoadingRegion,
  NetworkError,
  Progress,
  SkeletonText,
  type ChipTone,
} from '../../../components/ui'
import { useCompanyScope } from '../../../company-context'
import { useViewerCapabilities } from '../../../auth/viewerCapabilities'
import { calendarDay, calendarDayLong } from '../../../lib/calendarDay'
import { cn } from '../../../lib/cn'
import { dimensionLabel } from '../../surveys/dimensionLabel'
import { reading, targetStanding } from '../../dashboard/next/derive'
import { CLIMATE_TARGET } from '../../dashboard/next/compose'
import ProgressUpdateForm from '../components/ProgressUpdateForm'
import { ACTION_PLAN_PRIORITIES, ACTION_PLAN_STATUSES, kpiProgressPercent, priorityLabel, statusLabel } from '../actionPlanVocabulary'
import { daysToDue, dueDay, elapsedShare, type PlanFinding } from './derive'
import type { ActionPlanDetailModel, Settled } from './model'
import { useActionPlanDetailModel, type ActionPlanDetailState } from './useActionPlanDetailModel'

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
  // `GET /action-plans/{id}` answers an administrator only (`CanAccessCompany`), so any
  // other role meets the page's own refusal and the request is never sent.
  const readable = scope.isSuperAdmin || scope.role === 'company_admin'
  const state = useActionPlanDetailModel(id, readable)

  if (!readable) {
    return <EmptyState title={t('actionPlans.accessRestricted')} description={t('actionPlans.noPermissionMessage')} />
  }
  if (state.status === 'error') {
    return (
      <NetworkError
        title={t('errors.generic')}
        description={state.error ?? undefined}
        onRetry={state.reload}
        retryText={t('common.retry')}
      />
    )
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

const STATUS_TONE: Record<string, ChipTone> = {
  not_started: 'neutral',
  in_progress: 'accent',
  completed: 'good',
  overdue: 'critical',
  cancelled: 'neutral',
}

/** The board's sentence-case status ("No iniciado"); the server's own word for one it does not know. */
function statusWord(t: TranslateFn, status: string): string {
  const key = STATUS_KEY[status]
  return key ? t(key) : statusLabel(t, status)
}

function priorityTone(priority: string): ChipTone {
  return priority === 'high' || priority === 'critical' ? 'warning' : 'neutral'
}

/** A plan that is over: its due date no longer counts down. */
const SETTLED = new Set(['completed', 'cancelled'])

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
  const [progressOpen, setProgressOpen] = useState(false)

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
      ? t('actionPlans.next.due.future', { date: dueLong, days })
      : days === 1
        ? t('actionPlans.next.due.tomorrow', { date: dueLong })
        : days === 0
          ? t('actionPlans.next.due.today', { date: dueLong })
          : days === -1
            ? t('actionPlans.next.due.yesterday', { date: dueLong })
            : t('actionPlans.next.due.past', { date: dueLong, days: -days })

  return (
    <div>
      <PageTopBar
        title={plan.title}
        eyebrow={scopeName ? t('actionPlans.next.eyebrow', { scope: scopeName }) : t('actionPlans.next.eyebrowPlain')}
        breadcrumbs={[{ label: t('navigation.actionPlans'), href: '/action-plans' }, { label: plan.title }]}
        meta={
          <PageMeta>
            <Chip label={statusWord(t, plan.status)} tone={STATUS_TONE[plan.status] ?? 'neutral'} />
            <Chip label={t('actionPlans.next.priorityChip', { priority: priorityWord })} tone={priorityTone(plan.priority)} />
            <span className={cn(!settled && days < 0 && 'text-accent-red-ink')}>{dueSentence}</span>
          </PageMeta>
        }
        actions={
          manages ? (
            <>
              <Button variant="primary" onClick={() => setProgressOpen(true)}>
                <Plus aria-hidden="true" />
                {t('actionPlans.next.recordProgress')}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" disabled={state.saving}>
                    {t('actionPlans.next.changeStatus')}
                    <ChevronDown aria-hidden="true" className="text-fg-light" />
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
                  <Button variant="outline" size="icon" disabled={state.saving} aria-label={t('actionPlans.next.moreActions')}>
                    <Ellipsis aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>{t('actionPlans.next.priorityMenu')}</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={plan.priority} onValueChange={(next) => void state.changePriority(next)}>
                    {ACTION_PLAN_PRIORITIES.map((priority) => (
                      <DropdownMenuRadioItem key={priority} value={priority}>
                        {priorityLabel(t, priority)}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
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
          <WhatCard model={model} scopeName={scopeName} />
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
                        <ArrowRight aria-hidden="true" className="size-3 text-fg-light" />
                      </Link>
                    ) : (
                      <span className="text-fg-tertiary">{t('actionPlans.next.sheet.unknown')}</span>
                    ),
                },
                {
                  id: 'priority',
                  term: t('actionPlans.next.sheet.priority'),
                  value: <Chip label={priorityLabel(t, plan.priority)} tone={priorityTone(plan.priority)} />,
                },
                {
                  id: 'status',
                  term: t('actionPlans.next.sheet.status'),
                  value: <Chip label={statusWord(t, plan.status)} tone={STATUS_TONE[plan.status] ?? 'neutral'} />,
                },
                {
                  id: 'created',
                  term: t('actionPlans.next.sheet.created'),
                  value: createdDay ? (
                    <span className="font-mono tabular-nums">{dayWithYear(createdDay, locale)}</span>
                  ) : (
                    <span className="text-fg-tertiary">{t('actionPlans.next.sheet.unknown')}</span>
                  ),
                },
                {
                  id: 'due',
                  term: t('actionPlans.next.sheet.due'),
                  value: <span className="font-mono tabular-nums">{dayWithYear(due, locale)}</span>,
                },
                {
                  id: 'template',
                  term: t('actionPlans.next.sheet.template'),
                  value: (
                    <span className={cn(valueOf(model.templateName) ? 'text-fg-primary' : 'text-fg-tertiary')}>
                      {valueOf(model.templateName) ?? t('actionPlans.next.sheet.noTemplate')}
                    </span>
                  ),
                },
              ]}
            />
          </CanvasCard>
          <NoteBand roomy>{t('actionPlans.next.guard')}</NoteBand>
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
    </div>
  )
}

function Box({ label, value, note }: { label: string; value: ReactNode; note: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg bg-surface-outer px-3 py-2.5">
      <span className="text-2xs font-bold uppercase tracking-label text-fg-label">{label}</span>
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
        <span className={cn('shrink-0 font-mono text-[2.5rem] leading-none tabular-nums', late ? 'text-accent-red-ink' : 'text-fg-primary')}>
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
        <div className="relative h-2 rounded-md bg-surface-icon-box">
          <div className="absolute inset-y-0 left-0 rounded-md bg-line-default" style={{ width: `${share * 100}%` }} />
          <div
            aria-hidden="true"
            className="absolute -top-1 h-4 w-0.5 bg-fg-primary"
            style={{ left: `calc(${share * 100}% - ${share * 2}px)` }}
          />
          <div aria-hidden="true" className="absolute -top-1 right-0 h-4 w-0.5 bg-line-hover" />
        </div>
        <div className="flex justify-between gap-3 text-xs text-fg-tertiary">
          <span className="font-mono tabular-nums text-fg-primary">
            {createdDay
              ? t(createdIsToday ? 'actionPlans.next.deadline.todayMark' : 'actionPlans.next.deadline.createdMark', {
                  date: calendarDay(Date.parse(`${createdDay}T00:00:00Z`), locale),
                })
              : t('actionPlans.next.deadline.todayMark', { date: calendarDay(Date.parse(`${asOf}T00:00:00Z`), locale) })}
          </span>
          <span className="font-mono tabular-nums">{t('actionPlans.next.deadline.dueMark', { date: dueShort })}</span>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Box
          label={t('actionPlans.next.deadline.createdLabel')}
          value={
            <span className="font-mono text-lg tabular-nums text-fg-primary">
              {createdDay ? dayWithYear(createdDay, locale) : t('actionPlans.next.sheet.unknown')}
            </span>
          }
          note={author ? t('actionPlans.next.deadline.by', { name: author }) : t('actionPlans.next.deadline.byUnknown')}
        />
        <Box
          label={t('actionPlans.next.deadline.dueLabel')}
          value={<span className="font-mono text-lg tabular-nums text-fg-primary">{dayWithYear(dueDay(plan.dueDate), locale)}</span>}
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
  return <span className="pt-0.75 text-2xs font-bold uppercase tracking-label text-fg-label">{children}</span>
}

function WhatCard({ model, scopeName }: { model: ActionPlanDetailModel; scopeName: string | null }) {
  const { t } = useTranslation()
  const { plan } = model
  return (
    <CanvasCard title={t('actionPlans.next.what.title')}>
      <div className="grid grid-cols-[136px_minmax(0,1fr)] gap-x-4 gap-y-3 text-base">
        <Label>{t('actionPlans.next.what.what')}</Label>
        <p className="m-0 text-fg-primary">{plan.title}</p>
        <Label>{t('actionPlans.next.what.why')}</Label>
        <p className={cn('m-0', plan.description.trim() ? 'text-fg-primary' : 'text-fg-tertiary')}>
          {plan.description.trim() || t('actionPlans.next.what.noWhy')}
        </p>
        <div className="flex flex-col items-start gap-1.5">
          <Label>{t('actionPlans.next.what.origin')}</Label>
          <Chip label={t('actionPlans.next.proposed')} tone="warning" title={t('actionPlans.next.proposedHint')} />
        </div>
        <FindingBlock finding={model.finding} scopeName={scopeName} />
      </div>
    </CanvasCard>
  )
}

const STANDING_KEY = {
  below: 'actionPlans.next.finding.below',
  on: 'actionPlans.next.finding.on',
  above: 'actionPlans.next.finding.above',
} as const

function FindingBlock({ finding, scopeName }: { finding: Settled<PlanFinding>; scopeName: string | null }) {
  const { t, locale } = useTranslation()
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
      <ArrowRight aria-hidden="true" className="size-3 text-fg-light" />
    </Link>
  )
  if (value.status === 'protected') {
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Chip label={scope} />
          <HatchTag label={t('actionPlans.next.finding.protected')} />
        </div>
        <span className="text-sm text-fg-tertiary">
          {t('actionPlans.next.finding.protectedNote', { survey: value.surveyTitle, scope })}
        </span>
        {openLink}
      </div>
    )
  }
  const standing = targetStanding(value.score, CLIMATE_TARGET)
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Chip label={scope} />
        <span className="font-medium text-fg-primary">{dimensionLabel(value.dimensionKey, t)}</span>
        <span className={cn('font-mono font-semibold tabular-nums', standing === 'below' ? 'text-accent-red-ink' : 'text-fg-primary')}>
          {reading(value.score, locale)}
        </span>
        <Chip
          label={t(STANDING_KEY[standing])}
          tone={standing === 'below' ? 'critical' : standing === 'above' ? 'good' : 'neutral'}
        />
      </div>
      <span className="text-sm text-fg-tertiary">
        {[
          value.surveyTitle,
          value.lowestOfMap ? t('actionPlans.next.finding.lowestOfMap') : t('actionPlans.next.finding.lowestOfRow', { scope }),
          t('actionPlans.next.finding.target', { target: reading(CLIMATE_TARGET, locale) }),
        ].join(' · ')}
      </span>
      {openLink}
    </div>
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
          <IconBox className="text-fg-light">
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
              <li key={kpi.id} className="flex items-center gap-3">
                <IconBox>
                  <ChartColumn />
                </IconBox>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-semibold text-fg-primary">{kpi.name}</span>
                  <span className="text-sm text-fg-tertiary">
                    {t('actionPlans.next.measures.kpiReading', { current: kpi.currentValue, target: kpi.targetValue, unit: kpi.unit })}
                  </span>
                </div>
                {percent === null ? (
                  <span className="text-sm text-fg-tertiary">{t('actionPlans.notApplicable')}</span>
                ) : (
                  <div className="flex w-40 items-center gap-2">
                    <Progress value={percent} className="min-w-16 flex-1" aria-label={kpi.name} />
                    <span className="font-mono text-sm tabular-nums text-fg-secondary">
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
          <IconBox className="text-fg-light">
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
            <li key={objective.id} className="flex items-center gap-3">
              <IconBox>
                <Target />
              </IconBox>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="font-semibold text-fg-primary">{objective.description}</span>
                <span className="text-sm text-fg-tertiary">{objective.successCriteria}</span>
              </div>
              <Chip label={statusWord(t, objective.currentStatus)} tone={STATUS_TONE[objective.currentStatus] ?? 'neutral'} />
              <div className="flex w-40 items-center gap-2">
                <Progress
                  value={Math.max(0, Math.min(100, objective.completionPercentage))}
                  className="min-w-16 flex-1"
                  aria-label={objective.description}
                />
                <span className="font-mono text-sm tabular-nums text-fg-secondary">
                  {t('actionPlans.percentValue', { percent: objective.completionPercentage })}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {none && <span className="text-sm text-fg-light">{t('actionPlans.next.measures.footer')}</span>}
    </CanvasCard>
  )
}

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
  const entries = 1 + model.recorded.length
  return (
    <CanvasCard
      title={t('actionPlans.next.log.title')}
      aside={entries === 1 ? t('actionPlans.next.log.entryOne') : t('actionPlans.next.log.entries', { count: entries })}
    >
      <ol className="m-0 flex list-none flex-col p-0">
        <li className="grid grid-cols-[96px_28px_minmax(0,1fr)] items-start gap-3 border-t border-line-light py-2.5">
          <span className="pt-1.5 font-mono text-sm tabular-nums text-fg-tertiary">
            {createdDay ? calendarDay(Date.parse(`${createdDay}T00:00:00Z`), locale) : t('actionPlans.next.sheet.unknown')}
          </span>
          <span
            aria-hidden="true"
            className="inline-flex size-7 items-center justify-center rounded-full border border-line-default bg-surface-icon-box text-xs font-semibold text-fg-secondary"
          >
            {author ? initials(author) : null}
          </span>
          <div className="flex min-w-0 flex-col gap-0.5 pt-1">
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
        {model.recorded.map((update) => (
          <li key={update.id} className="grid grid-cols-[96px_28px_minmax(0,1fr)] items-start gap-3 border-t border-line-light py-2.5">
            <span className="pt-1.5 font-mono text-sm tabular-nums text-fg-tertiary">
              {calendarDay(Date.parse(update.updateDate), locale)}
            </span>
            <span
              aria-hidden="true"
              className="inline-flex size-7 items-center justify-center rounded-full border border-line-default bg-surface-icon-box text-fg-secondary"
            >
              <Clock className="size-3.5" />
            </span>
            <div className="flex min-w-0 flex-col gap-0.5 pt-1">
              <span className="text-base text-fg-primary">{t('actionPlans.next.log.progress')}</span>
              <span className="break-words text-sm text-fg-tertiary">{update.overallNotes}</span>
            </div>
          </li>
        ))}
      </ol>
      <p className="m-0 flex items-center gap-3 rounded-lg border border-dashed border-line-default p-3 text-base text-fg-tertiary">
        <Clock aria-hidden="true" className="size-4 shrink-0 text-fg-light" />
        <span>
          {t('actionPlans.next.log.noteBefore')} <b className="font-semibold text-fg-primary">{t('actionPlans.next.log.noteAction')}</b>
          {t('actionPlans.next.log.noteAfter')}
        </span>
      </p>
    </CanvasCard>
  )
}
