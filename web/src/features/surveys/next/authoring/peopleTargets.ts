import type { User } from '../../../org-structure/api/users'

/**
 * The arithmetic behind "Personas específicas" (G14): who can be chosen, who a search finds, and
 * what a pasted list of addresses resolves to.
 *
 * In a `.ts` module for `audience.ts`'s reasons: it is the part worth testing on its own, and
 * oxlint's `only-export-components` keeps helpers out of a `.tsx`.
 *
 * ## The company's active-people rule
 *
 * `POST /surveys` and `PUT /surveys/{id}` accept a `userIds` list only when EVERY id is an active
 * person of the survey's company (`SurveyEndpoints.ValidateUsersAsync`); one stranger and the
 * whole request is a 400. So an inactive account is never offered, and a pasted address that
 * belongs to one is reported beside the addresses nobody holds -- never silently added. The
 * directory passed in is already the survey company's (`GET /admin/users?companyId=`), so no
 * other tenant's people can appear here.
 */

/** One person who may be chosen: an ACTIVE account of the company, with its department named. */
export interface Choosable {
  id: string
  name: string
  email: string
  /** The department's name, or '' for nobody's department. */
  department: string
}

/** Lower case, no accents: "José" is found by "jose", as an admin types it. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

/** The company's active people, in the directory's own order (the API sorts it by name). */
export function choosablePeople(users: readonly User[], departmentNames: ReadonlyMap<string, string>): Choosable[] {
  return users
    .filter((user) => user.isActive)
    .map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      department: user.departmentId === null ? '' : (departmentNames.get(user.departmentId) ?? ''),
    }))
}

/** The people a search finds, by name, email or department; every term must match. */
export function searchPeople(people: readonly Choosable[], query: string): Choosable[] {
  const terms = fold(query).split(/\s+/).filter((term) => term !== '')
  if (terms.length === 0) return [...people]
  return people.filter((person) => {
    const haystack = fold(`${person.name} ${person.email} ${person.department}`)
    return terms.every((term) => haystack.includes(term))
  })
}

const EMAIL = /[^\s<>()[\]{},;:"'|]+@[^\s<>()[\]{},;:"'|]+\.[^\s<>()[\]{},;:"'|]+/g

/**
 * The addresses in a pasted block, lower-cased, each once, in the order they first appear.
 *
 * Whatever an export puts round them -- commas, semicolons, one per line, `Name <address>`, a
 * spreadsheet column with a header -- only what looks like an address is read. The API lower-cases
 * every stored address (`UpdateAsync` trims and lower-cases), so comparing lower-cased is exact.
 */
export function pastedEmails(text: string): string[] {
  const seen = new Set<string>()
  for (const match of text.match(EMAIL) ?? []) {
    const address = match.replace(/\.+$/, '').toLowerCase()
    seen.add(address)
  }
  return [...seen]
}

/** Why a pasted address was not added. */
export type UnmatchedReason = 'inactive' | 'unknown'

export interface PasteMatch {
  /** Every distinct address read from the paste. */
  addresses: number
  /** The ids of the active people the paste names, in paste order. */
  matchedIds: string[]
  /** The addresses that name no active person of the company, with the reason. */
  unmatched: { email: string; reason: UnmatchedReason }[]
}

/** What a pasted list resolves to against the company's directory. */
export function matchPaste(text: string, users: readonly User[]): PasteMatch {
  const byEmail = new Map(users.map((user) => [user.email.trim().toLowerCase(), user]))
  const addresses = pastedEmails(text)
  const matchedIds: string[] = []
  const unmatched: PasteMatch['unmatched'] = []
  for (const email of addresses) {
    const user = byEmail.get(email)
    if (user === undefined) unmatched.push({ email, reason: 'unknown' })
    else if (!user.isActive) unmatched.push({ email, reason: 'inactive' })
    else matchedIds.push(user.id)
  }
  return { addresses: addresses.length, matchedIds, unmatched }
}

/** `chosen` with `ids` added (in order, each once) or removed. */
export function withPeople(chosen: readonly string[], ids: readonly string[], add: boolean): string[] {
  if (!add) {
    const drop = new Set(ids)
    return chosen.filter((id) => !drop.has(id))
  }
  const next = [...chosen]
  const have = new Set(chosen)
  for (const id of ids) {
    if (!have.has(id)) {
      have.add(id)
      next.push(id)
    }
  }
  return next
}
