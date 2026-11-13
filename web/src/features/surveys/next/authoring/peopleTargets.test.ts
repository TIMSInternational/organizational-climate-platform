import { describe, expect, it } from 'vitest'
import type { User } from '../../../org-structure/api/users'
import { choosablePeople, matchPaste, pastedEmails, searchPeople, withPeople } from './peopleTargets'

function user(id: string, name: string, email: string, departmentId: string | null, isActive = true): User {
  return { id, name, email, departmentId, isActive, role: 'employee', lastLoginAt: null, createdAt: '', username: null }
}

const directory = [
  user('u1', 'José Mora', 'jose.mora@esph.test', 'd1'),
  user('u2', 'Ana Solís', 'ana.solis@esph.test', 'd2'),
  user('u3', 'Luis Vega', 'luis.vega@esph.test', 'd2', false),
  user('u4', 'Marta Ruiz', 'Marta.Ruiz@esph.test', null),
]
const names = new Map([
  ['d1', 'Teletrabajo'],
  ['d2', 'Finanzas'],
])

describe('the people a builder may choose (G14)', () => {
  it('offers only active accounts, each with its department named', () => {
    const people = choosablePeople(directory, names)
    expect(people.map((p) => p.id)).toEqual(['u1', 'u2', 'u4'])
    expect(people[0].department).toBe('Teletrabajo')
    expect(people[2].department).toBe('')
  })

  it('finds people by name without accents, by email and by department', () => {
    const people = choosablePeople(directory, names)
    expect(searchPeople(people, 'jose').map((p) => p.id)).toEqual(['u1'])
    expect(searchPeople(people, 'ANA.SOLIS@').map((p) => p.id)).toEqual(['u2'])
    expect(searchPeople(people, 'finanzas').map((p) => p.id)).toEqual(['u2'])
    expect(searchPeople(people, 'tele mora').map((p) => p.id)).toEqual(['u1'])
    expect(searchPeople(people, '  ')).toHaveLength(3)
  })
})

describe('a pasted list of addresses', () => {
  it('reads every address once, whatever surrounds it', () => {
    const text = 'Correo\nJosé <jose.mora@esph.test>; ana.solis@esph.test,ANA.SOLIS@esph.test\n\tnadie@esph.test.\nnot an address'
    expect(pastedEmails(text)).toEqual(['jose.mora@esph.test', 'ana.solis@esph.test', 'nadie@esph.test'])
  })

  it('matches active people and lists every address that names nobody active, with the reason', () => {
    const match = matchPaste('jose.mora@esph.test\nluis.vega@esph.test\nnadie@esph.test\nmarta.ruiz@esph.test', directory)
    expect(match.addresses).toBe(4)
    expect(match.matchedIds).toEqual(['u1', 'u4'])
    expect(match.unmatched).toEqual([
      { email: 'luis.vega@esph.test', reason: 'inactive' },
      { email: 'nadie@esph.test', reason: 'unknown' },
    ])
  })
})

describe('changing the selection', () => {
  it('adds in order without repeating, and removes', () => {
    expect(withPeople(['u1'], ['u2', 'u1', 'u4'], true)).toEqual(['u1', 'u2', 'u4'])
    expect(withPeople(['u1', 'u2', 'u4'], ['u2'], false)).toEqual(['u1', 'u4'])
  })
})
