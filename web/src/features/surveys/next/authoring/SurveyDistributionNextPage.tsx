import { useState, type ReactNode } from 'react'
import { AlertCircle, Check, ClipboardList, Clock, HelpCircle, KeyRound, MoreHorizontal, ShieldCheck, Users } from 'lucide-react'
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
  SwitchField,
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
  audienceSelection,
  estimateAudience,
  targetsWholeCompany,
  type AudienceMode,
} from '../../../../components/distribution'
import { useTranslation } from '../../../../i18n'
import { cn } from '../../../../lib/cn'
import { canDistribute } from '../../api/surveyInvitationCopy'
import { isKnownInvitationStatus, isPerSurvey, type SurveyInvitationDetail } from '../../api/surveyDistribution'
import { IconBox, TH_CLASS } from '../../../shared-next/parts'
import { Card, Meter, ReadingTile, type ShareLinkAction } from './parts'
import SharePanel from './SharePanel'
import ParticipationPanel from './ParticipationPanel'
import SurveyRosterPanel from './SurveyRosterPanel'
import { RespondentTextsDialog } from './RespondentTextsDialog'
import { useSurveyParticipation } from './useSurveyParticipation'
import {
  INVITATION_COLUMNS,
  canSend,
  dayMonth,
  daysFrom,
  invitationCoverage,
  launchChecklist,
  readySteps,
  responseRate,
  surveyAudience,
  targetedDepartments,
  type LaunchStepState,
} from './launch'
import {
  useDistributionModel,
  type DistributionActions,
  type DistributionModel,
  type SendOutcome,
  type SendProgress,
} from './useDistributionModel'
import { byCount } from '../../../../i18n/plural'

/** How many invitation rows the checklist shows before "Ver las n". */
export const INVITATION_PREVIEW_ROWS = 4

