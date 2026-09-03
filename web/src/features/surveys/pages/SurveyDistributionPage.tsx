import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { useTranslation, type Locale } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import {
  Button,
  ConfirmationDialog,
  EmptyState,
  H2,
  NetworkError,
} from '../../../components/ui'
import { useCompanyScope } from '../../../company-context'
import { useCompanyName } from '../../../company-context/useCompanyName'
import { statusLabel } from '../surveyVocabulary'
import {
  AudienceSelector,
  DistributionProgress,
  InvitationStatusChips,
  InvitationCopyEditor,
  InvitationTable,
  ShareLinkPanel,
  audienceSelection,
  estimateAudience,
  type AudienceMode,
} from '../../../components/distribution'
import {
  createSurveyInvitations,
  getSurveyDistribution,
  listSurveyInvitations,
  regenerateSurveyLink,
  resendSurveyInvitation,
  revokeSurveyInvitation,
  revokeSurveyLink,
  sendSurveyReminders,
  updateSurveyDistribution,
  type SurveyDistributionDetail,
  type SurveyInvitationList,
  type SurveyInvitationStatus,
} from '../api/surveyDistribution'
import {
  getSurveyInvitationCopy,
  saveSurveyInvitationCopy,
  type InvitationCopyByLocale,
  type InvitationCopyField,
  type SurveyInvitationCopy,
} from '../api/surveyInvitationCopy'
import ShareLinkQr from '../components/ShareLinkQr'
import { listDepartments, type Department } from '../../org-structure/api/departments'
import { listUsers, type User } from '../../org-structure/api/users'

/**
 * Distributing one survey: who to invite, what the invitation says in each language, and
 * how the audience is getting on with it.
 *
 * ## The two things this page must not do
 *
 * **It never renders an invitation token.** Not masked, not truncated, not in a copy
 * button. A token is a credential that opens the survey as one named employee, the API
 * omits it from every admin read, and nothing here would have anywhere to put it. The
 * share link is different and is handled by `ShareLinkPanel`, which explains why.
 *
 * **It never offers a target outside the caller's own company.** The audience lists are
 * fetched for the *survey's* `companyId`, and only after that id has been checked against
 * the caller's own scope — a CompanyAdmin looking at another tenant's survey is told so
 * and offered nothing, rather than shown a picker that collects a 403 on submit. The
 * server enforces this independently; the point of doing it here is that presenting the
 * option is itself a disclosure.
 *
 * ## Why sending is behind a confirmation with a number in it
 *
 * Sending to the wrong audience is not undoable. The confirmation restates the recipient
 * count computed by the same rule the server applies, so the last thing an admin reads
 * before dispatch is how many people this is about to mail.
 */
