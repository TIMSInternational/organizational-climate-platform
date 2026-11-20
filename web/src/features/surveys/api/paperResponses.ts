import { authFetch } from '../../../api/authFetch'
import type { SurveyAnswerInput, SurveyRespondView } from './surveyResponses'
import { toQuestionInputs, type AuthoringQuestion } from './surveyQuestionAuthoring'

/**
 * Two TIMS operator routes ruled 2026-11-19 (`docs/decisions/editable-respondent-content.md`):
 * a paper questionnaire typed from a roster row, and a wording-only correction of a survey that
 * already has answers. Both are super admin only (`PaperResponseEndpoints.cs`).
 */

/** `GET /surveys/{surveyId}/paper-responses/{userId}`: the survey as this person is served it. */
export interface PaperResponseForm {
  survey: SurveyRespondView
  userId: string
  name: string
  email: string
}

/** What an entry returns. No response id, on purpose: on an anonymous survey it would be the join. */
export interface PaperResponseResult {
  surveyId: string
  userId: string
  status: 'completed'
}

export async function getPaperResponseForm(
  baseUrl: string,
  surveyId: string,
  userId: string,
  lang: string,
): Promise<PaperResponseForm> {
  const query = new URLSearchParams({ lang })
  const response = await authFetch(
    `${baseUrl}/surveys/${encodeURIComponent(surveyId)}/paper-responses/${encodeURIComponent(userId)}?${query.toString()}`,
  )
  return response.json() as Promise<PaperResponseForm>
}

/**
 * Records the paper as this person's completed response, through the respondent's own write path:
 * the same validation, the same rows. Their account is never touched.
 */
export async function enterPaperResponse(
  baseUrl: string,
  surveyId: string,
  userId: string,
  request: { answers: SurveyAnswerInput[]; language: string },
): Promise<PaperResponseResult> {
  const response = await authFetch(
    `${baseUrl}/surveys/${encodeURIComponent(surveyId)}/paper-responses/${encodeURIComponent(userId)}`,
    { method: 'POST', body: JSON.stringify(request) },
  )
  return response.json() as Promise<PaperResponseResult>
}

export interface SurveyWordingResult {
  surveyId: string
  version: number
  changedQuestionIds: string[]
}

/**
 * `PUT /surveys/{surveyId}/wording`: every question as the editor holds it, with its id. The server
 * applies the words in place and refuses (409, naming the field) anything else that differs, so
 * the payload is the editor's own `toQuestionInputs` -- every option's stored `value` carried
 * verbatim -- and never a second serialisation that could drift from it.
 */
export async function correctSurveyWording(
  baseUrl: string,
  surveyId: string,
  questions: AuthoringQuestion[],
): Promise<SurveyWordingResult> {
  const inputs = toQuestionInputs(questions)
  const response = await authFetch(`${baseUrl}/surveys/${encodeURIComponent(surveyId)}/wording`, {
    method: 'PUT',
    body: JSON.stringify({
      questions: questions.map((question, index) => ({ id: question.id, ...(inputs[index] as object) })),
    }),
  })
  return response.json() as Promise<SurveyWordingResult>
}
