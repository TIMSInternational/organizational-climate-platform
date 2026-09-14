import { describe, expect, it } from 'vitest'
import type { Department } from '../../api/departments'
import type { Invitation } from '../../api/invitations'
import type { User } from '../../api/users'
import { NO_DEPARTMENT, departmentGroups, inGroup, pendingRows, rosterTally } from './adminUsers'

function person(id: string, over: Partial<User> = {}): User {
  return {
    id,
    email: `${id}@meridiano.test`,
    name: id,
    role: 'employee',
    departmentId: 'ing',
    isActive: true,
    lastLoginAt: '2026-09-10T02:00:00Z',
    createdAt: '2026-09-10T01:00:00Z',
    ...over,
  }
}

function unit(id: string, name: string, isActive = true): Department {
  return { id, companyId: 'c', name, description: null, parentDepartmentId: null, isActive, employeeCount: 0 }
}

const departments = [unit('ven', 'Ventas'), unit('ing', 'Ingeniería'), unit('cal', 'Calidad 18', false), unit('leg', 'Legal')]
const users = [
  person('luis', { role: 'leader', lastLoginAt: null }),
  person('sofia', { role: 'supervisor' }),
  person('daniel', { lastLoginAt: null }),
  person('pablo', { role: 'leader', departmentId: 'ven' }),
  person('ana', { role: 'company_admin', departmentId: null }),
  person('off', { isActive: false, departmentId: 'ven' }),
]

describe('departmentGroups', () => {
  it('draws one entry per department with people, by name, and the people with none last', () => {
    const groups = departmentGroups(users, departments, 'es')
    expect(groups.map((entry) => entry.name ?? entry.id)).toEqual(['Ingeniería', 'Ventas', NO_DEPARTMENT])
    const ing = groups[0]
    expect([ing.people, ing.signedIn]).toEqual([3, 1])
    expect(ing.leaders.map((user) => user.id)).toEqual(['luis'])
    expect(ing.supervisors.map((user) => user.id)).toEqual(['sofia'])
    expect(groups[2].members.map((user) => user.id)).toEqual(['ana'])
  })

  it('keeps the groups, unnamed, when the department list could not be read', () => {
    const groups = departmentGroups(users, null, 'es')
    expect(groups.map((entry) => entry.name)).toEqual([null, null, null])
    expect(groups.map((entry) => entry.people).sort()).toEqual([1, 2, 3])
  })
})

describe('inGroup', () => {
  it('selects everyone, the people with no department, or one department', () => {
    expect(users.filter((user) => inGroup(user, '')).length).toBe(6)
    expect(users.filter((user) => inGroup(user, NO_DEPARTMENT)).map((user) => user.id)).toEqual(['ana'])
    expect(users.filter((user) => inGroup(user, 'ven')).map((user) => user.id)).toEqual(['pablo', 'off'])
  })
})

describe('rosterTally', () => {
  it('counts active, deactivated, never-signed-in leaders and departments from the payload', () => {
    expect(rosterTally(users, departments)).toEqual({
      total: 6,
      active: 5,
      deactivated: 1,
      never: 2,
      leaders: 2,
      leadersNever: 1,
      departmentsWithPeople: 2,
      withoutDepartment: 1,
      inactiveEmpty: 1,
      activeEmpty: 1,
    })
  })

  it('says nothing about departments it could not read — null, never zero', () => {
    const tally = rosterTally(users, null)
    expect([tally.departmentsWithPeople, tally.inactiveEmpty, tally.activeEmpty]).toEqual([null, null, null])
  })
})

describe('pendingRows', () => {
  it('keeps what is still waiting for the person, soonest to expire first', () => {
    const base = {
      companyId: 'c',
      departmentId: null,
      invitationType: 'employee',
      role: 'employee',
      token: 't',
      sentAt: null,
      reminderCount: 0,
    }
    const invitations: Invitation[] = [
      { ...base, id: 'late', email: 'a@x', status: 'sent', expiresAt: '2026-09-20T00:00:00Z', acceptedAt: null },
      { ...base, id: 'done', email: 'b@x', status: 'accepted', expiresAt: '2026-09-12T00:00:00Z', acceptedAt: '2026-09-11T00:00:00Z' },
      { ...base, id: 'soon', email: null, status: 'pending', expiresAt: '2026-09-15T00:00:00Z', acceptedAt: null },
    ]
    expect(pendingRows(invitations).map((row) => row.id)).toEqual(['soon', 'late'])
  })
})