export default function SurveyDistributionPage() {
  const { surveyId = '' } = useParams()
  const { t, locale } = useTranslation()
  const scope = useCompanyScope()
  // Explicit rather than derived: `navSections` yields nothing for this route, because
  // distribution is an action on one survey and has no nav entry of its own.
  const companyName = useCompanyName()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  const [context, setContext] = useState<SurveyInvitationCopy | null>(null)
  const [distribution, setDistribution] = useState<SurveyDistributionDetail | null>(null)
  const [invitations, setInvitations] = useState<SurveyInvitationList | null>(null)
  const [departments, setDepartments] = useState<Department[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  // Load failures and action failures render differently: losing the page is a
  // NetworkError with a retry, while a failed reminder leaves the page up with an
  // alert. One shared string made the first kind fall through to a permanent
  // "Loading..." below the alert.
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [busyInvitationId, setBusyInvitationId] = useState<string | null>(null)

  const [mode, setMode] = useState<AudienceMode>('allTargeted')
  const [selectedDepartmentIds, setSelectedDepartmentIds] = useState<string[]>([])
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])
  const [confirming, setConfirming] = useState(false)
  // The invitation table's status filter. Held here rather than in the table because it
  // is a server round-trip, not a client-side narrowing of rows already fetched.
  const [statusFilter, setStatusFilter] = useState('')
  const [draftCopy, setDraftCopy] = useState<InvitationCopyByLocale | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    // `load` fetches the list unfiltered, so the chip row has to agree with it.
    setStatusFilter('')
    try {
      // The survey first and on its own: its `companyId` is what decides whether the
      // audience lists may be requested at all, so requesting them alongside it would be
      // asking the question before knowing whether it is allowed to be asked.
      const surveyContext = await getSurveyInvitationCopy(baseUrl, surveyId, locale as Locale)
      setContext(surveyContext)
      setDraftCopy(surveyContext.copy)

      const [distributionDetail, invitationList] = await Promise.all([
        getSurveyDistribution(baseUrl, surveyId),
        listSurveyInvitations(baseUrl, surveyId),
      ])
      setDistribution(distributionDetail)
      setInvitations(invitationList)

      if (scope.status === 'ready' && scope.companyId === surveyContext.survey.companyId) {
        const [departmentList, userList] = await Promise.all([
          listDepartments(baseUrl, surveyContext.survey.companyId),
          listUsers(baseUrl, surveyContext.survey.companyId),
        ])
        setDepartments(departmentList)
        setUsers(userList)
      } else {
        // Not an error state to recover from — it is the correct outcome for a caller
        // scoped elsewhere. Left empty so the audience section renders its refusal.
        setDepartments([])
        setUsers([])
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('surveys.distribution.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [baseUrl, surveyId, locale, scope.status, scope.companyId, t])

  useEffect(() => {
    void load()
  }, [load])

  const scopedToSurvey =
    context !== null && scope.status === 'ready' && scope.companyId === context.survey.companyId

  const recipientCount = estimateAudience(
    mode,
    users,
    selectedDepartmentIds,
    selectedUserIds,
    context?.survey.departmentIds ?? [],
  ).length

  const selection = audienceSelection(mode, selectedDepartmentIds, selectedUserIds)

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('surveys.distribution.actionFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function handleSend(): Promise<void> {
    setConfirming(false)
    if (selection === null) return
    await run(async () => {
      const result = await createSurveyInvitations(baseUrl, surveyId, selection)
      // "Queued", never "sent": this call writes `notifications` rows and nothing more.
      // Delivery is the notification sweep's job, and a page that reports mail as
      // delivered because a POST returned 200 is a page that will be believed.
      //
      // The skip count is reported rather than discarded. The server answers `requested`
      // and `created` separately precisely because they differ -- somebody already
      // invited, or deactivated since the audience was chosen -- and a notice reading
      // "40 invitations were queued" after asking for 45 leaves the admin to discover
      // the gap by counting rows. Only shown when it happened: "and 0 skipped" is noise
      // on the run where nothing was.
      const skipped = result.requested - result.created
      setNotice(
        skipped > 0
          ? t('surveys.distribution.invitationsQueuedWithSkips', {
              count: result.created,
              skipped,
            })
          : t('surveys.distribution.invitationsQueued', { count: result.created }),
      )
      setInvitations(await refreshInvitations())
      setDistribution(await getSurveyDistribution(baseUrl, surveyId))
    })
  }

  async function handleRemind(): Promise<void> {
    await run(async () => {
      const result = await sendSurveyReminders(baseUrl, surveyId)
      setNotice(
        t('surveys.distribution.remindersQueued', {
          count: result.queued,
          skipped: result.skippedTooSoon,
        }),
      )
      setInvitations(await refreshInvitations())
    })
  }

  async function handleInvitationAction(
    invitationId: string,
    act: (id: string) => Promise<unknown>,
  ): Promise<void> {
    setBusyInvitationId(invitationId)
    try {
      await run(async () => {
        await act(invitationId)
        setInvitations(await refreshInvitations())
      })
    } finally {
      setBusyInvitationId(null)
    }
  }

  async function handleSaveCopy(): Promise<void> {
    if (context === null || draftCopy === null) return
    await run(async () => {
      await saveSurveyInvitationCopy(baseUrl, surveyId, draftCopy, context.requiredLocales)
      setNotice(t('surveys.distribution.copySaved'))
      const refreshed = await getSurveyInvitationCopy(baseUrl, surveyId, locale as Locale)
      setContext(refreshed)
      setDraftCopy(refreshed.copy)
    })
  }

  /**
   * Re-read the invitation list THROUGH the active filter.
   *
   * The three action handlers refetched unfiltered, which after a resend or a reminder
   * swapped the table back to every invitation while the chip above it still read
   * "Opened" -- the control and the rows disagreeing about what was on screen.
   */
  function refreshInvitations(): Promise<SurveyInvitationList> {
    return listSurveyInvitations(
      baseUrl,
      surveyId,
      statusFilter === '' ? {} : { status: statusFilter as SurveyInvitationStatus },
    )
  }

  async function handleStatusFilter(status: string): Promise<void> {
    setStatusFilter(status)
    await run(async () => {
      setInvitations(
        await listSurveyInvitations(
          baseUrl,
          surveyId,
          status === '' ? {} : { status: status as SurveyInvitationStatus },
        ),
      )
    })
  }

  function handleCopyChange(target: Locale, field: InvitationCopyField, text: string): void {
    setDraftCopy((current) =>
      current === null
        ? current
        : { ...current, [target]: { ...current[target], [field]: { text, authored: true } } },
    )
  }

  // Summed here rather than read off `summary`, which has no reminder field. `null`
  // until the list arrives: a strip printing 0 would assert none were sent.
  const remindersSent =
    invitations === null
      ? null
      : invitations.invitations.reduce((total, invitation) => total + invitation.reminderCount, 0)

  return (
    // Pattern A: the header sits OUTSIDE the `gap-section` column. Inside it, the
    // header's own `mb-panel` and the column's `gap-section` stack into 40px of dead
    // space under the hairline -- visible in the before/after of this redesign, and the
    // same fix `SurveyResultsPage` and `CompanyAdminDashboardView` already carry.
    <div>
      <PageTopBar
        title={t('surveys.distribution.title')}
        eyebrow={companyName}
        description={context?.survey.title ?? undefined}
        badge={
          context === null
            ? undefined
            : { text: statusLabel(t, context.survey.status), variant: 'secondary' }
        }
        // The trail is the entry point in reverse: this page is reached from a survey,
        // so it must be able to say which one and let the reader back to it.
        breadcrumbs={[
          { label: t('surveys.title'), href: '/surveys' },
          ...(context?.survey.title
            ? [{ label: context.survey.title, href: `/surveys/${surveyId}` }]
            : []),
          { label: t('surveys.distribution.title') },
        ]}
        // No header actions by design: the dispatch buttons are scoped by the audience
        // picker directly above them, and a control in the header has nothing beside it
        // to say what it would send to.
      />

      <div className="flex flex-col gap-section">
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}

        {loadError !== null ? (
          <NetworkError
            title={t('surveys.distribution.loadFailed')}
            description={loadError}
            onRetry={() => void load()}
            retryText={t('common.retry')}
          />
        ) : loading || context === null || invitations === null ? (
          <p>{t('common.loading')}</p>
        ) : distribution === null ? (
          // The normal state of a survey nobody has distributed: a 200-shaped emptiness,
          // not a failure. The create action lives HERE because the panels that could
          // otherwise create one only mount once a distribution exists -- without this
          // button the page could describe the emptiness but never end it. `tokenized`
          // is the DDL default: per-invitee tokens only, no open link minted until an
          // admin asks for one.
          <EmptyState
            title={t('surveys.distribution.noDistributionYet')}
            description={t('surveys.distribution.noDistributionYetDescription')}
            action={
              scopedToSurvey ? (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      setDistribution(
                        await updateSurveyDistribution(baseUrl, surveyId, {
                          accessType: 'tokenized',
                        }),
                      )
                    })
                  }
                >
                  {t('surveys.distribution.setUpDistribution')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            {/* Every block below is a named `<section>` rather than a Card with a
                label span: an accessible name makes each one a landmark a screen-reader
                user can jump between, which on a page this long is the difference
                between reading it and scrolling it.

                The order descends from what is true to what to do about it:
                participation, then who to send to, then what it says, then the record
                of what went out, and the open link last -- it is the other channel,
                and the one whose warnings should not be the first thing read. */}
            <section aria-labelledby="distribution-participation" className="flex flex-col gap-panel-gap">
              <H2 id="distribution-participation">{t('surveys.distribution.progressTitle')}</H2>
              <DistributionProgress
                summary={invitations.summary}
                anonymity={invitations.anonymity}
                responseCount={context.survey.responseCount}
                remindersSent={remindersSent}
                locale={locale}
              />
            </section>

            <section aria-labelledby="distribution-audience" className="flex flex-col gap-panel-gap">
              <H2 id="distribution-audience">{t('surveys.distribution.audienceTitle')}</H2>
              <div className="flex flex-col gap-panel-gap rounded-lg border border-line-light bg-surface-panel p-panel">
                {scopedToSurvey ? (
                  <>
                    <AudienceSelector
                      mode={mode}
                      onModeChange={setMode}
                      selectedDepartmentIds={selectedDepartmentIds}
                      onDepartmentsChange={setSelectedDepartmentIds}
                      selectedUserIds={selectedUserIds}
                      onUsersChange={setSelectedUserIds}
                      departments={departments}
                      users={users}
                      surveyDepartmentIds={context.survey.departmentIds}
                      disabled={busy}
                    />
                    <div className="flex flex-wrap gap-inline">
                      <Button
                        onClick={() => setConfirming(true)}
                        disabled={busy || selection === null || recipientCount === 0}
                      >
                        {t('surveys.distribution.sendInvitations')}
                      </Button>
                      <Button variant="outline" onClick={() => void handleRemind()} disabled={busy}>
                        {t('surveys.distribution.sendReminders')}
                      </Button>
                    </div>
                  </>
                ) : (
                  <p>{t('surveys.distribution.outOfScope')}</p>
                )}
              </div>
            </section>

            <section aria-labelledby="distribution-copy" className="flex flex-col gap-panel-gap">
              <H2 id="distribution-copy">{t('surveys.distribution.copyTitle')}</H2>
              <div className="rounded-lg border border-line-light bg-surface-panel p-panel">
                {draftCopy !== null && (
                  <InvitationCopyEditor
                    copy={draftCopy}
                    requiredLocales={context.requiredLocales}
                    onChange={handleCopyChange}
                    onSave={() => void handleSaveCopy()}
                    saving={busy}
                    editable={context.editable}
                  />
                )}
              </div>
            </section>

            <section aria-labelledby="distribution-invitations" className="flex flex-col gap-panel-gap">
              <H2 id="distribution-invitations">{t('surveys.distribution.invitationsTitle')}</H2>
              {/* Counts from the distribution detail's summary, which is never
                  filtered: driving them off the filtered response would zero every
                  other chip the moment one was chosen. */}
              <InvitationStatusChips
                value={statusFilter}
                summary={distribution.invitations}
                anonymity={invitations.anonymity}
                onChange={(status) => void handleStatusFilter(status)}
                disabled={busy}
              />
              <div className="rounded-lg border border-line-light bg-surface-panel p-panel">
                <InvitationTable
                  invitations={invitations.invitations}
                  anonymity={invitations.anonymity}
                  busyInvitationId={busyInvitationId}
                  onResend={(id) =>
                    void handleInvitationAction(id, (invitationId) =>
                      resendSurveyInvitation(baseUrl, surveyId, invitationId),
                    )
                  }
                  onRevoke={(id) =>
                    void handleInvitationAction(id, (invitationId) =>
                      revokeSurveyInvitation(baseUrl, surveyId, invitationId),
                    )
                  }
                />
              </div>
            </section>

            <section aria-labelledby="distribution-share" className="flex flex-col gap-panel-gap">
              <H2 id="distribution-share">{t('surveys.distribution.shareLinkTitle')}</H2>
              {/* The link and its QR code side by side, because they are one artefact in
                  two formats and CLIMA-005 promises both. `ShareLinkQr` renders NOTHING
                  when `publicLink` is null or the access type is not `public`, so this row
                  collapses to the link panel alone on an invitation-only survey rather
                  than reserving an empty column for a code that does not exist. Both are
                  handed the SAME `publicLink`: whatever the panel reveals is exactly what
                  the code encodes, and there is no second source for either to drift to. */}
              <div className="flex flex-col gap-panel-gap md:flex-row md:items-start">
                <div className="min-w-0 flex-1 rounded-lg border border-line-light bg-surface-panel p-panel">
                  <ShareLinkPanel
                    publicLink={distribution.publicLink}
                    accessType={distribution.accessType}
                    totalAccesses={distribution.totalAccesses}
                    uniqueVisitors={distribution.uniqueVisitors}
                    lastRegeneratedAt={distribution.lastRegeneratedAt}
                    busy={busy}
                    onCreate={() =>
                      void run(async () => {
                        setDistribution(
                          await updateSurveyDistribution(baseUrl, surveyId, { accessType: 'public' }),
                        )
                      })
                    }
                    onRegenerate={() =>
                      void run(async () => {
                        setDistribution(await regenerateSurveyLink(baseUrl, surveyId))
                      })
                    }
                    onRevoke={() =>
                      void run(async () => {
                        setDistribution(await revokeSurveyLink(baseUrl, surveyId))
                      })
                    }
                  />
                </div>
                <ShareLinkQr
                  publicLink={distribution.publicLink}
                  accessType={distribution.accessType}
                  surveyId={surveyId}
                />
              </div>
            </section>

            <ConfirmationDialog
              open={confirming}
              onOpenChange={setConfirming}
              title={t('surveys.distribution.confirmTitle')}
              description={t('surveys.distribution.confirmBody', { count: recipientCount })}
              confirmText={t('surveys.distribution.sendInvitations')}
              cancelText={t('common.cancel')}
              onConfirm={() => void handleSend()}
            />
          </>
        )}
      </div>
    </div>
  )
}
