import { authFetch } from '../../../api/authFetch'
import type { SurveyRespondView } from './surveyResponses'

/**
 * `GET /surveys/{id}/respond-preview` — «Ver como quien responde» (ruled 2026-11-19).
 *
 * `view` is byte for byte what a visitor to the survey's link is served by the respond GET,
 * built by the same server function, with no in-progress answers. The route writes nothing.
 * Administrators of the survey only, in any status but archived (409
 * `respond_preview_archived`, said by `describeApiError`).
 */
export interface RespondPreview {
  view: SurveyRespondView
  companyName: string | null
  companyLogoUrl: string | null
  status: string
}

export async function getRespondPreview(baseUrl: string, surveyId: string, lang: string): Promise<RespondPreview> {
  const query = new URLSearchParams({ lang })
  const response = await authFetch(`${baseUrl}/surveys/${encodeURIComponent(surveyId)}/respond-preview?${query.toString()}`)
  return (await response.json()) as RespondPreview
}
