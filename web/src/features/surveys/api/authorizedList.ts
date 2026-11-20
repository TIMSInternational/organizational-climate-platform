import { useSyncExternalStore } from 'react'
import { ApiError, authFetch } from '../../../api/authFetch'
import type { TranslateFn } from '../../../i18n'

/**
 * «Lista autorizada del cliente» (ruled 2026-11-19, `docs/decisions/editable-respondent-content.md`,
 * ruling 3): the addresses a client named for one survey. While a survey has a non-empty list,
 * the API refuses every send, resend, reissue or reminder to anybody not on it — 409
 * `survey_recipient_not_authorized`, naming them in `notAuthorized` — and nothing is minted or
 * mailed. No list is today's behaviour.
 *
 * Routes (`SurveyAuthorizedPeopleEndpoints.cs`): `GET/POST /surveys/{id}/authorized-people`,
 * `POST …/bulk` (`{ entries, replace }`), `DELETE …/{personId}`.
 */

export type AuthorizedPerson = {
  id: string
  /** Stored trimmed and lower-cased; that is also how the guard matches it. */
  email: string
  displayName: string | null
  addedAt: string
  addedBy: string | null
  addedByName: string | null
}

export type AuthorizedListView = {
  surveyId: string
  count: number
  /** Whether THIS viewer may change the list now. */
  editable: boolean
  /** The refusal code a write would get when not editable. */
  lockReason: string | null
  people: AuthorizedPerson[]
}

export type AuthorizedEntry = { email: string; displayName?: string | null }

export type BulkAuthorizedResult = {
  added: string[]
  alreadyOnList: string[]
  duplicatesInPaste: string[]
  removed: string[]
  list: AuthorizedListView
}

/** Somebody a refused send would have reached, as the 409 names them. */
export type NotAuthorizedPerson = { userId: string; email: string; name: string | null }

/** A refusal from the list's own routes, keeping what the body names beside the code. */
export class AuthorizedListRefusal extends ApiError {
  /** The pasted entries that are not addresses (`survey_authorized_list_invalid`). */
  readonly invalid: string[]

  constructor(status: number, message: string, code: string | undefined, invalid: string[]) {
    super(status, message, code)
    this.name = 'AuthorizedListRefusal'
    this.invalid = invalid
  }
}

function path(surveyId: string): string {
  return `/surveys/${encodeURIComponent(surveyId)}/authorized-people`
}

async function readRefusal(response: Response): Promise<AuthorizedListRefusal> {
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
  const invalid = Array.isArray(body?.invalid) ? body.invalid.filter((v): v is string => typeof v === 'string') : []
  return new AuthorizedListRefusal(
    response.status,
    typeof body?.message === 'string' ? body.message : `Request failed: ${response.status}`,
    typeof body?.code === 'string' ? body.code : undefined,
    invalid,
  )
}

export async function getAuthorizedList(baseUrl: string, surveyId: string): Promise<AuthorizedListView> {
  const response = await authFetch(`${baseUrl}${path(surveyId)}`)
  return (await response.json()) as AuthorizedListView
}

export async function addAuthorizedPerson(baseUrl: string, surveyId: string, entry: AuthorizedEntry): Promise<AuthorizedPerson> {
  const response = await authFetch(
    `${baseUrl}${path(surveyId)}`,
    { method: 'POST', body: JSON.stringify({ email: entry.email, displayName: entry.displayName ?? null }) },
    { allowStatus: [400, 409] },
  )
  if (!response.ok) throw await readRefusal(response)
  return (await response.json()) as AuthorizedPerson
}

export async function pasteAuthorizedList(
  baseUrl: string,
  surveyId: string,
  entries: AuthorizedEntry[],
  replace: boolean,
): Promise<BulkAuthorizedResult> {
  const response = await authFetch(
    `${baseUrl}${path(surveyId)}/bulk`,
    { method: 'POST', body: JSON.stringify({ entries, replace }) },
    { allowStatus: [400, 409] },
  )
  if (!response.ok) throw await readRefusal(response)
  return (await response.json()) as BulkAuthorizedResult
}

export async function removeAuthorizedPerson(baseUrl: string, surveyId: string, personId: string): Promise<void> {
  await authFetch(`${baseUrl}${path(surveyId)}/${encodeURIComponent(personId)}`, { method: 'DELETE' })
}

// ------------------------------------------------------------------ reading a paste

const EMAIL_TOKEN = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/

