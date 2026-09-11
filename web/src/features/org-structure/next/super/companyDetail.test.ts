import { describe, expect, it } from 'vitest'
import type { SurveyListItem } from '../../../surveys/api/surveys'
import type { Department } from '../../api/departments'
import type { User } from '../../api/users'
import {
  departmentSummary,
  draftProblems,
  foldCommonPrefix,
  parseRetention,
  peopleReading,
  profileChanges,
  reportWave,
  retentionYears,
  settingsChanges,
  wavesByMonth,
  type ProfileDraft,
  type SettingsDraft,
} from './companyDetail'

function department(name: string, isActive: boolean, employeeCount: number): Department {
  return { id: name, companyId: 'm', name, description: null, parentDepartmentId: null, isActive, employeeCount }
}

// Grupo Meridiano S.A.'s departments as `GET /admin/departments` answered on 10 Sep 2026.
const departments = [
  department('Calidad 18', false, 0),
  department('Ventas', true, 7),
  department('Calidad 406', false, 0),
  department('Finanzas', true, 6),
  department('Calidad 547', false, 0),
  department('Ingeniería', true, 14),
  department('Calidad 636', false, 0),
  department('Operaciones', true, 7),
  department('Calidad 79', false, 0),
  department('Personas', true, 7),
  department('Calidad 797', false, 0),
]

describe('departmentSummary', () => {
  it('splits active from inactive, each in the order a reader counts — 79 before 406', () => {
    const summary = departmentSummary(departments)
    expect(summary.active.map((unit) => unit.name)).toEqual(['Finanzas', 'Ingeniería', 'Operaciones', 'Personas', 'Ventas'])
    expect(summary.inactive.map((unit) => unit.name)).toEqual([
      'Calidad 18',
      'Calidad 79',
      'Calidad 406',
      'Calidad 547',
      'Calidad 636',
      'Calidad 797',
    ])
    expect(summary.inactiveHavePeople).toBe(false)
  })

  it('notices an inactive department that still has people', () => {
    expect(departmentSummary([department('Calidad 18', false, 2)]).inactiveHavePeople).toBe(true)
  })
})

describe('peopleReading', () => {
  it('counts everyone, the active ones and the leaders', () => {
    const user = (role: string, isActive: boolean): User => ({
      id: `${role}${isActive}`,
      email: 'x@meridiano.test',
      name: 'X',
      role,
      departmentId: null,
      isActive,
      lastLoginAt: null,
      createdAt: '2026-09-10T00:00:00Z',
    })
    expect(peopleReading([user('leader', true), user('leader', false), user('employee', true)])).toEqual({
      total: 3,
      active: 2,
      leaders: 2,
    })
  })
})

describe('wavesByMonth', () => {
  const survey = (status: string, title: string, endDate: string): SurveyListItem => ({
    id: title,
    title,
    companyId: 'm',
    type: 'periodic',
    status,
    language: 'both',
    startDate: endDate,
    endDate,
    responseCount: 24,
    targetAudienceCount: null,
    questionCount: 6,
    createdAt: endDate,
  })

  it("names Meridiano's four waves by the month they close, skipping the archived copy and drafts", () => {
    const surveys = [
      survey('archived', 'Encuesta de Clima Q4 (abierta) (Copia)', '2026-12-10T02:03:39Z'),
      survey('closed', 'Encuesta de Clima Q3', '2026-08-06T02:05:22Z'),
      survey('active', 'Encuesta de Clima Q4 (abierta)', '2026-10-10T02:03:39Z'),
      survey('closed', 'Encuesta de Clima Q2', '2026-05-13T02:03:12Z'),
      survey('closed', 'Encuesta de Clima Q1', '2026-02-12T03:02:44Z'),
      survey('draft', 'Pulso', '2026-11-01T00:00:00Z'),
    ]
    expect(wavesByMonth(surveys, 'es')).toEqual([
      { code: 'Q1', month: 'febrero' },
      { code: 'Q2', month: 'mayo' },
      { code: 'Q3', month: 'agosto' },
      { code: 'Q4', month: 'octubre' },
    ])
  })
})

describe('retention', () => {
  it('turns days into years, one decimal at most', () => {
    expect(retentionYears(2555, 'es')).toBe('7')
    expect(retentionYears(400, 'en')).toBe('1.1')
  })

  it('accepts whole days only, at least one', () => {
    expect(parseRetention('2555')).toBe(2555)
    expect(parseRetention(' 30 ')).toBe(30)
    expect(parseRetention('0')).toBeNull()
    expect(parseRetention('12.5')).toBeNull()
    expect(parseRetention('siete')).toBeNull()
  })
})

