import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '../../../../i18n'
import { getEmployeeDashboard } from '../../../dashboard/api/dashboard'
import { listMySurveys, type MySurveyListItem } from '../../api/surveys'

export interface MySurveysModelState {
  status: 'loading' | 'ready' | 'error'
  surveys: MySurveyListItem[]
  /** The server's own message when the list failed; `null` when there was none. */
  error: string | null
  /**
   * The reader's own department, for the artboard's eyebrow. `null` until the supplementary
   * read answers — and for good if it fails, or if this reader has no department.
   */
  departmentName: string | null
  reload: () => void
}

/**
 * **The wiring seam for My Surveys.** The view below it never fetches.
 *
 * | Region | Endpoint |
 * |---|---|
 * | the list, and every group on it | `GET /surveys/my` |
 * | "INGENIERÍA · EMPLEADO" | `GET /dashboard/employee` |
 *
 * **Only the first can take the page down.** It is the reason the page exists, so its
 * failure is the page's error band with a retry. The second is supplementary and fails into
 * silence: the eyebrow then names the role alone, which is true, rather than a department
 * this page could not read. Both resolve the caller's **own user row** and read no role
 * claim, which is what makes this page loadable by `employee`, `supervisor` and `leader`.
 *
 * `reload` retries **both**, because a reader who retries after a network drop should not be
 * left with a half-loaded header.
 */
export function useMySurveysModel(): MySurveysModelState {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [status, setStatus] = useState<MySurveysModelState['status']>('loading')
  const [surveys, setSurveys] = useState<MySurveyListItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [departmentName, setDepartmentName] = useState<string | null>(null)
  /**
   * Which request is allowed to publish. A counter rather than an effect-cleanup flag,
   * because `reload` needs the same protection and has no cleanup to hang one on: click
   * Retry twice on a slow link and the first attempt would otherwise land last and win.
   * The same guard `useDashboardData` carries, and for the same reason.
   */
  const [generation, setGeneration] = useState(0)

  const reload = useCallback(() => setGeneration((value) => value + 1), [])

  useEffect(() => {
    let current = true
    setStatus('loading')
    setError(null)

    listMySurveys(baseUrl, locale)
      .then((rows) => {
        if (!current) return
        setSurveys(rows)
        setStatus('ready')
      })
      .catch((err: unknown) => {
        if (!current) return
        setSurveys([])
        setError(err instanceof Error ? err.message : t('errors.generic'))
        setStatus('error')
      })

    getEmployeeDashboard(baseUrl, locale)
      .then((dashboard) => {
        if (current) setDepartmentName(dashboard.departmentName)
      })
      .catch(() => {
        // Silence. The eyebrow drops to the role rather than naming a department this page
        // could not read; the list above it is unaffected.
        if (current) setDepartmentName(null)
      })

    return () => {
      current = false
    }
  }, [baseUrl, generation, locale, t])

  return { status, surveys, error, departmentName, reload }
}
