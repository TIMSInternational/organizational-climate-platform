import { describe, expect, it } from 'vitest'
import type { Invitation } from '../../api/invitations'
import type { User } from '../../api/users'
import { filterPeople, initialsOf, neverSignedIn, orderPeople, pendingInvitations, roleCounts } from './superUsers'

function person(name: string, role: string, extra: Partial<User> = {}): User {
  return {
    id: name,
    email: `${name.toLowerCase().replace(/\s+/g, '.')}@meridiano.test`,
    name,
    role,
    departmentId: 'ing',
    isActive: true,
    lastLoginAt: '2026-09-10T02:00:00Z',
    createdAt: '2026-09-10T02:00:00Z',
    ...extra,
  }
}

const people = [
  person('Diego Solano', 'employee'),
  person('Luis Mora', 'leader'),
  person('Adriana Marin', 'employee', { departmentId: 'ops' }),
  person('Ana Rojas', 'company_admin', { departmentId: null }),
  person('Sofia Vargas', 'supervisor'),
  person('Carla Jimenez', 'leader', { departmentId: 'fin', lastLoginAt: null }),
  person('Carlos Mata', 'employee', { lastLoginAt: null }),
]

describe('orderPeople', () => {
  it('orders by reach and then by name, as the canvas reads "ordenadas por rol y nombre"', () => {
    expect(orderPeople(people).map((user) => user.name)).toEqual([
      'Ana Rojas',
      'Carla Jimenez',
      'Luis Mora',
      'Sofia Vargas',
      'Adriana Marin',
      'Carlos Mata',
      'Diego Solano',
    ])
  })
})

describe('roleCounts', () => {
  it('counts each role once per person', () => {
    const counts = roleCounts(people)
    expect([counts.get('company_admin'), counts.get('leader'), counts.get('supervisor'), counts.get('employee')]).toEqual([1, 2, 1, 3])
    expect(counts.get('super_admin')).toBeUndefined()
  })
})

describe('filterPeople', () => {
  const names = (role: string, department: string, search: string) =>
    filterPeople(people, role, department, search).map((user) => user.name)

  it('narrows by role, by department and by name or email', () => {
    expect(names('leader', '', '')).toEqual(['Luis Mora', 'Carla Jimenez'])
    expect(names('', 'ops', '')).toEqual(['Adriana Marin'])
    expect(names('', '', 'MORA')).toEqual(['Luis Mora'])
    expect(names('', '', 'diego.solano@')).toEqual(['Diego Solano'])
    expect(names('employee', 'ing', 'carlos')).toEqual(['Carlos Mata'])
  })
})

describe('initialsOf', () => {
  it('takes the first letters of the first two words', () => {
    expect(initialsOf('Luis Mora')).toBe('LM')
    expect(initialsOf('  sofía   vargas lópez ')).toBe('SV')
    expect(initialsOf('Ana')).toBe('A')
  })
})

describe('neverSignedIn', () => {
  it('counts who never signed in and how many of them lead a team', () => {
    expect(neverSignedIn(people)).toEqual({ never: 2, leaders: 1 })
  })
})

describe('pendingInvitations', () => {
  it('counts every invitation not yet accepted', () => {
    const invitation = (status: string, acceptedAt: string | null): Invitation => ({
      id: status,
      email: null,
      companyId: 'm',
      departmentId: null,
      invitationType: 'employee_direct',
      role: 'employee',
      status,
      token: 't',
      expiresAt: '2026-10-01T00:00:00Z',
      sentAt: null,
      acceptedAt,
      reminderCount: 0,
    })
    expect(pendingInvitations([invitation('pending', null), invitation('sent', null), invitation('accepted', '2026-09-09T00:00:00Z')])).toBe(2)
  })
})