const profile: ProfileDraft = {
  name: 'Grupo Meridiano S.A.',
  emailDomain: 'meridiano.test',
  industry: 'Servicios',
  size: 'medium',
  country: 'Costa Rica',
  subscriptionTier: 'basic',
}

const settings: SettingsDraft = {
  language: 'es',
  surveyFrequency: 'quarterly',
  anonymousSurveys: true,
  dataRetentionDays: '2555',
  microclimateEnabled: true,
  aiInsightsEnabled: true,
  primaryColor: '#0d9488',
}

describe('profileChanges', () => {
  it('sends nothing when nothing changed', () => {
    expect(profileChanges(profile, { ...profile })).toEqual({})
  })

  it('sends only the field that changed, trimmed', () => {
    expect(profileChanges(profile, { ...profile, country: '  Panamá ' })).toEqual({ country: 'Panamá' })
  })

  it('does not send a cleared field, which the server would ignore anyway', () => {
    expect(profileChanges(profile, { ...profile, industry: '' })).toEqual({})
  })
})

describe('settingsChanges', () => {
  it('sends the language the triage asked for, and only it', () => {
    expect(settingsChanges(settings, { ...settings, language: 'en' })).toEqual({ language: 'en' })
  })

  it('sends a valid retention as a number and never an invalid one', () => {
    expect(settingsChanges(settings, { ...settings, dataRetentionDays: '365' })).toEqual({ dataRetentionDays: 365 })
    expect(settingsChanges(settings, { ...settings, dataRetentionDays: 'abc' })).toEqual({})
  })

  it('sends a colour only when it is a whole hex colour', () => {
    expect(settingsChanges(settings, { ...settings, primaryColor: '#dd0c15' })).toEqual({ primaryColor: '#dd0c15' })
    expect(settingsChanges(settings, { ...settings, primaryColor: '#dd0' })).toEqual({})
  })

  it('sends the switches when they flip', () => {
    expect(settingsChanges(settings, { ...settings, aiInsightsEnabled: false, anonymousSurveys: false })).toEqual({
      aiInsightsEnabled: false,
      anonymousSurveys: false,
    })
  })
})

describe('draftProblems', () => {
  it('blocks the save on an empty name, a bad retention or a bad colour', () => {
    expect(draftProblems({ ...profile, name: ' ' }, settings)).toBe(true)
    expect(draftProblems(profile, { ...settings, dataRetentionDays: '0' })).toBe(true)
    expect(draftProblems(profile, { ...settings, primaryColor: 'red' })).toBe(true)
    expect(draftProblems(profile, settings)).toBe(false)
  })

  it('judges only the profile when the settings were never read', () => {
    expect(draftProblems(profile, null)).toBe(false)
  })
})

describe('foldCommonPrefix', () => {
  it('prints a shared first word once, as the canvas folds the inactive departments', () => {
    const names = ['Calidad 18', 'Calidad 79', 'Calidad 406', 'Calidad 547', 'Calidad 636', 'Calidad 797']
    expect(new Intl.ListFormat('es', { type: 'conjunction' }).format(foldCommonPrefix(names))).toBe(
      'Calidad 18, 79, 406, 547, 636 y 797',
    )
  })

  it('leaves names that do not all share it as they came', () => {
    expect(foldCommonPrefix(['Calidad 18', 'Finanzas'])).toEqual(['Calidad 18', 'Finanzas'])
    expect(foldCommonPrefix(['Calidad', 'Calidad 79'])).toEqual(['Calidad', 'Calidad 79'])
    expect(foldCommonPrefix(['Calidad 18'])).toEqual(['Calidad 18'])
  })
})

describe('reportWave', () => {
  it('reads the one quarter every report is of, in either language', () => {
    expect(reportWave([{ title: 'Datos de clima — T3 2026' }, { title: 'Clima organizacional — T3 2026' }])).toBe('Q3')
    expect(reportWave([{ title: 'Climate — Q3' }, { title: 'Pulse Q3' }])).toBe('Q3')
  })

  it('says nothing when the reports span quarters, or carry none', () => {
    expect(reportWave([{ title: 'Clima — T2' }, { title: 'Clima — T3' }])).toBeNull()
    expect(reportWave([{ title: 'Informe anual' }])).toBeNull()
    expect(reportWave([])).toBeNull()
  })
})