/**
 * Distribución, redesigned (canvas board "Distribution") — `/surveys/:surveyId/distribution`.
 *
 * A launch checklist: who the survey reaches, the share link, and what each person in the
 * audience holds (a per-survey key, or on a `shared` survey an invitation record) — each a step
 * that is met or names what is missing — closed by the sentence the server writes about what this
 * survey records (`anonymity.guarantee`, in the reader's language). Writes are offered only to an
 * administrator of the survey's own company.
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
      progress={model.progress}
      outcome={model.outcome}
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
  progress = null,
  outcome = null,
  actions,
  now = new Date(),
}: {
  model: DistributionModel
  busy: boolean
  busyInvitationId?: string | null
  notice: string | null
  actionError: string | null
  /** A per-survey send in flight, or null. */
  progress?: SendProgress | null
  /** What the last send did, or null. */
  outcome?: SendOutcome | null
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
  const [textsOpen, setTextsOpen] = useState(false)
  const [textsSaved, setTextsSaved] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  // ONE request for the two panels that read it. Each fetching for itself meant two identical
  // calls per load -- on 800 people, two rosters carrying every person's demographics and two
  // passes of the same join, on a deployment with one vCPU in total.
  const participation = useSurveyParticipation(survey.id, scoped)

  const actionable = scoped && canDistribute(survey.status)
  // Narrower than `actionable`: a draft keeps its link and its settings editable, but the server
  // refuses an invitation to it with a 409, so nothing here offers to send one.
  const sendable = actionable && canSend(survey.status)
  const perSurvey = isPerSurvey(invitations)
  // The survey's own targets, BOTH kinds. Passing the departments alone is what made a
  // survey aimed at 240 people by name read as "the whole company · 642 personas".
  const surveyTargets = { departmentIds: survey.departmentIds, userIds: survey.userIds }
  // The audience the server would resolve for the survey as targeted — `SurveyQueries.Audience`,
  // mirrored by `estimateAudience`. Unknown (null), never 0, for a viewer who cannot read users.
  const resolved = scoped
    ? estimateAudience('allTargeted', users, { departmentIds: [], userIds: [] }, surveyTargets).length
    : null
  const recipients = estimateAudience(
    mode,
    users,
    { departmentIds: selectedDepartmentIds, userIds: selectedUserIds },
    surveyTargets,
  ).length
  const selection = audienceSelection(mode, selectedDepartmentIds, selectedUserIds)
  const summary = invitations.summary
  const read = invitationCoverage({ summary, audience: resolved, perSurvey })
  // The list is re-read once the send ends, not after every call; while it runs, the keys this
  // send has mailed so far move from one bucket to the other, so the buckets never contradict the
  // progress line beneath them ("0 con código" over "Enviando códigos: 200 de 617").
  const sentSoFar = progress?.done ?? 0
  const coverage = { ...read, covered: read.covered + sentSoFar, uncovered: Math.max(0, read.uncovered - sentSoFar) }
  const steps = launchChecklist({ audience: resolved, publicLink: distribution?.publicLink ?? null, summary, perSurvey })
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
  //
  // A per-survey send goes out 100 at a time, so part-way through (or after one that stopped)
  // fewer people are invited than the audience holds. The invited count is the audience only
  // once it has caught up with the directory; before that it would print 200 as the reach of a
  // 617-person survey and inflate its response rate threefold.
  const audience = surveyAudience({
    invited: resolved !== null && summary.total < resolved ? null : summary.total,
    resolved,
    stated: survey.targetAudienceCount,
  })
  const rate = responseRate(survey.responseCount, audience?.count ?? null)
  // A survey handed out by link has no roster, so its reach is UNKNOWN rather than zero.
  // Printing a literal 0 beside "37 respuestas" reads as a contradiction, and it is the
  // directory's emptiness being reported as the survey's reach.
  const reach =
    audience !== null && audience.count === 0 && (distribution?.publicLink ?? null) !== null ? null : audience
  // No QR entry: the code is rendered on the panel, and a menu item that opened a dialog of
  // the same code would be a second door to a room the reader is already standing in.
  const linkActions: ShareLinkAction[] = []
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

      {/* `-mt-1`: the header's 24px bottom margin collapses with this one, and the artboard puts
          the tiles 20px under the hairline (measured: 197.8 → 217.8). */}
      <section aria-label={copy('readings')} className="-mt-1 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="distribution-readings">
        <ReadingTile
          testId="tile-reach"
          label={copy('reach')}
          value={reach?.count ?? null}
          unit={reach === null ? undefined : copy(REACH_UNIT[reach.source])}
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
                    ? copy(byCount(closesIn, 'closesInOne', 'closesIn'), { days: closesIn })
                    : copy(byCount(Math.abs(closesIn), 'closedAgoOne', 'closedAgo'), { days: Math.abs(closesIn) })
          }
        />
        <ReadingTile testId="tile-ready" label={copy('ready')} value={ready} unit={copy('readyOf', { count: steps.length })}>
          <span
            className={cn('text-sm', firstMissing ? 'text-accent-amber-ink' : firstUnknown ? 'text-fg-secondary' : 'text-chip-good-ink')}
          >
            {firstMissing
              ? firstMissing.id === 'invitations'
                ? copy(perSurvey ? 'send.missingCodes' : 'send.missingShared')
                : copy(`missing.${firstMissing.id}`)
              : firstUnknown ? copy(`unknown.${firstUnknown.id}`) : copy('allReady')}
          </span>
        </ReadingTile>
      </section>

      {/* Above the checklist on purpose. The link and its QR are what an administrator came
          for; being step 2 of 4 is what made them unfindable. The checklist still tracks the
          step -- it just no longer owns the controls. */}
      <section aria-label={t('surveys.next.share.title')} className="mt-6">
        <Card className="px-4 py-4">
          <SharePanel
            publicLink={distribution?.publicLink ?? null}
            accessType={distribution?.accessType}
            surveyId={survey.id}
            onCreate={actionable ? actions.createLink : undefined}
            creating={busy}
            actions={linkActions}
          />

          {/* In the share card and nowhere else: this setting changes what the PUBLIC LINK
              asks, so it belongs beside the link rather than in a settings screen the
              person who shares the link may never open.

              Offered only while `actionable` -- `scoped && canDistribute(status)`, which
              mirrors the server's `AllowsScheduleEdit` -- so a closed survey shows the
              state without a control that would earn a 409.

              NOT gated on anonymity (ruled 2026-10-12): every survey has a link, a link
              visitor to a named survey is served anonymously, and the server asks them
              whenever the flag is on (`AsksSelfDeclaredDemographics`). */}
          <div className="mt-4 border-t border-line-default pt-4">
            <SwitchField
              label={t('surveys.next.share.demographicsLabel')}
              description={t('surveys.next.share.demographicsHelp', { floor: ANONYMITY_FLOOR })}
              checked={survey.settings.selfDeclaredDemographics}
              disabled={!actionable || busy}
              onChange={actions.setSelfDeclaredDemographics}
            />
          </div>

          {/* Beside it, because it also changes what the PUBLIC LINK does. Off by default and
              per-survey on purpose (ruled 2026-10-13): applied per RESPONDENT it would have taken
              effect instantly on every live survey, and someone sixty items into eighty who
              reloaded would have lost the lot. It ends resuming, never the session id. */}
          <div className="mt-4 border-t border-line-default pt-4">
            <SwitchField
              label={t('surveys.next.share.oneSessionOnlyLabel')}
              description={t('surveys.next.share.oneSessionOnlyHelp')}
              checked={survey.settings.oneSessionOnly ?? false}
              disabled={!actionable || busy}
              onChange={actions.setOneSessionOnly}
            />
          </div>

          {/* The survey's own words for the respondent: the anonymity box's paragraph and the
              thank-you (Eagle's corrections, 2026-10-20). Here because, like the two switches
              above, it changes what someone holding the link reads. Empty is the default. */}
          <div className="mt-4 flex flex-col gap-2 border-t border-line-default pt-4">
            <p className="m-0 text-base font-medium text-fg-primary">{t('surveys.next.respondentTexts.open')}</p>
            <p className="m-0 text-sm text-fg-secondary">{t('surveys.next.respondentTexts.openHelp')}</p>
            <div>
              <Button type="button" variant="outline" disabled={!actionable} onClick={() => { setTextsSaved(null); setTextsOpen(true) }}>
                {t('common.edit')}
              </Button>
            </div>
            {textsSaved ? <p role="status" className="m-0 text-sm text-fg-secondary">{textsSaved}</p> : null}
          </div>

          {/* The server never asks public-link respondents for a name. Completion is
              recorded separately when the respondent signs in; no authoring toggle is needed. */}
        </Card>
      </section>

      {/* Who has answered and who has not -- here, beside the response count and the
          invitations, because this is the page an administrator opens to chase participation.
          The results page is the opposite surface: it is about WHAT was answered, floored at
          five, and a list of names has no business beside it. Offered to the scoped admin only
          (`scoped`): the endpoint answers super_admin and the survey's own company_admin. Not
          gated on anonymity: every survey has a link (ruled 2026-10-12). */}
      {scoped ? <ParticipationPanel state={participation} /> : null}

      {/* The roster, for the administrator chasing a mass invite. Deliberately NOT gated on
          `collectParticipantIdentity`, unlike the panel above: that setting decides whether a
          LINK visitor is asked their name, while an account holder's state is known because
          their response carries their user id. So this is answerable for a mass invite whether
          or not the survey asks anybody anything, and gating it would have blanked the one
          screen the launch is watched from. */}
      {scoped ? <SurveyRosterPanel state={participation} /> : null}

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
                : // `idle` is an empty directory with a working door: nothing is wrong and
                  // nothing is needed. Falling through to the `missing` title here was how
                  // a link-distributed survey came to announce "Audiencia sin personas".
                  stateOf('audience') === 'idle'
                  ? copy('audienceByLinkTitle')
                  : copy('audienceMissingTitle')
          }
          action={
            // The dialog behind it ends in a send, so it is offered exactly where a send is.
            sendable && (
              <Button type="button" variant="outline" disabled={busy} onClick={() => setAudienceOpen(true)}>
                {copy('changeAudience')}
              </Button>
            )
          }
        >
          <p className="m-0 text-sm text-fg-secondary">
            {stateOf('audience') === 'idle'
              ? copy('audienceByLink')
              : resolved === null
              ? summary.total > 0
                ? copy('audienceInvited', { people: summary.total })
                : t('surveys.distribution.outOfScope')
              : targetsWholeCompany(surveyTargets)
                ? copy('audienceCompany', { people: audience?.count ?? resolved })
                : survey.departmentIds.length === 0
                  ? // Aimed at people by name and no department at all. This branch did not
                    // exist, so it fell through to "Toda la empresa".
                    copy('audiencePeople', { people: audience?.count ?? resolved })
                  : survey.userIds.length > 0
                    ? copy('audienceMixed', {
                        people: audience?.count ?? resolved,
                        names: joinNames(targets.names, copy('and')),
                      })
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
          {/* A status line, not a second set of controls: "Compartir la encuesta" above owns
              the link, the code and the menu. Two copies of the same control on one page is
              how a reader ends up unsure which one is live. */}
          <p className="m-0 text-sm text-fg-secondary">
            {distribution?.publicLink ? copy('linkHelpOpen') : copy('noLink')}
          </p>
        </Step>

        <Step
          testId="step-invitations"
          state={stateOf('invitations')}
          title={perSurvey ? copy('send.codesTitle') : copy('invitationsTitle')}
          action={
            sendable && (
              <Button
                type="button"
                variant="outline"
                disabled={busy || resolved === 0}
                onClick={() => {
                  setMode('allTargeted')
                  setConfirming(true)
                }}
              >
                {perSurvey ? <KeyRound aria-hidden="true" className="size-icon" /> : <Users aria-hidden="true" className="size-icon" />}
                {perSurvey ? copy('send.sendCodes') : copy('send.register')}
              </Button>
            )
          }
        >
          <p className="m-0 text-sm text-fg-secondary">
            {perSurvey ? copy('send.codesHelp') : copy('send.sharedHelp')}
            {actionable && !sendable ? ` ${copy('send.draftHelp')}` : ''}
          </p>
          <div className="grid gap-2.5 sm:grid-cols-3" data-testid="invitation-buckets">
            <Bucket label={perSurvey ? copy('send.withCode') : copy('send.registered')} value={coverage.covered} />
            <Bucket
              label={perSurvey ? copy('send.withoutCode') : copy('send.unregistered')}
              value={coverage.uncovered}
              warn={coverage.uncovered > 0}
            />
            <Bucket label={copy('revoked')} value={coverage.revoked} warn={coverage.revoked > 0} />
          </div>
          {progress !== null && <SendProgressLine progress={progress} copy={copy} />}
          {outcome !== null && progress === null && (
            <SendOutcomePanel outcome={outcome} copy={copy} resume={sendable ? () => selection !== null && actions.invite(selection) : undefined} busy={busy} />
          )}
          {invitations.invitations.length === 0 ? (
            progress === null && <p className="m-0 text-sm text-fg-secondary">{perSurvey ? copy('send.codesNone') : copy('send.sharedNone')}</p>
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
                    const state = rowState(invitation, perSurvey)
                    return (
                      <TableRow key={invitation.id} className="group/row border-t border-line-light">
                        <TableCell className="truncate px-3 py-2 font-medium">{person?.name ?? '—'}</TableCell>
                        <TableCell className="truncate px-3 py-2 font-mono text-xs text-fg-secondary">{invitation.email}</TableCell>
                        <TableCell className="truncate px-3 py-2 text-fg-secondary">
                          {person?.departmentId ? (departmentName.get(person.departmentId) ?? '—') : '—'}
                        </TableCell>
                        <TableCell className="px-3 py-1.5">
                          <span className="flex items-center justify-between gap-2">
                            <Chip
                              tone={state.warn ? 'warning' : 'neutral'}
                              label={state.key === null ? invitation.status : state.key.startsWith('send.') ? copy(state.key) : t(state.key)}
                            />
                            {actionable && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    // The artboard's Estado cell holds the chip alone. The menu is hidden
                                    // only where a pointer can hover, and shown on the row's hover, on focus
                                    // inside the row and while open. A touch screen always shows it.
                                    className="size-7 [@media(hover:hover)]:opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 data-[state=open]:opacity-100"
                                    aria-label={copy('rowMenu', { email: invitation.email })}
                                  >
                                    <MoreHorizontal aria-hidden="true" className="size-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {/* Revoke only. The per-row resend is gone: the server answers it
                                      with a 410 since the invitation email was deleted, and a code
                                      cannot be re-sent from here (its plaintext is never kept). */}
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
                // The artboard's #6e648b line: `text-fg-label` (`--admin-font-section-label`), which
                // clears AA in both palettes — 5.44:1 on the light card, 6.34:1 on the dark
                // #1f173b — unlike `text-fg-tertiary`, which `respondContrast.test.ts` bans here.
                <p data-testid="invitations-more" className="m-0 border-t border-line-light px-3 py-2 text-sm text-fg-label">
                  {!showAll && `${copy('more', { count: invitations.invitations.length - INVITATION_PREVIEW_ROWS })} · `}
                  {/* The artboard's link ink — `a { color: #4a3d72 }` in Distribution.dc.html, the
                      secondary ink (tokens.css) — not the accent blue of the link variant; regular
                      weight and no border, so the row is the artboard's 35px. */}
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto border-0 p-0 text-sm font-normal text-fg-secondary"
                    onClick={() => setShowAll(!showAll)}
                  >
                    {showAll ? copy('seeFewer') : copy('seeAll', { count: invitations.invitations.length })}
                  </Button>
                </p>
              )}
            </div>
          )}
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
            <p className="m-0 text-2xs font-bold uppercase leading-normal tracking-eyebrow text-chip-good-ink">
              {invitations.anonymity.anonymous ? copy('guaranteeAnonymous') : copy('guaranteeRecorded')}
            </p>
            {/* The artboard's `.serif` at 18px: the headings' Goudy (`font-store-serif`; `font-serif`
                is Tailwind's Georgia stack) at their 1.2 line height. */}
            <p className="m-0 font-store-serif text-[1.125rem] leading-tight text-fg-primary">{invitations.anonymity.guarantee}</p>
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
            surveyTargets={surveyTargets}
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
              {perSurvey ? copy('send.sendCodes') : copy('send.register')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <RespondentTextsDialog surveyId={survey.id} open={textsOpen} onOpenChange={setTextsOpen} onSaved={setTextsSaved} />

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
        title={perSurvey ? copy('send.confirmCodesTitle') : copy('send.confirmSharedTitle')}
        description={
          perSurvey ? copy('send.confirmCodesBody', { count: recipients }) : copy('send.confirmSharedBody', { count: recipients })
        }
        confirmText={perSurvey ? copy('send.sendCodes') : copy('send.register')}
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

type Copy = (key: string, vars?: Record<string, string | number>) => string

/**
 * The Estado chip of one invitation row, as a translation key. What a row can truthfully say is
 * what the server records: revoked, completed (an identified survey), and on a `per_survey`
 * survey whether the person holds a key. "Sin enviar" / "Enviada" are gone: since the invitation
 * email was deleted nothing is sent and `sentAt` is never written, so every row read "Sin enviar"
 * for ever.
 */
function rowState(invitation: SurveyInvitationDetail, perSurvey: boolean): { key: string | null; warn: boolean } {
  if (invitation.status === 'revoked') return { key: 'surveys.distribution.status.revoked', warn: true }
  if (invitation.status === 'completed') return { key: 'surveys.distribution.status.completed', warn: false }
  if (perSurvey) return invitation.hasCode ? { key: 'send.rowHasCode', warn: false } : { key: 'send.rowNoCode', warn: true }
  return isKnownInvitationStatus(invitation.status) ? { key: 'send.rowInAudience', warn: false } : { key: null, warn: false }
}

/** "Enviando códigos: 200 de 617…", with the meter, while a per-survey send is in flight. */
function SendProgressLine({ progress, copy }: { progress: SendProgress; copy: Copy }) {
  const percent = progress.total === null || progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100)
  return (
    <div role="status" data-testid="send-progress" className="flex flex-col gap-1.5 rounded-md border border-line-light px-3 py-2.5">
      <p className="m-0 text-sm font-medium text-fg-primary">
        {progress.total === null ? copy('send.progressStarting') : copy('send.progress', { done: progress.done, total: progress.total })}
      </p>
      <Meter percent={percent} label={copy('send.progressLabel')} />
      <p className="m-0 text-sm text-fg-secondary">{copy('send.progressHelp')}</p>
    </div>
  )
}

