import { useState, type ReactNode } from 'react'
import { AlertCircle, Check, ClipboardList, Clock, Copy, Mail, Send, ShieldCheck } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { PageTopBar } from '../../../../components/layout'
import {
  Alert,
  AlertDescription,
  Button,
  Chip,
  ConfirmationDialog,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  ErrorState,
  LoadingRegion,
  SkeletonText,
} from '../../../../components/ui'
import { ANONYMITY_FLOOR } from '../../../../components/charts'
import { AudienceSelector, audienceSelection, estimateAudience, type AudienceMode } from '../../../../components/distribution'
import { useTranslation } from '../../../../i18n'
import { cn } from '../../../../lib/cn'
import { canDistribute } from '../../api/surveyInvitationCopy'
import { isKnownInvitationStatus } from '../../api/surveyDistribution'
import { IconBox, TH_CLASS } from '../../../shared-next/parts'
import { Card, Meter, ReadingTile, dayMonth } from './parts'
import {
  absoluteLink,
  daysFrom,
  invitationBuckets,
  launchChecklist,
  maskedLink,
  readySteps,
  remindersSent,
  responseRate,
  targetedDepartments,
  type LaunchStepState,
} from './launch'
import { useDistributionModel, type DistributionModel } from './useDistributionModel'

/** How many invitation rows the checklist shows before "Ver las n". */
export const INVITATION_PREVIEW_ROWS = 4

/**
 * Distribución, redesigned (canvas board "Distribution") — `/surveys/:surveyId/distribution`.
 *
 * A launch checklist: who the survey reaches, the share link, the invitations that went out and
 * the reminders — each a step that is met or names what is missing — closed by the sentence the
 * server writes about what this survey records (`anonymity.guarantee`, in the reader's language).
 * Every write is the previous page's (`pages/SurveyDistributionPage.tsx`, the wiring reference),
 * offered only to an administrator of the survey's own company.
 */
export default function SurveyDistributionNextPage() {
  const { surveyId = '' } = useParams()
  const { t } = useTranslation()
  const model = useDistributionModel(surveyId)
  const { state } = model

  if (state.status === 'loading') {
    return (
      <LoadingRegion loading label={t('common.loading')}>
        <SkeletonText lines={8} />
      </LoadingRegion>
    )
  }
  if (state.status === 'error') {
    return (
      <ErrorState
        title={t('surveys.distribution.loadFailed')}
        description={state.message}
        action={
          <Button variant="outline" onClick={() => void model.reload()}>
            {t('common.retry')}
          </Button>
        }
      />
    )
  }
  return (
    <DistributionView
      model={state.model}
      busy={model.busy}
      notice={model.notice}
      actionError={model.actionError}
      onInvite={(selection) => void model.invite(selection)}
      onRemind={() => void model.remind()}
      onCreateLink={() => void model.createLink()}
    />
  )
}

