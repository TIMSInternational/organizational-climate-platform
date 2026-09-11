import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from '../../../../i18n'
import { useViewerCapabilities } from '../../../../auth/viewerCapabilities'
import { listDepartments, type Department } from '../../../org-structure/api/departments'
import { duplicateSurvey, getSurvey, updateSurveyStatus, type SurveyDetail } from '../../api/surveys'
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
        setState({ status: 'ready', model: { survey, departments: null, distribution: undefined, invitations: null } })
        return
      }
      const [distribution, invitations, departments] = await Promise.allSettled([
        getSurveyDistribution(baseUrl, id),
        listSurveyInvitations(baseUrl, id, {}, locale),
        listDepartments(baseUrl, survey.companyId),
      ])
      setState({
        status: 'ready',
        model: {
          survey,
          distribution: distribution.status === 'fulfilled' ? distribution.value : undefined,
          invitations: invitations.status === 'fulfilled' ? invitations.value : null,
          departments: departments.status === 'fulfilled' && Array.isArray(departments.value) ? departments.value : null,
        },
      })
    } catch (error) {
      setState({ status: 'error', message: error instanceof Error ? error.message : t('errors.generic') })
    }
  }, [baseUrl, id, locale, readsContext, t])

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
        setActionError(error instanceof Error ? error.message : t('errors.generic'))
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
      setActionError(error instanceof Error ? error.message : t('errors.generic'))
    } finally {
      setPending(null)
    }
  }, [baseUrl, id, locale, navigate, t])

  return { state, reload: load, transition, duplicate, pending, actionError }
}
