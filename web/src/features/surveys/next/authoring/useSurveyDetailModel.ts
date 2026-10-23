import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from '../../../../i18n'
import { describeApiError } from '../../../../api/describeApiError'
import { useViewerCapabilities } from '../../../../auth/viewerCapabilities'
import { useCompanyScope } from '../../../../company-context'
import { listDepartments, type Department } from '../../../org-structure/api/departments'
import { listUsers, type User } from '../../../org-structure/api/users'
import { getCompanySettings } from '../../../org-structure/api/companySettings'
import {
  deleteSurvey,
  duplicateSurvey,
  getSurvey,
  updateSurveyStatus,
  updateSurveyWindow,
  type SurveyDetail,
} from '../../api/surveys'
import { updateSurveyAudience } from '../../api/surveyAudience'
import {
  getSurveyDistribution,
  listSurveyInvitations,
  type SurveyDistributionDetail,
  type SurveyInvitationList,
} from '../../api/surveyDistribution'

export interface SurveyDetailModel {
  survey: SurveyDetail
  /** `GET /admin/departments` for the survey's company, or null when unread (not an admin, or it failed). */
  departments: Department[] | null
  /** `GET /surveys/{id}/distribution`: null when none exists (404), undefined when unread. */
  distribution: SurveyDistributionDetail | null | undefined
  /** `GET /surveys/{id}/invitations`, or null when unread. */
  invitations: SurveyInvitationList | null
  /**
   * `GET /admin/users` for the survey's company — the directory the audience resolves from — or
   * null when unread. Read under Distribución's own rule (an administrator working in the
   * survey's company), so the two pages resolve the same audience for the same viewer.
   */
  users: User[] | null
  /**
   * The company's IANA zone (`GET /admin/companies/{id}/settings` → `settings.timezone`), the
   * clock the window editor reads and writes in, or null when unread.
   */
  timeZone?: string | null
}

export type SurveyDetailState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; model: SurveyDetailModel }

/**
 * The model behind `/surveys/:id` — THE wiring seam of Detalle de encuesta, redesigned.
 *
 * `GET /surveys/{id}` in the reader's locale is the screen; the three reads beside it are its
 * context and are made only for a viewer the server answers them for (`canAuthorSurveys` — the
 * same `CanAdminister` gate every one of them sits behind). A failed context read costs its own
 * card, never the page. The writes are the ones the previous page made
 * (`pages/SurveyDetailPage.tsx`, kept as the wiring reference): `PUT /surveys/{id}/status`, whose
 * response is the new detail, and `POST /surveys/{id}/duplicate`.
 */
export function useSurveyDetailModel(id: string | undefined) {
  const { t, locale } = useTranslation()
  const caps = useViewerCapabilities()
  const scope = useCompanyScope()
  const navigate = useNavigate()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [state, setState] = useState<SurveyDetailState>({ status: 'loading' })
  const [pending, setPending] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const readsContext = caps.canAuthorSurveys

  const load = useCallback(async () => {
    if (!id) return
    setState({ status: 'loading' })
    try {
      const survey = await getSurvey(baseUrl, id, locale)
      if (!readsContext) {
        setState({ status: 'ready', model: { survey, departments: null, distribution: undefined, invitations: null, users: null, timeZone: null } })
        return
      }
      const scoped = scope.status === 'ready' && scope.companyId === survey.companyId
      const [distribution, invitations, departments, users, settings] = await Promise.allSettled([
        getSurveyDistribution(baseUrl, id),
        listSurveyInvitations(baseUrl, id, {}, locale),
        listDepartments(baseUrl, survey.companyId),
        scoped ? listUsers(baseUrl, survey.companyId) : Promise.resolve(null),
        getCompanySettings(baseUrl, survey.companyId),
      ])
      setState({
        status: 'ready',
        model: {
          survey,
          distribution: distribution.status === 'fulfilled' ? distribution.value : undefined,
          invitations: invitations.status === 'fulfilled' ? invitations.value : null,
          departments: departments.status === 'fulfilled' && Array.isArray(departments.value) ? departments.value : null,
          users: users.status === 'fulfilled' && Array.isArray(users.value) ? users.value : null,
          timeZone: settings.status === 'fulfilled' ? (settings.value?.settings?.timezone ?? null) : null,
        },
      })
    } catch (error) {
      setState({ status: 'error', message: error instanceof Error ? error.message : t('errors.generic') })
    }
  }, [baseUrl, id, locale, readsContext, scope.companyId, scope.status, t])

  useEffect(() => {
    void load()
  }, [load])

  const transition = useCallback(
    async (status: string) => {
      if (!id || state.status !== 'ready') return
      setActionError(null)
      setPending(status)
      try {
        const survey = await updateSurveyStatus(baseUrl, id, status, locale)
        setState({ status: 'ready', model: { ...state.model, survey } })
      } catch (error) {
        setActionError(describeApiError(error, t))
      } finally {
        setPending(null)
      }
    },
    [baseUrl, id, locale, state, t],
  )

  const duplicate = useCallback(async () => {
    if (!id) return
    setActionError(null)
    setPending('duplicate')
    try {
      const copy = await duplicateSurvey(baseUrl, id, locale)
      navigate(`/surveys/${copy.id}`)
    } catch (error) {
      setActionError(describeApiError(error, t))
    } finally {
      setPending(null)
    }
  }, [baseUrl, id, locale, navigate, t])

  /**
   * `PUT /surveys/{id}` with the new window. Throws so the editor can say why, in its own words;
   * on success the page reads the detail the server answered with, so every tile -- the close,
   * "Activar" enabled or not -- moves with it.
   */
  const saveWindow = useCallback(
    async (window: { startDate?: string; endDate: string }) => {
      if (!id || state.status !== 'ready') return
      const survey = await updateSurveyWindow(baseUrl, id, window, locale)
      setState({ status: 'ready', model: { ...state.model, survey } })
    },
    [baseUrl, id, locale, state],
  )

  /**
   * `PUT /surveys/{id}` with the survey's new targets ("Editar audiencia"). `departmentIds` is
   * sent only when the dialog passes it, which it does only on a draft nobody has answered.
   * Throws so the dialog can say why; on success the page reads the detail the server answered
   * with, so the audience tile and card move with it.
   */
  const saveAudience = useCallback(
    async (targets: { departmentIds?: string[]; userIds: string[] }) => {
      if (!id || state.status !== 'ready') return
      const survey = await updateSurveyAudience(baseUrl, id, targets, locale)
      setState({ status: 'ready', model: { ...state.model, survey } })
    },
    [baseUrl, id, locale, state],
  )

  /** `DELETE /surveys/{id}`, then back to the list. Throws so the confirmation can say why. */
  const remove = useCallback(async () => {
    if (!id) return
    await deleteSurvey(baseUrl, id)
    navigate('/surveys')
  }, [baseUrl, id, navigate])

  return { state, reload: load, transition, duplicate, saveWindow, saveAudience, remove, pending, actionError }
}