/** The stored form of an address, as `SurveyAuthorizedPerson.NormaliseEmail` writes it. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * A pasted column — or a CSV / TSV, or rows copied straight out of Excel — read as entries: on
 * each line, the first cell that looks like an address is the email and the other non-empty
 * cells, joined, are the name. A line with no address is returned in `unreadable` (a header row
 * is the usual one) rather than dropped in silence; blank lines are skipped. Nothing here decides
 * validity for the server, which checks every entry again.
 */
export function parseAuthorizedPaste(text: string): { entries: AuthorizedEntry[]; unreadable: string[] } {
  const entries: AuthorizedEntry[] = []
  const unreadable: string[] = []
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim()
    if (line === '') continue
    const cells = line
      .split(/[\t;,]/)
      .map((cell) => cell.trim().replace(/^"(.*)"$/, '$1').trim())
      .filter((cell) => cell !== '')
    const at = cells.findIndex((cell) => EMAIL_TOKEN.test(cell.replace(/^mailto:/i, '').replace(/^<(.*)>$/, '$1')))
    if (at < 0) {
      unreadable.push(line)
      continue
    }
    const email = cells[at].replace(/^mailto:/i, '').replace(/^<(.*)>$/, '$1')
    const name = cells.filter((_, i) => i !== at).join(' ').trim()
    entries.push(name === '' ? { email } : { email, displayName: name })
  }
  return { entries, unreadable }
}

// ------------------------------------------------------------------ the refusal every send can meet

/** The people a 409 `survey_recipient_not_authorized` names, or null for any other error. */
export function notAuthorizedOf(error: unknown): NotAuthorizedPerson[] | null {
  if (!(error instanceof ApiError) || error.code !== 'survey_recipient_not_authorized') return null
  const raw = error.body
  const list = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>).notAuthorized : undefined
  if (!Array.isArray(list)) return []
  return list.flatMap((item): NotAuthorizedPerson[] => {
    if (item === null || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    if (typeof record.email !== 'string') return []
    return [{
      userId: typeof record.userId === 'string' ? record.userId : '',
      email: record.email,
      name: typeof record.name === 'string' ? record.name : null,
    }]
  })
}

/** «Ana Pérez (ana@…), Bea Solís (bea@…)» — at most `limit`, then «y n más» is the caller's. */
export function namePeople(people: NotAuthorizedPerson[], limit = 10): { text: string; more: number } {
  const shown = people.slice(0, limit).map((p) => (p.name ? `${p.name} (${p.email})` : p.email))
  return { text: shown.join(', '), more: Math.max(0, people.length - limit) }
}

/**
 * The sentence a bulk send shows for `survey_recipient_not_authorized`, naming the people, or
 * null for any other error. Without names in the body (an older API) it is the code's own sentence.
 */
export function describeNotAuthorized(error: unknown, t: TranslateFn): string | null {
  const people = notAuthorizedOf(error)
  if (people === null) return null
  if (people.length === 0) return t('errors.api.codes.survey_recipient_not_authorized')
  const { text, more } = namePeople(people)
  const names = more > 0 ? t('surveys.next.distribution.send.notAuthorizedMore', { names: text, more }) : text
  return t('surveys.next.distribution.send.notAuthorized', { names })
}

// ------------------------------------------------------------------ the page's one copy of the list

/**
 * The list the Distribución page has open, shared between the panel that edits it and the roster
 * that marks who is not on it — one read, and a change in the panel moves the roster's marks at
 * once. Per page, not per app: it holds the survey it was loaded for, and a reader of another
 * survey sees nothing.
 */
type Snapshot = { surveyId: string; emails: ReadonlySet<string> } | null

let snapshot: Snapshot = null
const listeners = new Set<() => void>()

export function publishAuthorizedList(surveyId: string, view: AuthorizedListView | null): void {
  snapshot = view === null ? null : { surveyId, emails: new Set(view.people.map((p) => normaliseEmail(p.email))) }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Whether `email` is outside the client's list on the survey the page has open: `false` when
 * there is no list (no list, nobody is outside it) or it has not been read.
 */
/**
 * The same question as `useOutsideAuthorizedList`, for a whole roster at once: a predicate that
 * says whether an address is outside the list. Always false while there is no list.
 */
export function useOutsideAuthorizedListTest(): (email: string) => boolean {
  const current = useSyncExternalStore(subscribe, () => snapshot, () => null)
  if (current === null || current.emails.size === 0) return () => false
  return (email) => !current.emails.has(normaliseEmail(email))
}

export function useOutsideAuthorizedList(email: string): boolean {
  const current = useSyncExternalStore(subscribe, () => snapshot, () => null)
  if (current === null || current.emails.size === 0) return false
  return !current.emails.has(normaliseEmail(email))
}
