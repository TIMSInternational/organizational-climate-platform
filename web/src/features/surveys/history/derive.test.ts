import { describe, expect, it } from 'vitest'
import { createTranslator } from '../../../i18n/translate'
import en from '../../../i18n/en.json'
import es from '../../../i18n/es.json'
import type { SurveyVersionDetail } from './api'
import { changeRows, entryHeadline, fieldLabel, formatInstant, parsePath, positionOf, roleName, type ValueContext } from './derive'

/**
 * Every field path `SurveyVersioning.Diff` can emit (`SurveyVersioning.cs`: the top-level
 * fields, `SettingsFields`, `departmentIds`, `DiffQuestions`). Copied from the C# by hand, so a
 * path added there and not here is what this list misses — the page then prints "Otro campo",
 * never a raw path.
 */
const DIFF_PATHS = [
  'title', 'description', 'type', 'language', 'startDate', 'endDate', 'targetAudienceCount',
  'settings.anonymous', 'settings.allowPartialResponses', 'settings.randomizeQuestions', 'settings.showProgress',
  'settings.autoSave', 'settings.timeLimitMinutes', 'settings.responseLimit', 'settings.selfDeclaredDemographics',
  'settings.collectParticipantIdentity', 'settings.notificationSendInvitations', 'settings.notificationSendReminders',
  'settings.notificationReminderFrequencyDays', 'settings.invitationCustomMessage', 'settings.invitationCustomSubject',
  'settings.invitationIncludeCredentials', 'settings.invitationSendImmediately', 'settings.invitationBrandingEnabled',
  'settings.oneSessionOnly', 'settings.respondentIntro', 'settings.closingMessage', 'departmentIds',
  ...['added', 'removed', 'type', 'text', 'scaleMin', 'scaleMax', 'scaleLabelMin', 'scaleLabelMax', 'required',
    'commentRequired', 'commentPrompt', 'category', 'options'].map((part) => `questions[2].${part}`),
]

const tEs = createTranslator(es as never)
const tEn = createTranslator(en as never)

function version(overrides: Partial<SurveyVersionDetail>): SurveyVersionDetail {
  return {
    id: 'v', surveyId: 's', versionNumber: 1, title: 'Clima 2026', description: null, type: 'periodic', language: 'es',
    resolvedLocale: 'es', fallbackFields: [], startDate: '2026-10-19T12:00:00Z', endDate: '2026-10-28T05:59:00Z',
    departmentIds: [], targetAudienceCount: null, questions: [],
    settings: { anonymous: true, allowPartialResponses: true, randomizeQuestions: false, showProgress: true, autoSave: true,
      timeLimitMinutes: null, responseLimit: null, selfDeclaredDemographics: false } as SurveyVersionDetail['settings'],
    reason: 'publish', changes: [], createdBy: 'u', createdByName: 'Ana', createdByEmail: 'ana@acme.test',
    createdAt: '2026-10-19T12:00:00Z', isCurrent: false, collectedResponses: false, ...overrides,
  }
}

const q = (order: number, text: string) => ({
  id: `q${order}`, text, type: 'likert', options: null, scaleMin: 1, scaleMax: 5, scaleLabelMin: null, scaleLabelMax: null,
  required: true, commentRequired: false, commentPrompt: null, order, category: 'workload',
})

