import type { Invitation } from '../../api/invitations'
import type { User } from '../../api/users'

/**
 * The pure half of the super administrator's roster: its order, its facets, its
 * filter and the counts in its footer. `superUsers.test.ts` pins each.
 */

/** Widest reach first — the canvas's "ordenadas por rol y nombre". Mirrors `Roles.All`. */
export const ROLE_ORDER = ['super_admin', 'company_admin', 'leader', 'supervisor', 'employee'] as const

/** Rows drawn before "Ver el resto": the canvas shows ten. */
export const VISIBLE_ROWS = 10

function rank(role: string): number {
  const index = (ROLE_ORDER as readonly string[]).indexOf(role)
  return index === -1 ? ROLE_ORDER.length : index
}

export function orderPeople(users: readonly User[]): User[] {
  return [...users].sort((a, b) => rank(a.role) - rank(b.role) || a.name.localeCompare(b.name))
}

export function roleCounts(users: readonly User[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  for (const user of users) counts.set(user.role, (counts.get(user.role) ?? 0) + 1)
  return counts
}

/** Role (`''` every role), department (`''` every department) and a name-or-email search. */
export function filterPeople(users: readonly User[], role: string, departmentId: string, search: string): User[] {
  const needle = search.trim().toLocaleLowerCase()
  return users.filter(
    (user) =>
      (role === '' || user.role === role) &&
      (departmentId === '' || user.departmentId === departmentId) &&
      (!needle || user.name.toLocaleLowerCase().includes(needle) || user.email.toLocaleLowerCase().includes(needle)),
  )
}

/** "LM" for Luis Mora; one letter for a one-word name. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toLocaleUpperCase()
}

/** People who have never signed in, and how many of them lead a team. */
export function neverSignedIn(users: readonly User[]): { never: number; leaders: number } {
  const never = users.filter((user) => user.lastLoginAt === null)
  return { never: never.length, leaders: never.filter((user) => user.role === 'leader').length }
}

/**
 * Invitations still waiting for the person: `InvitationValidation` has exactly `pending`,
 * `sent` and `accepted`, and only the last is done.
 */
export function pendingInvitations(invitations: readonly Invitation[]): number {
  return invitations.filter((invitation) => invitation.status !== 'accepted' && invitation.acceptedAt === null).length
}
