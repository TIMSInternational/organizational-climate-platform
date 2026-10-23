import { describe, expect, it } from 'vitest'
import { createTranslator, CATALOGUES } from '../../i18n'
import { draftValuesFrom, toDraftContent } from './draftContent'
import {
  audienceChoiceOf,
  buildCreateInput,
  buildInstantiateInput,
  emptyWizardValues,
  windowInstant,
  wizardStepErrors,
  type SurveyWizardValues,
} from './wizardValues'

const t = createTranslator(CATALOGUES.es)
const CR = 'America/Costa_Rica'

function filled(over: Partial<SurveyWizardValues> = {}): SurveyWizardValues {
  return {
    ...emptyWizardValues('es'),
    titleEs: 'Teletrabajo 2026',
    startDate: '2026-10-20T08:00',
    endDate: '2026-10-28T23:59',
    departmentIds: ['d1'],
    userIds: ['u1', 'u2'],
    ...over,
  }
}

describe('the audience the builder sends (G14)', () => {
  it('sends the named people, and no department, when "Personas específicas" is chosen', () => {
    const input = buildCreateInput(filled({ audienceMode: 'people' }), 'c1', CR)
    expect(input.userIds).toEqual(['u1', 'u2'])
    // A department ticked before switching stays in the form but is never sent beside the
    // people: the server reads the pair as a UNION and would widen the survey.
    expect(input.departmentIds).toBeUndefined()
  })

  it('sends departments alone for "Departamentos", and neither list for the whole company', () => {
    const byDepartment = buildCreateInput(filled({ audienceMode: 'departments' }), 'c1', CR)
    expect(byDepartment.departmentIds).toEqual(['d1'])
    expect(byDepartment.userIds).toBeUndefined()
    const everyone = buildCreateInput(filled({ audienceMode: 'company' }), 'c1', CR)
    expect(everyone.departmentIds).toBeUndefined()
    expect(everyone.userIds).toBeUndefined()
  })

  it('sends each person once', () => {
    expect(buildCreateInput(filled({ audienceMode: 'people', userIds: ['u1', 'u2', 'u1'] }), 'c1', CR).userIds).toEqual(['u1', 'u2'])
  })

  it('keeps people off the template body, which has no such field, and keeps its departments', () => {
    const viaTemplate = buildInstantiateInput(filled({ templateId: 't1', audienceMode: 'people' }), 'c1', CR) as unknown as Record<string, unknown>
    expect(viaTemplate.userIds).toBeUndefined()
    expect(viaTemplate.departmentIds).toBeUndefined()
    expect(buildInstantiateInput(filled({ templateId: 't1', audienceMode: 'departments' }), 'c1', CR).departmentIds).toEqual(['d1'])
  })

  it('refuses a chosen audience with nobody in it: an empty list is the WHOLE company on the server', () => {
    expect(wizardStepErrors(filled({ audienceMode: 'people', userIds: [] }), t).audience).toEqual([
      t('surveys.next.builder.audience.peopleRequired'),
    ])
    expect(wizardStepErrors(filled({ audienceMode: 'departments', departmentIds: [] }), t).audience).toEqual([
      t('surveys.next.builder.audience.departmentsRequired'),
    ])
    expect(wizardStepErrors(filled({ audienceMode: 'company', departmentIds: [], userIds: [] }), t).audience).toEqual([])
  })

  it("refuses a person who is no longer active, as the server's ValidateUsersAsync would", () => {
    const errors = wizardStepErrors(filled({ audienceMode: 'people' }), t, null, new Set(['u1'])).audience
    expect(errors).toEqual([t('surveys.next.builder.audience.peopleInactive', { count: 1 })])
    expect(wizardStepErrors(filled({ audienceMode: 'people' }), t, null, new Set(['u1', 'u2'])).audience).toEqual([])
  })

  it('reads a values object from before G14 as it meant then', () => {
    expect(audienceChoiceOf({ departmentIds: ['d1'] })).toBe('departments')
    expect(audienceChoiceOf({ departmentIds: [] })).toBe('company')
  })
})

describe('a builder draft keeps its people (G14)', () => {
  it('round-trips the choice and the people through the stored draft', () => {
    const restored = draftValuesFrom(toDraftContent(filled({ audienceMode: 'people' })), 'p', 'es')!
    expect(restored.audienceMode).toBe('people')
    expect(restored.userIds).toEqual(['u1', 'u2'])
    // And what it would send is what it was going to send before the reload.
    expect(buildCreateInput(restored, 'c1', CR).userIds).toEqual(['u1', 'u2'])
  })

  it('restores a draft written before G14 with no people and the audience it had', () => {
    const legacy = toDraftContent(filled()) as unknown as Record<string, unknown>
    delete legacy.audienceMode
    delete legacy.userIds
    const restored = draftValuesFrom(legacy, 'p', 'es')!
    expect(audienceChoiceOf(restored)).toBe('departments')
    expect(restored.userIds ?? []).toEqual([])
    expect(buildCreateInput(restored, 'c1', CR).userIds).toBeUndefined()
  })
})

describe("the builder's dates are the company's clock (G16)", () => {
  it("turns the typed wall clock into the instant it is in the company's zone, not the browser's", () => {
    // 23:59 in Costa Rica (UTC-6, no DST) is 05:59 UTC the next day, wherever the laptop is.
    const input = buildCreateInput(filled(), 'c1', CR)
    expect(input.startDate).toBe('2026-10-20T14:00:00.000Z')
    expect(input.endDate).toBe('2026-10-29T05:59:00.000Z')
    const tokyo = buildInstantiateInput(filled({ templateId: 't1' }), 'c1', 'Asia/Tokyo')
    expect(tokyo.endDate).toBe('2026-10-28T14:59:00.000Z')
  })

  it('lands on the reading the zone has across a daylight-saving change', () => {
    // New York falls back at 02:00 EDT on 1 Nov 2026. 03:00 that day is EST (UTC-5): 08:00 UTC,
    // not the 07:00 the summer offset at the naive guess would give.
    expect(windowInstant('2026-11-01T03:00', 'America/New_York')).toBe('2026-11-01T08:00:00.000Z')
    expect(windowInstant('2026-10-31T12:00', 'America/New_York')).toBe('2026-10-31T16:00:00.000Z')
    // Spring forward, 8 Mar 2026: 12:00 is EDT, UTC-4.
    expect(windowInstant('2026-03-08T12:00', 'America/New_York')).toBe('2026-03-08T16:00:00.000Z')
  })

  it("falls back to the browser's zone only when the company's cannot be read", () => {
    const local = new Date('2026-10-20T08:00').toISOString()
    expect(windowInstant('2026-10-20T08:00', null)).toBe(local)
    expect(windowInstant('2026-10-20T08:00', 'Not/AZone')).toBe(local)
  })
})
