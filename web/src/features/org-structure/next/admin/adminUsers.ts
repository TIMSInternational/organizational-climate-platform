import type { Department } from '../../api/departments'
import type { Invitation } from '../../api/invitations'
import type { User } from '../../api/users'

/**
 * The company administrator's *Usuarios* (`UsersList` artboard, 10 Sep), as arithmetic over
 * the three reads the page makes. Nothing here is typed from the board: every count the
 * screen prints is one of these functions of the payload.
 */

/** The rail's "every person" entry. */
export const ALL_PEOPLE = ''
/** The rail's entry for the people whose `departmentId` is null. */
export const NO_DEPARTMENT = 'none'

export const hasSignedIn = (user: Pick<User, 'lastLoginAt'>): boolean => user.lastLoginAt !== null

/** The two roles that only a super administrator may deactivate (`UserEndpoints.cs:147-149`). */
export const isAdminRole = (role: string): boolean => role === 'company_admin' || role === 'super_admin'

export interface DepartmentGroup {
  /** The department's id, or `NO_DEPARTMENT`. */
  id: string
  /** `null` for the no-department group, and for a department the directory could not name. */
  name: string | null
  people: number
  signedIn: number
  leaders: readonly User[]
  supervisors: readonly User[]
  /** Everyone in the group, in roster order — the no-department entry names them. */
  members: readonly User[]
}

function group(id: string, name: string | null, members: readonly User[]): DepartmentGroup {
  return {
    id,
    name,
    people: members.length,
    signedIn: members.filter(hasSignedIn).length,
    leaders: members.filter((user) => user.role === 'leader'),
    supervisors: members.filter((user) => user.role === 'supervisor'),
    members,
  }
}

/**
 * The rail: one entry per department that has people, by name, then the people with no
 * department. An empty department has no entry — the rail filters a list, and an entry
 * that selects nobody filters nothing. `departments` is `null` when its read failed; the
 * groups are then still drawn, unnamed, because the roster carries the ids.
 */
export function departmentGroups(users: readonly User[], departments: readonly Department[] | null, locale: string): DepartmentGroup[] {
  const names = new Map((departments ?? []).map((unit) => [unit.id, unit.name]))
  const byId = new Map<string, User[]>()
  const none: User[] = []
  for (const user of users) {
    if (user.departmentId === null) none.push(user)
    else byId.set(user.departmentId, [...(byId.get(user.departmentId) ?? []), user])
  }
  const named = [...byId.entries()]
    .map(([id, members]) => group(id, names.get(id) ?? null, members))
    .sort((a, b) => (a.name ?? '￿').localeCompare(b.name ?? '￿', locale))
  return none.length > 0 ? [...named, group(NO_DEPARTMENT, null, none)] : named
}

export function inGroup(user: Pick<User, 'departmentId'>, groupId: string): boolean {
  if (groupId === ALL_PEOPLE) return true
  if (groupId === NO_DEPARTMENT) return user.departmentId === null
  return user.departmentId === groupId
}

export function matchesSearch(user: Pick<User, 'name' | 'email'>, search: string): boolean {
  const needle = search.trim().toLocaleLowerCase()
  return !needle || user.name.toLocaleLowerCase().includes(needle) || user.email.toLocaleLowerCase().includes(needle)
}

export interface RosterTally {
  total: number
  active: number
  deactivated: number
  never: number
  leaders: number
  leadersNever: number
  /** `null` when the department list could not be read. */
  departmentsWithPeople: number | null
  withoutDepartment: number
  /** Inactive departments nobody belongs to; `null` when the list could not be read. */
  inactiveEmpty: number | null
  /** Active departments nobody belongs to; `null` when the list could not be read. */
  activeEmpty: number | null
}

export function rosterTally(users: readonly User[], departments: readonly Department[] | null): RosterTally {
  const occupied = new Set(users.map((user) => user.departmentId).filter((id): id is string => id !== null))
  const leaders = users.filter((user) => user.role === 'leader')
  return {
    total: users.length,
    active: users.filter((user) => user.isActive).length,
    deactivated: users.filter((user) => !user.isActive).length,
    never: users.filter((user) => !hasSignedIn(user)).length,
    leaders: leaders.length,
    leadersNever: leaders.filter((user) => !hasSignedIn(user)).length,
    departmentsWithPeople: departments === null ? null : departments.filter((unit) => occupied.has(unit.id)).length,
    withoutDepartment: users.filter((user) => user.departmentId === null).length,
    inactiveEmpty: departments === null ? null : departments.filter((unit) => !unit.isActive && !occupied.has(unit.id)).length,
    activeEmpty: departments === null ? null : departments.filter((unit) => unit.isActive && !occupied.has(unit.id)).length,
  }
}

/**
 * Invitations still waiting for the person: `InvitationValidation` has exactly `pending`,
 * `sent` and `accepted`, and only the last is done — the same rule as the super
 * administrator's roster (`superUsers.pendingInvitations`), here as the rows themselves.
 */
export function pendingRows(invitations: readonly Invitation[]): Invitation[] {
  return invitations
    .filter((invitation) => invitation.status !== 'accepted' && invitation.acceptedAt === null)
    .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))
}
