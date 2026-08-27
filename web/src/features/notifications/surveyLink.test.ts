import { describe, expect, it } from 'vitest'
import { surveyRespondPathFor } from './surveyLink'

const SURVEY = '44444444-4444-4444-4444-444444440004'

/** What `SurveyNotificationData.Serialize` actually writes. */
function payload(surveyId: string): string {
  return JSON.stringify({
    surveyId,
    surveyInvitationId: '55555555-5555-5555-5555-555555550001',
  })
}

describe('surveyRespondPathFor', () => {
  it('routes a survey invitation to the respond screen for the survey it names', () => {
    expect(surveyRespondPathFor({ type: 'survey_invitation', data: payload(SURVEY) })).toBe(
      `/surveys/${SURVEY}/respond`,
    )
  })

  it('routes a survey reminder the same way', () => {
    expect(surveyRespondPathFor({ type: 'survey_reminder', data: payload(SURVEY) })).toBe(
      `/surveys/${SURVEY}/respond`,
    )
  })

  /**
   * The gate that matters most. `survey_completion` announces published results, which a
   * respondent has no route to; offering the respond screen would invite them to re-answer
   * a closed survey. The C# `LinkCarryingTypes` names two types and only two, and this
   * asserts the same two rather than "any type that happens to carry a surveyId".
   */
  it('offers nothing for a type outside LinkCarryingTypes, even when the payload names a survey', () => {
    for (const type of [
      'survey_completion',
      'deadline_reminder',
      'microclimate_invitation',
      'user_invitation',
      'action_plan_alert',
      'ai_insight_alert',
      'system_notification',
    ]) {
      expect(surveyRespondPathFor({ type, data: payload(SURVEY) }), type).toBeNull()
    }
  })

  it('offers nothing when there is no payload at all', () => {
    expect(surveyRespondPathFor({ type: 'survey_invitation', data: null })).toBeNull()
  })

  /**
   * `data` is a jsonb column a company admin can write verbatim through
   * `POST /notifications`, so every one of these is reachable from the wire. None may throw
   * inside a list render; all mean "no survey named here".
   */
  it('offers nothing, and never throws, for a payload that names no usable survey', () => {
    const unusable = [
      '',
      'not json at all',
      '{"surveyId":', // truncated
      'null',
      '7',
      '"a string"',
      '[]',
      `["${SURVEY}"]`,
      '{}',
      '{"surveyId":null}',
      '{"surveyId":7}',
      '{"surveyId":{"id":"x"}}',
      '{"surveyId":""}',
      '{"surveyId":"not-a-guid"}',
      '{"surveyInvitationId":"55555555-5555-5555-5555-555555550001"}',
    ]
    for (const data of unusable) {
      expect(() => surveyRespondPathFor({ type: 'survey_invitation', data })).not.toThrow()
      expect(surveyRespondPathFor({ type: 'survey_invitation', data }), data).toBeNull()
    }
  })

  /** Parses, so it would otherwise build a well-formed route to a survey that cannot exist. */
  it('rejects the empty guid in either case', () => {
    expect(
      surveyRespondPathFor({
        type: 'survey_invitation',
        data: payload('00000000-0000-0000-0000-000000000000'),
      }),
    ).toBeNull()
    expect(
      surveyRespondPathFor({
        type: 'survey_invitation',
        data: payload('00000000-0000-0000-0000-000000000000'.toUpperCase()),
      }),
    ).toBeNull()
  })

  it('accepts an upper-case guid, which is the same id', () => {
    expect(
      surveyRespondPathFor({ type: 'survey_invitation', data: payload(SURVEY.toUpperCase()) }),
    ).toBe(`/surveys/${SURVEY.toUpperCase()}/respond`)
  })
})
