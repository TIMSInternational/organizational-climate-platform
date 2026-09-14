import { useCallback, useEffect, useState } from 'react'
import { useTranslation, type Locale } from '../../../../i18n'
import { useCompanyScope } from '../../../../company-context'
import { useViewerCapabilities } from '../../../../auth/viewerCapabilities'
import { listDepartments, type Department } from '../../../org-structure/api/departments'
import { listUsers, type User } from '../../../org-structure/api/users'
import { getSurvey, type SurveyDetail } from '../../api/surveys'
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
  type SurveyAudienceSelection,
  type SurveyDistributionDetail,
  type SurveyInvitationList,
} from '../../api/surveyDistribution'
import {
  getSurveyInvitationCopy,
  saveSurveyInvitationCopy,
  type InvitationCopyByLocale,
  type InvitationCopyField,
  type SurveyInvitationCopy,
} from '../../api/surveyInvitationCopy'

export interface DistributionModel {
  survey: SurveyDetail
  /** Null when the survey has no distribution row yet — the normal state of a new survey. */
  distribution: SurveyDistributionDetail | null
  invitations: SurveyInvitationList
  /** The survey company's directory; empty for a viewer scoped elsewhere, who is offered nothing. */
  departments: Department[]
  users: User[]
  /** The viewer administers the survey's own company — the audience may be read and changed. */
  scoped: boolean
}

export type DistributionState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; model: DistributionModel }

/** The invitation's own words, read on demand: the editor is a dialog most visits never open. */
export type InvitationCopyState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; context: SurveyInvitationCopy; draft: InvitationCopyByLocale }

/** Every write the page offers — each one the previous page's (`pages/SurveyDistributionPage.tsx`). */
export interface DistributionActions {
  invite: (selection: SurveyAudienceSelection) => void
  remind: () => void
  createLink: () => void
  regenerateLink: () => void
  revokeLink: () => void
  resendInvitation: (invitationId: string) => void
  revokeInvitation: (invitationId: string) => void
  openCopy: () => void
  editCopy: (locale: Locale, field: InvitationCopyField, text: string) => void
  /** Resolves true once saved, so the dialog closes on success and stays open on a failure. */
  saveCopy: () => Promise<boolean>
}

/**
 * The model behind `/surveys/:surveyId/distribution` — THE wiring seam of Distribución,
 * redesigned. The reads and writes are the previous page's (`pages/SurveyDistributionPage.tsx`,
 * kept as the wiring reference): the survey first, because its `companyId` decides whether the
 * directory may be asked for at all; then the distribution (null on 404) and the invitation list
 * in the reader's language, whose `anonymity.guarantee` is the sentence the server writes. The
 * share link's replace and delete, each invitation's resend and revoke, and the invitation's own
 * text are the old page's writes too, so nothing the old route reached is lost at this one.
 */
