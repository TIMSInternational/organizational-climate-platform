import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from '../../../../i18n'
import { getEmployeeDashboard, getEmployeeLastOutcome } from '../../api/dashboard'
import { useDashboardData } from '../../useDashboardData'
import { getSurveyRespondView } from '../../../surveys/api/surveyResponses'
import { composeEmployeeHome } from './compose'
import type { EmployeeHomeModel } from './model'

export interface EmployeeHomeState {
  /** `null` until `GET /dashboard/employee` has answered. */
  model: EmployeeHomeModel | null
  loading: boolean
  failed: boolean
  error: string | null
  reload: () => void
}

/**
 * **The wiring seam for the employee Home.** The view below it never fetches.
 *
 * Three reads through the clients the app already had, and no new endpoint:
 *
 * | Region                                   | Endpoint                               |
 * |------------------------------------------|----------------------------------------|
 * | greeting, department, the surveys owed   | `GET /dashboard/employee`              |
 * | "Qué pasó con la anterior"               | `GET /dashboard/employee/last-outcome` |
 * | "Puede guardar y terminar después."      | `GET /surveys/{lead}/respond`          |
 *
 * **Only the first can take the page down.** It is the reason the page exists — the
 * survey this person owes — so its failure is the page's error band with a retry. The
 * other two are supplementary and fail into silence: a refused last-outcome draws no
 * card (`null` is the endpoint's own "nothing has closed", and a zero-filled card would
 * describe a survey that never happened), and a refused respond view drops the one
 * sentence it would have justified. Neither is ever guessed.
 *
 * The respond view is read for the **lead** survey only, and only for its
 * `allowPartialResponses`: "you can save and finish later" is a promise about a setting
 * of that survey, and `DashboardPendingSurvey` does not carry it. `GET
 * /surveys/{id}/respond` is a read — `SurveyResponseEndpoints.GetRespondViewAsync` loads
 * with `AsNoTracking` and writes nothing — so asking it costs the respondent nothing, and
 * it is the same request the page the button opens makes on arrival.
 */
export function useEmployeeHomeModel(): EmployeeHomeState {
  const { locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  // The clock the countdowns are measured against, read once per mount so a page left
  // open does not recount under the reader's eyes.
  const [asOf] = useState(() => new Date().toISOString())

  const loadHome = useCallback(() => getEmployeeDashboard(baseUrl, locale), [baseUrl, locale])
  const home = useDashboardData(loadHome)

  const loadOutcome = useCallback(() => getEmployeeLastOutcome(baseUrl, locale), [baseUrl, locale])
  const outcome = useDashboardData(loadOutcome)

  const leadId = home.data?.pendingSurveys[0]?.id ?? null
  const [savable, setSavable] = useState<{ id: string; allows: boolean } | null>(null)
  useEffect(() => {
    if (leadId === null) return
    let cancelled = false
    getSurveyRespondView(baseUrl, leadId, { lang: locale })
      .then((view) => {
        // A literal `true`: a body that is not a respond view makes no promise.
        if (!cancelled) setSavable({ id: leadId, allows: view.allowPartialResponses === true })
      })
      .catch(() => {
        // Silence. The sentence is dropped rather than asserted about a setting this
        // page could not read; the button still opens the survey, which says it itself.
      })
    return () => {
      cancelled = true
    }
  }, [baseUrl, leadId, locale])

  const model = useMemo(() => {
    if (home.data === null) return null
    return composeEmployeeHome({
      dashboard: home.data,
      // A refused read is the same, to this page, as "nothing has closed": no card.
      lastOutcome: outcome.failed ? null : outcome.data,
      leadAllowsSaveForLater: savable !== null && savable.id === leadId ? savable.allows : null,
      asOf,
    })
  }, [asOf, home.data, leadId, outcome.data, outcome.failed, savable])

  return {
    model,
    loading: home.loading,
    failed: home.failed,
    error: home.error,
    reload: home.reload,
  }
}
