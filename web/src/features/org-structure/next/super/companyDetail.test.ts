import { describe, expect, it } from 'vitest'
import type { Department } from '../../api/departments'
import type { User } from '../../api/users'
import {
  departmentSummary,
  draftProblems,
  foldCommonPrefix,
  peopleReading,
  profileChanges,
  reportWave,
  type ProfileDraft,
} from './companyDetail'
import type { SettingsDraft } from '../settings/derive'

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
      username: null,
    })
    expect(peopleReading([user('leader', true), user('leader', false), user('employee', true)])).toEqual({
      total: 3,
      active: 2,
      leaders: 2,
    })
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
  timezone: 'America/Costa_Rica',
  credentialMode: 'shared',
  primaryColor: '#0d9488',
  logoUrl: '',
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

describe('draftProblems', () => {
  it('blocks the save on an empty name, a bad colour or a logo path the API would refuse', () => {
    expect(draftProblems({ ...profile, name: ' ' }, settings)).toBe(true)
    expect(draftProblems(profile, { ...settings, primaryColor: 'red' })).toBe(true)
    expect(draftProblems(profile, { ...settings, logoUrl: 'https://cdn.example.com/logo.png' })).toBe(true)
    expect(draftProblems(profile, { ...settings, logoUrl: '/brand/meridiano.svg' })).toBe(false)
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