export function useDistributionModel(surveyId: string) {
  const { t, locale } = useTranslation()
  const scope = useCompanyScope()
  const caps = useViewerCapabilities()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [state, setState] = useState<DistributionState>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [busyInvitationId, setBusyInvitationId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [copy, setCopy] = useState<InvitationCopyState>({ status: 'idle' })

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const survey = await getSurvey(baseUrl, surveyId, locale)
      const [distribution, invitations] = await Promise.all([
        getSurveyDistribution(baseUrl, surveyId),
        listSurveyInvitations(baseUrl, surveyId, {}, locale),
      ])
      const scoped = caps.canAuthorSurveys && scope.status === 'ready' && scope.companyId === survey.companyId
      let departments: Department[] = []
      let users: User[] = []
      if (scoped) {
        const [departmentList, userList] = await Promise.allSettled([
          listDepartments(baseUrl, survey.companyId),
          listUsers(baseUrl, survey.companyId),
        ])
        departments = departmentList.status === 'fulfilled' ? departmentList.value : []
        users = userList.status === 'fulfilled' ? userList.value : []
      }
      setState({ status: 'ready', model: { survey, distribution, invitations, departments, users, scoped } })
    } catch (error) {
      setState({ status: 'error', message: error instanceof Error ? error.message : t('surveys.distribution.loadFailed') })
    }
  }, [baseUrl, caps.canAuthorSurveys, locale, scope.companyId, scope.status, surveyId, t])

  useEffect(() => {
    void load()
  }, [load])

  const run = useCallback(
    async (action: () => Promise<string | null>): Promise<boolean> => {
      setBusy(true)
      setActionError(null)
      setNotice(null)
      try {
        setNotice(await action())
        if (state.status === 'ready') {
          const [distribution, invitations] = await Promise.all([
            getSurveyDistribution(baseUrl, surveyId),
            listSurveyInvitations(baseUrl, surveyId, {}, locale),
          ])
          setState({ status: 'ready', model: { ...state.model, distribution, invitations } })
        }
        return true
      } catch (error) {
        setActionError(error instanceof Error ? error.message : t('surveys.distribution.actionFailed'))
        return false
      } finally {
        setBusy(false)
      }
    },
    [baseUrl, locale, state, surveyId, t],
  )

  const perInvitation = (invitationId: string, act: (id: string) => Promise<unknown>) => {
    setBusyInvitationId(invitationId)
    void run(async () => {
      await act(invitationId)
      return null
    }).finally(() => setBusyInvitationId(null))
  }

  const actions: DistributionActions = {
    /** `POST /surveys/{id}/invitations`. "Queued", never "sent": the call writes notification rows. */
    invite: (selection) =>
      void run(async () => {
        const result = await createSurveyInvitations(baseUrl, surveyId, selection)
        const skipped = result.requested - result.created
        return skipped > 0
          ? t('surveys.distribution.invitationsQueuedWithSkips', { count: result.created, skipped })
          : t('surveys.distribution.invitationsQueued', { count: result.created })
      }),
    /** `POST /surveys/{id}/invitations/reminders` — only to those who have not answered. */
    remind: () =>
      void run(async () => {
        const result = await sendSurveyReminders(baseUrl, surveyId)
        return t('surveys.distribution.remindersQueued', { count: result.queued, skipped: result.skippedTooSoon })
      }),
    /** `PUT /surveys/{id}/distribution` with `accessType: 'public'` mints the share link. */
    createLink: () =>
      void run(async () => {
        await updateSurveyDistribution(baseUrl, surveyId, { accessType: 'public' })
        return null
      }),
    /** The old link stops working and a new one is minted. */
    regenerateLink: () =>
      void run(async () => {
        await regenerateSurveyLink(baseUrl, surveyId)
        return null
      }),
    /** The survey is reachable by invitation only afterwards. */
    revokeLink: () =>
      void run(async () => {
        await revokeSurveyLink(baseUrl, surveyId)
        return null
      }),
    resendInvitation: (invitationId) => perInvitation(invitationId, (id) => resendSurveyInvitation(baseUrl, surveyId, id)),
    revokeInvitation: (invitationId) => perInvitation(invitationId, (id) => revokeSurveyInvitation(baseUrl, surveyId, id)),
    openCopy: () => {
      setCopy({ status: 'loading' })
      getSurveyInvitationCopy(baseUrl, surveyId, locale as Locale)
        .then((context) => setCopy({ status: 'ready', context, draft: context.copy }))
        .catch(() => setCopy({ status: 'error' }))
    },
    editCopy: (target, field, text) =>
      setCopy((current) =>
        current.status !== 'ready'
          ? current
          : { ...current, draft: { ...current.draft, [target]: { ...current.draft[target], [field]: { text, authored: true } } } },
      ),
    saveCopy: async () => {
      if (copy.status !== 'ready') return false
      const { context, draft } = copy
      return run(async () => {
        await saveSurveyInvitationCopy(baseUrl, surveyId, draft, context.requiredLocales)
        const refreshed = await getSurveyInvitationCopy(baseUrl, surveyId, locale as Locale)
        setCopy({ status: 'ready', context: refreshed, draft: refreshed.copy })
        return t('surveys.distribution.copySaved')
      })
    },
  }

  return { state, reload: load, busy, busyInvitationId, notice, actionError, copy, actions }
}