/** What the last send did, in the server's numbers, and who did not get their key. */
function SendOutcomePanel({
  outcome,
  copy,
  resume,
  busy,
}: {
  outcome: SendOutcome
  copy: Copy
  /** Offered when a send can be repeated; absent for a viewer who may not send. */
  resume?: () => void
  busy: boolean
}) {
  if (outcome.kind === 'shared') {
    return (
      <p role="status" data-testid="send-outcome" className="m-0 text-sm text-fg-secondary">
        {outcome.skipped > 0
          ? copy('send.sharedDoneSkips', { count: outcome.created, skipped: outcome.skipped })
          : copy('send.sharedDone', { count: outcome.created })}
      </p>
    )
  }
  const sentence = outcome.stopped
    ? outcome.remaining === null
      ? copy('send.stoppedUnknown', { count: outcome.issued })
      : copy(outcome.remaining === 1 ? 'send.stoppedOne' : 'send.stopped', { count: outcome.issued, remaining: outcome.remaining })
    : outcome.remaining === 0 || outcome.remaining === null
      ? outcome.issued === 0
        ? copy('send.doneNone')
        : copy('send.doneAll', { count: outcome.issued })
      : copy(outcome.remaining === 1 ? 'send.doneSomeOne' : 'send.doneSome', { count: outcome.issued, remaining: outcome.remaining })
  const unfinished = outcome.stopped || (outcome.remaining ?? 0) > 0
  return (
    <div
      role="status"
      data-testid="send-outcome"
      className={cn(
        'flex flex-col gap-2 rounded-md border px-3 py-2.5',
        unfinished ? 'border-accent-amber-ring bg-chip-warning-fill' : 'border-line-light',
      )}
    >
      <p className={cn('m-0 text-sm', unfinished ? 'text-chip-warning-ink' : 'text-fg-primary')}>{sentence}</p>
      {outcome.failedEmails.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="m-0 text-sm font-medium text-fg-primary">{copy('send.failedTitle', { count: outcome.failedEmails.length })}</p>
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0" data-testid="send-failed">
            {outcome.failedEmails.map((email) => (
              <li key={email} className="break-all font-mono text-xs text-fg-secondary">
                {email}
              </li>
            ))}
          </ul>
          <p className="m-0 text-sm text-fg-secondary">{copy('send.failedHelp')}</p>
        </div>
      )}
      {unfinished && resume && (
        <div>
          <Button type="button" variant="outline" disabled={busy} onClick={resume}>
            {copy('send.resume')}
          </Button>
        </div>
      )}
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
    // A grid, not a wrapping flex row. Below sm the action takes its own row under the body: in
    // distribution-390.png the flex-1 body shrank instead of wrapping, printed one word per line,
    // collapsed the invitation table to a 10px sliver and let the buttons sit on the titles.
    // From sm it is the artboard's icon · body · action row, and the action column stacks its
    // controls, so a "•••" beside a button never narrows the body (it cost the table 24px).
    <Card
      data-testid={testId}
      data-state={state}
      className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3.5 gap-y-3 px-5 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
    >
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
      <div className="flex min-w-0 flex-col gap-2" data-slot="step-body">
        {/* 14px (`text-lg` in this scale), the artboard's step title — `text-base` is 13px. */}
        <h3 className="m-0 text-lg font-semibold text-fg-primary">{title}</h3>
        {children}
      </div>
      {action && (
        <div
          data-slot="step-action"
          className="col-start-2 flex flex-wrap items-center gap-2 sm:col-start-3 sm:row-start-1 sm:flex-col sm:flex-nowrap sm:items-end"
        >
          {action}
        </div>
      )}
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
      {/* The artboard's bucket: a 10px label on 1.5 (15px) and a 20px mono reading on 1.1 (22px). */}
      <span className={cn('text-2xs font-bold uppercase leading-normal tracking-wider', warn ? 'text-chip-warning-ink' : 'text-fg-label')}>{label}</span>
      <span className={cn('font-mono text-2xl leading-[1.1] tabular-nums', warn ? 'text-chip-warning-ink' : 'text-fg-primary')}>{value}</span>
    </div>
  )
}
