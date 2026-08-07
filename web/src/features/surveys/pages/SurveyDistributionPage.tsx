import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { useTranslation, type Locale } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { Button, Card, CardContent, ConfirmationDialog, SectionLabel } from '../../../components/ui'
import { useCompanyScope } from '../../../company-context'
import {
  AudienceSelector,
  DistributionProgress,
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
} from '../api/surveyDistribution'
import {
  getSurveyInvitationCopy,
  saveSurveyInvitationCopy,
  type InvitationCopyByLocale,
  type InvitationCopyField,
  type SurveyInvitationCopy,
} from '../api/surveyInvitationCopy'
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
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  const [context, setContext] = useState<SurveyInvitationCopy | null>(null)
  const [distribution, setDistribution] = useState<SurveyDistributionDetail | null>(null)
  const [invitations, setInvitations] = useState<SurveyInvitationList | null>(null)
  const [departments, setDepartments] = useState<Department[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [busyInvitationId, setBusyInvitationId] = useState<string | null>(null)

  const [mode, setMode] = useState<AudienceMode>('allTargeted')
  const [selectedDepartmentIds, setSelectedDepartmentIds] = useState<string[]>([])
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])
  const [confirming, setConfirming] = useState(false)
  const [draftCopy, setDraftCopy] = useState<InvitationCopyByLocale | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
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
      setError(err instanceof Error ? err.message : t('surveys.distribution.loadFailed'))
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
      setNotice(t('surveys.distribution.invitationsQueued', { count: result.created }))
      setInvitations(await listSurveyInvitations(baseUrl, surveyId))
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
      setInvitations(await listSurveyInvitations(baseUrl, surveyId))
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
        setInvitations(await listSurveyInvitations(baseUrl, surveyId))
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

  function handleCopyChange(target: Locale, field: InvitationCopyField, text: string): void {
    setDraftCopy((current) =>
      current === null
        ? current
        : { ...current, [target]: { ...current[target], [field]: { text, authored: true } } },
    )
  }

  return (
    <div className="flex flex-col gap-section">
      <PageTopBar
        title={t('surveys.distribution.title')}
        description={context?.survey.title ?? undefined}
      />

      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      {loading || context === null || distribution === null || invitations === null ? (
        <p>{t('common.loading')}</p>
      ) : (
        <>
          <DistributionProgress
            summary={invitations.summary}
            anonymity={invitations.anonymity}
            responseCount={context.survey.responseCount}
          />

          <Card>
            <CardContent className="flex flex-col gap-panel-gap">
              <SectionLabel>{t('surveys.distribution.audienceTitle')}</SectionLabel>
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
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <ShareLinkPanel
                publicLink={distribution.publicLink}
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
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-panel-gap">
              <SectionLabel>{t('surveys.distribution.copyTitle')}</SectionLabel>
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
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-panel-gap">
              <SectionLabel>{t('surveys.distribution.invitationsTitle')}</SectionLabel>
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
            </CardContent>
          </Card>

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
  )
}
