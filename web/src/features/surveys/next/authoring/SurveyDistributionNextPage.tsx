import { useState, type ReactNode } from 'react'
import { AlertCircle, Check, ClipboardList, Clock, HelpCircle, Mail, MoreHorizontal, Send, ShieldCheck } from 'lucide-react'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  ErrorState,
  LoadingRegion,
  SkeletonText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../components/ui'
import { ANONYMITY_FLOOR } from '../../../../components/charts'
import {
  AudienceSelector,
  InvitationCopyEditor,
  audienceSelection,
  estimateAudience,
  type AudienceMode,
} from '../../../../components/distribution'
import { useTranslation } from '../../../../i18n'
import { cn } from '../../../../lib/cn'
import { canDistribute } from '../../api/surveyInvitationCopy'
import { isKnownInvitationStatus } from '../../api/surveyDistribution'
import ShareLinkQr from '../../components/ShareLinkQr'
import { IconBox, TH_CLASS } from '../../../shared-next/parts'
import { Card, Meter, ReadingTile, ShareLinkField, WithReading, type ShareLinkAction } from './parts'
import {
  INVITATION_COLUMNS,
  MAX_REMINDERS,
  dayMonth,
  daysFrom,
  invitationBuckets,
  launchChecklist,
  nextReminder,
  readySteps,
  remindersSent,
  responseRate,
  surveyAudience,
  targetedDepartments,
  type LaunchStepState,
  type ReminderOutlook,
} from './launch'
import {
  useDistributionModel,
  type DistributionActions,
  type DistributionModel,
  type InvitationCopyState,
} from './useDistributionModel'

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
      busyInvitationId={model.busyInvitationId}
      notice={model.notice}
      actionError={model.actionError}
      copyState={model.copy}
      actions={model.actions}
    />
  )
}

