import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '../../../../i18n'
import { useCompanyScope } from '../../../../company-context'
import { useViewerCapabilities } from '../../../../auth/viewerCapabilities'
import { listDepartments, type Department } from '../../../org-structure/api/departments'
import { listUsers, type User } from '../../../org-structure/api/users'
import { getSurvey, type SurveyDetail } from '../../api/surveys'
import {
  createSurveyInvitations,
  getSurveyDistribution,
  listSurveyInvitations,
  sendSurveyReminders,
  updateSurveyDistribution,
  type SurveyAudienceSelection,
  type SurveyDistributionDetail,
  type SurveyInvitationList,
} from '../../api/surveyDistribution'

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

/**
 * The model behind `/surveys/:surveyId/distribution` — THE wiring seam of Distribución,
 * redesigned. The reads and writes are the previous page's (`pages/SurveyDistributionPage.tsx`,
 * kept as the wiring reference): the survey first, because its `companyId` decides whether the
 * directory may be asked for at all; then the distribution (null on 404) and the invitation list
 * in the reader's language, whose `anonymity.guarantee` is the sentence the server writes.
 */
export function useDistributionModel(surveyId: string) {
  const { t, locale } = useTranslation()
  const scope = useCompanyScope()
  const caps = useViewerCapabilities()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [state, setState] = useState<DistributionState>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

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
    async (action: () => Promise<string | null>) => {
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
      } catch (error) {
        setActionError(error instanceof Error ? error.message : t('surveys.distribution.actionFailed'))
      } finally {
        setBusy(false)
      }
    },
    [baseUrl, locale, state, surveyId, t],
  )

  /** `POST /surveys/{id}/invitations`. "Queued", never "sent": the call writes notification rows. */
  const invite = (selection: SurveyAudienceSelection) =>
    run(async () => {
      const result = await createSurveyInvitations(baseUrl, surveyId, selection)
      const skipped = result.requested - result.created
      return skipped > 0
        ? t('surveys.distribution.invitationsQueuedWithSkips', { count: result.created, skipped })
        : t('surveys.distribution.invitationsQueued', { count: result.created })
    })

  /** `POST /surveys/{id}/invitations/reminders` — only to those who have not answered. */
  const remind = () =>
    run(async () => {
      const result = await sendSurveyReminders(baseUrl, surveyId)
      return t('surveys.distribution.remindersQueued', { count: result.queued, skipped: result.skippedTooSoon })
    })

  /** `PUT /surveys/{id}/distribution` with `accessType: 'public'` mints the share link. */
  const createLink = () =>
    run(async () => {
      await updateSurveyDistribution(baseUrl, surveyId, { accessType: 'public' })
      return null
    })

  return { state, reload: load, busy, notice, actionError, invite, remind, createLink }
}
