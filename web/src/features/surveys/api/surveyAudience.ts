import { authFetch } from '../../../api/authFetch'
import type { SurveyDetail } from './surveys'

/**
 * `PUT /surveys/{id}` with a survey's new targets -- "Editar audiencia" on the detail page.
 *
 * What the server takes, measured in `SurveyEndpoints.UpdateAsync`:
 *
 * - `userIds` while the survey has not ended (draft, scheduled, active --
 *   `SurveyStatuses.AllowsScheduleEdit`); a closed or archived survey answers **400**
 *   `survey_ended_audience_frozen`. Every id must be an ACTIVE person of the survey's company,
 *   or the whole request is a 400.
 * - `departmentIds` only on a draft nobody has answered: they are content, and anywhere else
 *   the request is a **409**. So `departmentIds` is sent only when the caller passes it.
 *
 * The update writes the targets and an audit entry and nothing else: no notification row, no
 * invitation (`SurveyAudienceEditTests`). Who gets mail is decided on Distribución.
 */
export async function updateSurveyAudience(
  baseUrl: string,
  id: string,
  targets: { departmentIds?: readonly string[]; userIds: readonly string[] },
  lang?: string,
): Promise<SurveyDetail> {
  const body =
    targets.departmentIds === undefined
      ? { userIds: [...targets.userIds] }
      : { departmentIds: [...targets.departmentIds], userIds: [...targets.userIds] }
  const query = lang ? `?lang=${encodeURIComponent(lang)}` : ''
  const response = await authFetch(`${baseUrl}/surveys/${id}${query}`, { method: 'PUT', body: JSON.stringify(body) })
  return response.json() as Promise<SurveyDetail>
}