export function DistributionView({
  model,
  busy,
  busyInvitationId = null,
  notice,
  actionError,
  copyState = { status: 'idle' },
  actions,
  now = new Date(),
}: {
  model: DistributionModel
  busy: boolean
  busyInvitationId?: string | null
  notice: string | null
  actionError: string | null
  copyState?: InvitationCopyState
  actions: DistributionActions
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
  const [linkConfirm, setLinkConfirm] = useState<'regenerate' | 'revoke' | null>(null)
  const [qrOpen, setQrOpen] = useState(false)
  const [copyOpen, setCopyOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const actionable = scoped && canDistribute(survey.status)
  // The audience the server would resolve for the survey as targeted — `ResolveAudienceAsync`,
  // mirrored by `estimateAudience`. Unknown (null), never 0, for a viewer who cannot read users.
  const resolved = scoped ? estimateAudience('allTargeted', users, [], [], survey.departmentIds).length : null
  const recipients = estimateAudience(mode, users, selectedDepartmentIds, selectedUserIds, survey.departmentIds).length
  const selection = audienceSelection(mode, selectedDepartmentIds, selectedUserIds)
  const summary = invitations.summary
  const buckets = invitationBuckets(summary)
  const reminders = remindersSent(invitations.invitations)
  const steps = launchChecklist({ audience: resolved, publicLink: distribution?.publicLink ?? null, summary, reminders })
  const ready = readySteps(steps)
  const firstMissing = steps.find((step) => step.state === 'missing')
  const firstUnknown = steps.find((step) => step.state === 'unknown')
  const closesIn = daysFrom(survey.endDate, now)
  const targets = targetedDepartments(survey.departmentIds, scoped ? departments : null)
  const stateOf = (id: string): LaunchStepState => steps.find((step) => step.id === id)?.state ?? 'missing'
  const userById = new Map(users.map((user) => [user.id, user]))
  const departmentName = new Map(departments.map((department) => [department.id, department.name]))
  const rows = showAll ? invitations.invitations : invitations.invitations.slice(0, INVITATION_PREVIEW_ROWS)
  // ONE audience, shared with the detail page (`surveyAudience`): the invited once invitations
  // exist, the directory's resolution before that, the stated target only when neither is known.
  // It is the reach, the response rate's denominator and the audience line's count at once.
  const audience = surveyAudience({ invited: summary.total, resolved, stated: survey.targetAudienceCount })
  const rate = responseRate(survey.responseCount, audience?.count ?? null)
  const outlook = nextReminder({
    invitations: invitations.invitations,
    status: survey.status,
    endDate: survey.endDate,
    sendReminders: survey.settings.notificationSendReminders,
    frequencyDays: survey.settings.notificationReminderFrequencyDays,
    now,
  })
  const linkActions: ShareLinkAction[] = []
  if (distribution?.publicLink && distribution.accessType === 'public') {
    linkActions.push({ label: t('surveys.next.shareLink.qr'), onSelect: () => setQrOpen(true) })
  }
  if (actionable) {
    linkActions.push(
      { label: t('surveys.distribution.shareLinkRegenerate'), onSelect: () => setLinkConfirm('regenerate'), disabled: busy },
      { label: t('surveys.distribution.shareLinkRevoke'), onSelect: () => setLinkConfirm('revoke'), disabled: busy },
    )
  }

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
        tightBreadcrumb
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
          value={audience?.count ?? null}
          unit={audience === null ? undefined : copy(REACH_UNIT[audience.source])}
        />
        <ReadingTile
          testId="tile-responses"
          label={copy('responses')}
          value={survey.responseCount}
          unit={rate === null || audience === null ? copy('responsesNoTarget') : copy('responsesOf', { target: audience.count, rate })}
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
          <span
            className={cn('text-sm', firstMissing ? 'text-accent-amber-ink' : firstUnknown ? 'text-fg-secondary' : 'text-chip-good-ink')}
          >
            {firstMissing ? copy(`missing.${firstMissing.id}`) : firstUnknown ? copy(`unknown.${firstUnknown.id}`) : copy('allReady')}
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
          title={
            stateOf('audience') === 'done'
              ? copy('audienceTitle')
              : stateOf('audience') === 'unknown'
                ? copy('audienceUnknownTitle')
                : copy('audienceMissingTitle')
          }
          action={
            actionable && (
              <Button type="button" variant="outline" disabled={busy} onClick={() => setAudienceOpen(true)}>
                {copy('changeAudience')}
              </Button>
            )
          }
        >
          <p className="m-0 text-sm text-fg-secondary">
            {resolved === null
              ? summary.total > 0
                ? copy('audienceInvited', { people: summary.total })
                : t('surveys.distribution.outOfScope')
              : survey.departmentIds.length === 0
                ? copy('audienceCompany', { people: audience?.count ?? resolved })
                : copy(survey.departmentIds.length === 1 ? 'audienceOne' : 'audienceLine', {
                    count: survey.departmentIds.length,
                    people: audience?.count ?? resolved,
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
              <Button type="button" variant="outline" disabled={busy} onClick={actions.createLink}>
                {copy('createLink')}
              </Button>
            )
          }
        >
          {distribution?.publicLink ? (
            <>
              <ShareLinkField link={distribution.publicLink} actions={linkActions} />
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
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || resolved === 0}
                  onClick={() => {
                    setMode('allTargeted')
                    setConfirming(true)
                  }}
                >
                  <Mail aria-hidden="true" className="size-icon" />
                  {copy('sendInvitations')}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" size="icon" aria-label={copy('invitationsMenu')}>
                      <MoreHorizontal aria-hidden="true" className="size-icon" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => {
                        setCopyOpen(true)
                        actions.openCopy()
                      }}
                    >
                      {t('surveys.distribution.copyTitle')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
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
            <div className="rounded-md border border-line-light">
              <Table className="min-w-[36rem] table-fixed text-sm" data-testid="invitation-table">
                <colgroup>
                  {INVITATION_COLUMNS.map((width) => (
                    <col key={width} style={{ width }} />
                  ))}
                </colgroup>
                <TableHeader className="bg-surface-icon-box">
                  <TableRow>
                    <TableHead scope="col" className={TH_CLASS}>{copy('person')}</TableHead>
                    <TableHead scope="col" className={TH_CLASS}>{copy('email')}</TableHead>
                    <TableHead scope="col" className={TH_CLASS}>{copy('department')}</TableHead>
                    <TableHead scope="col" className={TH_CLASS}>{copy('state')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((invitation) => {
                    const person = userById.get(invitation.userId)
                    const rowBusy = busy || busyInvitationId === invitation.id
                    return (
                      <TableRow key={invitation.id} className="border-t border-line-light">
                        <TableCell className="truncate px-3 py-2 font-medium">{person?.name ?? '—'}</TableCell>
                        <TableCell className="truncate px-3 py-2 font-mono text-xs text-fg-secondary">{invitation.email}</TableCell>
                        <TableCell className="truncate px-3 py-2 text-fg-secondary">
                          {person?.departmentId ? (departmentName.get(person.departmentId) ?? '—') : '—'}
                        </TableCell>
                        <TableCell className="px-3 py-1.5">
                          <span className="flex items-center justify-between gap-2">
                            <Chip
                              tone={invitation.status === 'revoked' || invitation.status === 'pending' ? 'warning' : 'neutral'}
                              label={
                                isKnownInvitationStatus(invitation.status)
                                  ? t(`surveys.distribution.status.${invitation.status}`)
                                  : invitation.status
                              }
                            />
                            {actionable && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-7"
                                    aria-label={copy('rowMenu', { email: invitation.email })}
                                  >
                                    <MoreHorizontal aria-hidden="true" className="size-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {/* The server refuses a resend on a completed invitation with a 409
                                      (`ResendInvitationAsync`), so it is never offered on one. */}
                                  <DropdownMenuItem
                                    disabled={rowBusy || invitation.status === 'completed'}
                                    onSelect={() => actions.resendInvitation(invitation.id)}
                                  >
                                    {t('surveys.distribution.resend')}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    disabled={rowBusy || invitation.status === 'revoked'}
                                    onSelect={() => actions.revokeInvitation(invitation.id)}
                                  >
                                    {t('surveys.distribution.revoke')}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </span>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              {invitations.invitations.length > INVITATION_PREVIEW_ROWS && (
                <p className="m-0 border-t border-line-light px-3 py-2 text-sm text-fg-secondary">
                  {!showAll && `${copy('more', { count: invitations.invitations.length - INVITATION_PREVIEW_ROWS })} · `}
                  {/* The artboard's link ink — `a { color: #4a3d72 }` in Distribution.dc.html, the
                      secondary ink (tokens.css) — not the accent blue of the link variant. */}
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0 text-sm text-fg-secondary"
                    onClick={() => setShowAll(!showAll)}
                  >
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
              <Button type="button" variant="primary" disabled={busy || summary.total === 0} onClick={actions.remind}>
                <Send aria-hidden="true" className="size-icon" />
                {copy('sendReminder')}
              </Button>
            )
          }
        >
          <p className="m-0 text-sm text-fg-secondary">
            {reminders === null || reminders === 0
              ? copy('remindersNone')
              : reminders === 1
                ? copy('remindersOne')
                : copy('remindersSome', { count: reminders })}{' '}
            {outlook !== null && (
              <ReminderLine
                outlook={outlook}
                days={survey.settings.notificationReminderFrequencyDays}
                locale={locale}
                copy={copy}
              />
            )}
          </p>
        </Step>

        <div
          data-testid="guarantee"
          className="flex items-start gap-3.5 rounded-lg border border-accent-green-ring bg-chip-good-fill px-5 py-4"
        >
          <IconBox>
            {/* The artboard's shield is the good ink (#0f7f4e) in the lavender tile. */}
            <ShieldCheck data-slot="guarantee-shield" className="text-chip-good-ink" />
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

      <Dialog open={copyOpen} onOpenChange={setCopyOpen}>
        <DialogContent closeLabel={t('common.close')} className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('surveys.distribution.copyTitle')}</DialogTitle>
          </DialogHeader>
          {copyState.status === 'error' ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{copy('copyLoadFailed')}</AlertDescription>
            </Alert>
          ) : copyState.status === 'ready' ? (
            <InvitationCopyEditor
              copy={copyState.draft}
              requiredLocales={copyState.context.requiredLocales}
              onChange={actions.editCopy}
              onSave={() => void actions.saveCopy().then((saved) => saved && setCopyOpen(false))}
              saving={busy}
              editable={copyState.context.editable}
            />
          ) : (
            <SkeletonText lines={4} />
          )}
        </DialogContent>
      </Dialog>

      {distribution?.publicLink && (
        <Dialog open={qrOpen} onOpenChange={setQrOpen}>
          <DialogContent closeLabel={t('common.close')}>
            <DialogHeader>
              <DialogTitle>{t('surveys.next.shareLink.qr')}</DialogTitle>
            </DialogHeader>
            <ShareLinkQr publicLink={distribution.publicLink} accessType={distribution.accessType} surveyId={survey.id} />
          </DialogContent>
        </Dialog>
      )}

      <ConfirmationDialog
        open={linkConfirm !== null}
        onOpenChange={(open) => !open && setLinkConfirm(null)}
        title={linkConfirm === 'revoke' ? t('surveys.next.shareLink.revokeTitle') : t('surveys.next.shareLink.regenerateTitle')}
        description={linkConfirm === 'revoke' ? t('surveys.next.shareLink.revokeBody') : t('surveys.next.shareLink.regenerateBody')}
        confirmText={linkConfirm === 'revoke' ? t('surveys.distribution.shareLinkRevoke') : t('surveys.distribution.shareLinkRegenerate')}
        cancelText={t('common.cancel')}
        onConfirm={() => {
          const which = linkConfirm
          setLinkConfirm(null)
          if (which === 'revoke') actions.revokeLink()
          else if (which === 'regenerate') actions.regenerateLink()
        }}
      />

      <ConfirmationDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('surveys.distribution.confirmTitle')}
        description={t('surveys.distribution.confirmBody', { count: recipients })}
        confirmText={t('surveys.distribution.sendInvitations')}
        cancelText={t('common.cancel')}
        onConfirm={() => {
          setConfirming(false)
          if (selection !== null) actions.invite(selection)
        }}
      />
    </div>
  )
}

const REACH_UNIT = { invited: 'reachInvited', directory: 'reachAudience', stated: 'reachStated' } as const

/**
 * The reminders' second sentence: when the next automatic one leaves, in the artboard's words
 * ("Uno programado para el 7 oct, tres días antes del cierre, …") with the real date and the real
 * distance to the close — or why none is scheduled.
 */
function ReminderLine({
  outlook,
  days,
  locale,
  copy,
}: {
  outlook: ReminderOutlook
  days: number
  locale: string
  copy: (key: string, vars?: Record<string, string | number>) => string
}) {
  const every = Math.max(1, days)
  if (outlook.kind === 'scheduled') {
    const before = outlook.beforeClose
    return (
      <WithReading
        reading={dayMonth(outlook.at, locale)}
        text={(date) =>
          before === null || before < 0
            ? copy('reminder.scheduledPlain', { date })
            : before === 0
              ? copy('reminder.scheduledCloseDay', { date })
              : before === 1
                ? copy('reminder.scheduledOneDay', { date })
                : copy('reminder.scheduled', { date, days: before })
        }
      />
    )
  }
  if (outlook.kind === 'awaiting') {
    return <>{every === 1 ? copy('reminder.awaitingOneDay', { max: MAX_REMINDERS }) : copy('reminder.awaiting', { days: every, max: MAX_REMINDERS })}</>
  }
  return <>{copy(`reminder.${outlook.kind}`)}</>
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
          (state === 'idle' || state === 'unknown') && 'border-line-default bg-surface-icon-box text-fg-secondary',
        )}
      >
        {state === 'done' ? <Check /> : state === 'missing' ? <AlertCircle /> : state === 'unknown' ? <HelpCircle /> : <Clock />}
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
