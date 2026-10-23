import type { SurveyDetail } from '../../api/surveys'

/**
 * What "Editar audiencia" may change on a survey, as `PUT /surveys/{id}` decides it
 * (`SurveyEndpoints.UpdateAsync`) -- never a client table of its own:
 *
 * - `all`: departments AND named people. A draft nobody has answered: departments are content
 *   (`touchesContent`), and content moves only there (`isContentEditable`, plus no responses).
 * - `people`: named people only. Scheduled or active, or a draft that already has answers:
 *   `userIds` is outside `touchesContent` and allowed while `AllowsScheduleEdit` holds.
 * - `ended`: nothing. Closed or archived: 400 `survey_ended_audience_frozen` (#627).
 *
 * A status this screen does not know is treated as ended: offering a save the server may refuse
 * is worse than offering none.
 */
export type AudienceEditability = 'all' | 'people' | 'ended'

const LIVE: readonly string[] = ['draft', 'scheduled', 'active']

export function audienceEditability(survey: Pick<SurveyDetail, 'status' | 'isContentEditable' | 'responseCount'>): AudienceEditability {
  if (!LIVE.includes(survey.status)) return 'ended'
  return survey.isContentEditable && survey.responseCount === 0 ? 'all' : 'people'
}

/** The survey's frozen credential mode (`settings.credentialMode`); absent reads as `shared`. */
export function credentialModeOf(survey: Pick<SurveyDetail, 'settings'>): 'shared' | 'per_survey' {
  const mode = (survey.settings as { credentialMode?: string | null } | undefined)?.credentialMode
  return mode === 'per_survey' ? 'per_survey' : 'shared'
}

/** Same members, ignoring order and repeats. */
export function sameIds(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a)
  const right = new Set(b)
  return left.size === right.size && [...left].every((id) => right.has(id))
}