export function DistributionView({
  model,
  busy,
  notice,
  actionError,
  onInvite,
  onRemind,
  onCreateLink,
  now = new Date(),
}: {
  model: DistributionModel
  busy: boolean
  notice: string | null
  actionError: string | null
  onInvite: (selection: NonNullable<ReturnType<typeof audienceSelection>>) => void
  onRemind: () => void
  onCreateLink: () => void
  now?: Date
}) {
  const { t, locale } = useTranslation()
  const copy = (key: string, vars?: Record<string, string | number>) => t(`surveys.next.distribution.${key}`, vars)
  const { survey, distribution, invitations, departments, users, scoped } = model
  const title = survey.title ?? t('surveys.untitled')
  const [mode, setMode] = useState<AudienceMode>('allTargeted')
  const [selectedDepartmentIds, setSelectedDepartmentIds] = useState<string[]>([])
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])
  const [audienceOpen, setAudienceOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [copied, setCopied] = useState(false)

  const actionable = scoped && canDistribute(survey.status)
  // The audience the server would resolve for the survey as targeted — `ResolveAudienceAsync`,
  // mirrored by `estimateAudience`. Unknown (null), never 0, for a viewer who cannot read users.
  const audience = scoped ? estimateAudience('allTargeted', users, [], [], survey.departmentIds).length : null
  const recipients = estimateAudience(mode, users, selectedDepartmentIds, selectedUserIds, survey.departmentIds).length
  const selection = audienceSelection(mode, selectedDepartmentIds, selectedUserIds)
  const summary = invitations.summary
  const buckets = invitationBuckets(summary)
  const reminders = remindersSent(invitations.invitations)
  const steps = launchChecklist({ audience, publicLink: distribution?.publicLink ?? null, summary, reminders })
  const ready = readySteps(steps)
  const firstMissing = steps.find((step) => step.state === 'missing')
  const rate = responseRate(survey.responseCount, survey.targetAudienceCount)
  const closesIn = daysFrom(survey.endDate, now)
  const targets = targetedDepartments(survey.departmentIds, scoped ? departments : null)
  const stateOf = (id: string): LaunchStepState => steps.find((step) => step.id === id)?.state ?? 'missing'
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const userById = new Map(users.map((user) => [user.id, user]))
  const departmentName = new Map(departments.map((department) => [department.id, department.name]))
  const rows = showAll ? invitations.invitations : invitations.invitations.slice(0, INVITATION_PREVIEW_ROWS)
  const reach = summary.total > 0 ? summary.total : audience

  return (
    <div>
      <PageTopBar
        title={copy('title')}
        eyebrow={title}
        description={copy('description')}
        breadcrumbs={[
          { label: t('navigation.surveys'), href: '/surveys' },
          { label: title, href: `/surveys/${survey.id}` },
          { label: copy('title') },
        ]}
        actions={
          <Button asChild variant="outline">
            <Link to={`/surveys/${survey.id}`}>
              <ClipboardList aria-hidden="true" className="size-icon" />
              {copy('openSurvey')}
            </Link>
          </Button>
        }
      />

      {actionError && (
        <Alert variant="destructive" role="alert" className="mb-5">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <p role="status" className="mb-5 mt-0 text-sm text-fg-secondary">
          {notice}
        </p>
      )}

      <section aria-label={copy('readings')} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ReadingTile
          testId="tile-reach"
          label={copy('reach')}
          value={reach}
          unit={summary.total > 0 ? copy('reachInvited') : copy('reachAudience')}
        />
        <ReadingTile
          testId="tile-responses"
          label={copy('responses')}
          value={survey.responseCount}
          unit={rate === null ? copy('responsesNoTarget') : copy('responsesOf', { target: survey.targetAudienceCount ?? 0, rate })}
        >
          {rate !== null && <Meter percent={rate} label={copy('responses')} />}
        </ReadingTile>
        <ReadingTile
          testId="tile-closes"
          label={closesIn !== null && closesIn < 0 ? copy('closed') : copy('closes')}
          value={dayMonth(survey.endDate, locale)}
          unit={
            closesIn === null
              ? undefined
              : closesIn === 0
                ? copy('closesToday')
                : closesIn === 1
                  ? copy('closesTomorrow')
                  : closesIn > 1
                    ? copy('closesIn', { days: closesIn })
                    : copy('closedAgo', { days: Math.abs(closesIn) })
          }
        />
        <ReadingTile testId="tile-ready" label={copy('ready')} value={ready} unit={copy('readyOf', { count: steps.length })}>
          <span className={cn('text-sm', firstMissing ? 'text-accent-amber-ink' : 'text-chip-good-ink')}>
            {firstMissing ? copy(`missing.${firstMissing.id}`) : copy('allReady')}
          </span>
        </ReadingTile>
      </section>

      <section aria-labelledby="launch-checklist" className="mt-6 flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="launch-checklist" className="m-0 text-2xl">
            {copy('checklist')}
          </h2>
          <span className="text-sm text-fg-secondary">{copy('checklistAside', { count: steps.length })}</span>
        </div>

        <Step
          testId="step-audience"
          state={stateOf('audience')}
          title={stateOf('audience') === 'done' ? copy('audienceTitle') : copy('audienceMissingTitle')}
          action={
            actionable && (
              <Button type="button" variant="outline" disabled={busy} onClick={() => setAudienceOpen(true)}>
                {copy('changeAudience')}
              </Button>
            )
          }
        >
          <p className="m-0 text-sm text-fg-secondary">
            {audience === null
              ? t('surveys.distribution.outOfScope')
              : survey.departmentIds.length === 0
                ? copy('audienceCompany', { people: audience })
                : copy(survey.departmentIds.length === 1 ? 'audienceOne' : 'audienceLine', {
                    count: survey.departmentIds.length,
                    people: audience,
                    names: joinNames(targets.names, copy('and')),
                  })}
          </p>
        </Step>

        <Step
          testId="step-link"
          state={stateOf('link')}
          title={copy('linkTitle')}
          action={
            distribution?.publicLink == null &&
            actionable && (
              <Button type="button" variant="outline" disabled={busy} onClick={onCreateLink}>
                {copy('createLink')}
              </Button>
            )
          }
        >
          {distribution?.publicLink ? (
            <>
              <div className="flex max-w-140 items-center gap-2">
                <div className="flex h-8 min-w-0 flex-1 items-center overflow-hidden text-ellipsis whitespace-nowrap rounded border border-line-default bg-surface-card px-2.5 font-mono text-sm text-fg-primary">
                  {maskedLink(distribution.publicLink, origin)}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={copied ? copy('copied') : copy('copyLink')}
                  onClick={() => {
                    const link = distribution.publicLink
                    if (link) void navigator.clipboard?.writeText(absoluteLink(link, origin)).then(() => setCopied(true))
                  }}
                >
                  <Copy aria-hidden="true" className="size-icon" />
                </Button>
              </div>
              <p className="m-0 text-sm text-fg-secondary">
                {distribution.accessRules.requireLogin ? copy('linkHelpLogin') : copy('linkHelpOpen')}
              </p>
            </>
          ) : (
            <p className="m-0 text-sm text-fg-secondary">{copy('noLink')}</p>
          )}
        </Step>

        <Step
          testId="step-invitations"
          state={stateOf('invitations')}
          title={copy('invitationsTitle')}
          action={
            actionable && (
              <Button type="button" variant="outline" disabled={busy || audience === 0} onClick={() => { setMode('allTargeted'); setConfirming(true) }}>
                <Mail aria-hidden="true" className="size-icon" />
                {copy('sendInvitations')}
              </Button>
            )
          }
        >
          <div className="grid gap-2.5 sm:grid-cols-3">
            <Bucket label={copy('left')} value={buckets.left} />
            <Bucket label={copy('pending')} value={buckets.pending} warn={buckets.pending > 0} />
            <Bucket label={copy('revoked')} value={buckets.revoked} warn={buckets.revoked > 0} />
          </div>
          {invitations.invitations.length === 0 ? (
            <p className="m-0 text-sm text-fg-secondary">{copy('invitationsNone')}</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-line-light">
              <table className="w-full min-w-[36rem] border-collapse text-sm">
                <thead className="bg-surface-icon-box">
                  <tr>
                    <th scope="col" className={TH_CLASS}>{copy('person')}</th>
                    <th scope="col" className={TH_CLASS}>{copy('email')}</th>
                    <th scope="col" className={TH_CLASS}>{copy('department')}</th>
                    <th scope="col" className={TH_CLASS}>{copy('state')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((invitation) => {
                    const person = userById.get(invitation.userId)
                    return (
                      <tr key={invitation.id} className="border-t border-line-light">
                        <td className="px-3 py-2 font-medium">{person?.name ?? '—'}</td>
                        <td className="px-3 py-2 font-mono text-xs text-fg-secondary">{invitation.email}</td>
                        <td className="px-3 py-2 text-fg-secondary">
                          {person?.departmentId ? (departmentName.get(person.departmentId) ?? '—') : '—'}
                        </td>
                        <td className="px-3 py-2">
                          <Chip
                            tone={invitation.status === 'revoked' || invitation.status === 'pending' ? 'warning' : 'neutral'}
                            label={
                              isKnownInvitationStatus(invitation.status)
                                ? t(`surveys.distribution.status.${invitation.status}`)
                                : invitation.status
                            }
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {invitations.invitations.length > INVITATION_PREVIEW_ROWS && (
                <p className="m-0 border-t border-line-light px-3 py-2 text-sm text-fg-secondary">
                  {!showAll && `${copy('more', { count: invitations.invitations.length - INVITATION_PREVIEW_ROWS })} · `}
                  <Button type="button" variant="link" className="h-auto p-0 text-sm" onClick={() => setShowAll(!showAll)}>
                    {showAll ? copy('seeFewer') : copy('seeAll', { count: invitations.invitations.length })}
                  </Button>
                </p>
              )}
            </div>
          )}
        </Step>

        <Step
          testId="step-reminders"
          state={stateOf('reminders')}
          title={copy('remindersTitle')}
          action={
            actionable && (
              <Button type="button" variant="primary" disabled={busy || summary.total === 0} onClick={onRemind}>
                <Send aria-hidden="true" className="size-icon" />
                {copy('sendReminder')}
              </Button>
            )
          }
        >
          <p className="m-0 text-sm text-fg-secondary">
            {reminders === null || reminders === 0
              ? copy('remindersNone', { days: survey.settings.notificationReminderFrequencyDays })
              : copy('remindersSome', { count: reminders, days: survey.settings.notificationReminderFrequencyDays })}
          </p>
        </Step>

        <div
          data-testid="guarantee"
          className="flex items-start gap-3.5 rounded-lg border border-accent-green-ring bg-chip-good-fill px-5 py-4"
        >
          <IconBox>
            <ShieldCheck />
          </IconBox>
          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="m-0 text-2xs font-bold uppercase tracking-eyebrow text-chip-good-ink">
              {invitations.anonymity.anonymous ? copy('guaranteeAnonymous') : copy('guaranteeRecorded')}
            </p>
            <p className="m-0 font-serif text-lg leading-snug text-fg-primary">{invitations.anonymity.guarantee}</p>
            <p className="m-0 text-sm text-fg-secondary">{copy('guaranteeSub', { floor: ANONYMITY_FLOOR })}</p>
          </div>
        </div>
      </section>

      <Dialog open={audienceOpen} onOpenChange={setAudienceOpen}>
        <DialogContent closeLabel={t('common.close')}>
          <DialogHeader>
            <DialogTitle>{copy('changeAudience')}</DialogTitle>
          </DialogHeader>
          <AudienceSelector
            mode={mode}
            onModeChange={setMode}
            selectedDepartmentIds={selectedDepartmentIds}
            onDepartmentsChange={setSelectedDepartmentIds}
            selectedUserIds={selectedUserIds}
            onUsersChange={setSelectedUserIds}
            departments={departments}
            users={users}
            surveyDepartmentIds={survey.departmentIds}
            disabled={busy}
          />
          <div className="flex justify-end">
            <Button
              type="button"
              variant="primary"
              disabled={busy || selection === null || recipients === 0}
              onClick={() => {
                setAudienceOpen(false)
                setConfirming(true)
              }}
            >
              {t('surveys.distribution.sendInvitations')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('surveys.distribution.confirmTitle')}
        description={t('surveys.distribution.confirmBody', { count: recipients })}
        confirmText={t('surveys.distribution.sendInvitations')}
        cancelText={t('common.cancel')}
        onConfirm={() => {
          setConfirming(false)
          if (selection !== null) onInvite(selection)
        }}
      />
    </div>
  )
}

function joinNames(names: string[], and: string): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} ${and} ${names[names.length - 1]}`
}

function Step({
  state,
  title,
  action,
  children,
  testId,
}: {
  state: LaunchStepState
  title: string
  action?: ReactNode
  children: ReactNode
  testId: string
}) {
  return (
    <Card data-testid={testId} data-state={state} className="flex flex-wrap items-start gap-3.5 px-5 py-4 sm:flex-nowrap">
      <span
        aria-hidden="true"
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-full border [&>svg]:size-3.5',
          state === 'done' && 'border-accent-green-ring bg-chip-good-fill text-chip-good-ink',
          state === 'missing' && 'border-accent-amber-ring bg-chip-warning-fill text-chip-warning-ink',
          state === 'idle' && 'border-line-default bg-surface-icon-box text-fg-secondary',
        )}
      >
        {state === 'done' ? <Check /> : state === 'missing' ? <AlertCircle /> : <Clock />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h3 className="m-0 text-base font-semibold text-fg-primary">{title}</h3>
        {children}
      </div>
      {action && <div className="flex flex-none items-center gap-2">{action}</div>}
    </Card>
  )
}

function Bucket({ label, value, warn = false }: { label: string; value: number; warn?: boolean }) {
  return (
    <div
      className={cn(
        'flex flex-col gap-0.5 rounded-md border px-3 py-2.5',
        warn ? 'border-accent-amber-ring bg-chip-warning-fill' : 'border-line-light',
      )}
    >
      <span className={cn('text-2xs font-bold uppercase tracking-wider', warn ? 'text-chip-warning-ink' : 'text-fg-label')}>{label}</span>
      <span className={cn('font-mono text-2xl leading-tight tabular-nums', warn ? 'text-chip-warning-ink' : 'text-fg-primary')}>{value}</span>
    </div>
  )
}