describe('history labels', () => {
  it.each([['es', tEs], ['en', tEn]] as const)('names every path the diff can emit in %s, never with a raw key or path', (_lang, t) => {
    for (const path of DIFF_PATHS) {
      expect(parsePath(path).kind, path).not.toBe('unknown')
      const label = fieldLabel(t, path)
      expect(label, path).not.toContain('surveys.next')
      expect(label, path).not.toContain('{')
      expect(label, path).not.toBe(path)
      expect(label, path).not.toMatch(/settings\.|questions\[/)
    }
  })

  it('prints an unknown path as "Otro campo", not as the path', () => {
    expect(fieldLabel(tEs, 'settings.somethingNew')).toBe('Otro campo')
    expect(fieldLabel(tEs, 'questions[1].somethingNew')).toBe('Otro campo')
  })

  it('counts questions from 1 by their place in the version, whatever the stored order starts at', () => {
    expect(positionOf([q(0, 'a'), q(1, 'b'), q(2, 'c')], 2)).toBe(3)
    expect(positionOf([q(5, 'a'), q(9, 'b')], 9)).toBe(2)
    expect(fieldLabel(tEs, 'questions[0].text')).toBe('Pregunta 1 · texto')
  })

  it.each([['es', tEs], ['en', tEn]] as const)('reads every audit action and role in %s', (_lang, t) => {
    const base = { id: 'e', surveyId: 's', entityType: 'survey', entityId: null, userId: 'u', userName: 'Ana', userEmail: 'a@acme.test', userRole: 'company_admin', timestamp: '2026-10-19T12:00:00Z', ipAddress: null }
    for (const [action, changes] of [
      ['created', null], ['updated', { fields: ['title'] }], ['updated', { fields: ['title', 'endDate'] }], ['updated', null],
      ['status_changed', { from: 'draft', to: 'active' }], ['status_changed', null], ['duplicated', null],
      ['version_created', { versionNumber: 2 }], ['version_created', null], ['something_else', null],
    ] as const) {
      const line = entryHeadline(t, { ...base, action, changes })
      expect(line).not.toContain('surveys.next')
      expect(line).not.toContain('{')
    }
    for (const role of ['super_admin', 'company_admin', 'leader', 'supervisor', 'employee']) {
      expect(roleName(t, role)).not.toContain('surveys.next')
    }
    expect(roleName(t, 'robot')).toBe('robot')
  })

  it('names the status change in Spanish words', () => {
    const line = entryHeadline(tEs, {
      id: 'e', surveyId: 's', action: 'status_changed', entityType: 'status', entityId: null, changes: { from: 'draft', to: 'active' },
      userId: 'u', userName: 'Ana', userEmail: 'a@acme.test', userRole: 'company_admin', timestamp: '2026-10-19T12:00:00Z', ipAddress: null,
    })
    expect(line).toBe(`Cambió el estado: ${es.surveys.statusDraft} → ${tEs('surveys.statusActive')}`)
  })
})

describe('changeRows', () => {
  const ctx: ValueContext = { t: tEs, locale: 'es', timeZone: 'America/Costa_Rica' }

  it('gives each changed field its value on both sides, dates on the company clock', () => {
    const from = version({ versionNumber: 1, title: 'Clima 2026', endDate: '2026-10-28T05:59:00Z', questions: [q(0, 'Tengo carga razonable')] })
    const to = version({
      versionNumber: 2, title: 'Clima 2026 (ESPH)', endDate: '2026-10-30T05:59:00Z', departmentIds: ['d1', 'd2'],
      questions: [q(0, 'Mi carga de trabajo es razonable'), q(1, 'Confío en mi jefatura')],
      settings: { ...from.settings, anonymous: false },
    })
    const rows = changeRows(ctx, from, to, ['title', 'endDate', 'settings.anonymous', 'departmentIds', 'questions[0].text', 'questions[1].added'])
    expect(rows.map((row) => [row.label, row.before, row.after])).toEqual([
      ['Título', 'Clima 2026', 'Clima 2026 (ESPH)'],
      ['Cierre', formatInstant('2026-10-28T05:59:00Z', 'America/Costa_Rica', 'es'), formatInstant('2026-10-30T05:59:00Z', 'America/Costa_Rica', 'es')],
      ['Anónima', 'Sí', 'No'],
      ['Departamentos', 'Toda la empresa', '2 departamentos'],
      ['Pregunta 1 · texto', 'Tengo carga razonable', 'Mi carga de trabajo es razonable'],
      ['Pregunta 2 agregada', null, 'Confío en mi jefatura'],
    ])
  })

  it('formats an instant in the zone it is given, not the machine’s', () => {
    // 05:59 UTC on the 28th is 23:59 on the 27th in Costa Rica (UTC-6).
    const text = formatInstant('2026-10-28T05:59:00Z', 'America/Costa_Rica', 'es')
    expect(text).toContain('27')
    expect(text).toMatch(/23:59|11:59/)
  })

  it('names a removed question by its place in the version that had it', () => {
    const from = version({ questions: [q(0, 'Uno'), q(1, 'Dos')] })
    const to = version({ versionNumber: 2, questions: [q(0, 'Uno')] })
    expect(changeRows(ctx, from, to, ['questions[1].removed'])).toEqual([
      { path: 'questions[1].removed', label: 'Pregunta 2 eliminada', before: 'Dos', after: null },
    ])
  })
})
