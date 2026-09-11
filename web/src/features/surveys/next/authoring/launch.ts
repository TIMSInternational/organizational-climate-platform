import type { SurveyInvitationDetail, SurveyInvitationSummary } from '../../api/surveyDistribution'
import type { Department } from '../../../org-structure/api/departments'

/**
 * Detalle de encuesta and Distribución, redesigned (canvas boards "SurveyDetail" and
 * "Distribution"), as data. Every number either screen prints is derived here from a
 * payload — `GET /surveys/{id}`, `GET /surveys/{id}/distribution`,
 * `GET /surveys/{id}/invitations`, `GET /admin/departments` — and none is typed. No region
 * of either screen is sample-fed.
 */

/** Share of the stated audience that answered, whole percent — or null when no audience was stated. */
export function responseRate(responses: number, target: number | null): number | null {
  if (target === null || target <= 0) return null
  return Math.round((responses / target) * 100)
}

const DAY_MS = 86_400_000

/** Whole calendar days from `now` to `iso`: positive ahead, negative behind, 0 today. */
export function daysFrom(iso: string, now: Date): number | null {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return null
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = new Date(at)
  const target = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
  return Math.round((target - start) / DAY_MS)
}

/**
 * The names of the departments a survey targets, in the directory's order. An id the directory
 * cannot name is left out rather than printed as a guid; `named` says whether every id was named,
 * so a caller never prints "5 departamentos" above a list of three.
 */
export function targetedDepartments(
  ids: readonly string[],
  directory: readonly Department[] | null,
): { names: string[]; named: boolean } {
  if (directory === null) return { names: [], named: ids.length === 0 }
  const wanted = new Set(ids)
  const names = directory.filter((department) => wanted.has(department.id)).map((d) => d.name)
  return { names, named: names.length === ids.length }
}

/**
 * Reminders sent so far, summed over the invitations — or null while the list is unknown. Null is
 * not zero: "Ningún recordatorio" is a statement about a list we read, never about one we did not.
 */
export function remindersSent(invitations: readonly SurveyInvitationDetail[] | null): number | null {
  if (invitations === null) return null
  return invitations.reduce((total, invitation) => total + invitation.reminderCount, 0)
}

/**
 * The invitation buckets the checklist prints. `left` is every invitation that went out and was
 * not withdrawn — sent or further along the ladder. There is no "rejected" bucket because the
 * API has none (`SurveyInvitationStatuses`: pending, sent, opened, started, completed, revoked).
 */
export function invitationBuckets(summary: SurveyInvitationSummary): {
  left: number
  pending: number
  revoked: number
} {
  return {
    left: summary.sent + summary.opened + summary.started + summary.completed,
    pending: summary.pending,
    revoked: summary.revoked,
  }
}

export type LaunchStepId = 'audience' | 'link' | 'invitations' | 'reminders'
export type LaunchStepState = 'done' | 'missing' | 'idle'

export interface LaunchStep {
  id: LaunchStepId
  state: LaunchStepState
}

/**
 * The four steps of the launch checklist and whether each is met.
 *
 * - **audience** — somebody would receive the survey: the resolved audience is not empty.
 * - **link** — the survey has a share link (`publicLink`).
 * - **invitations** — invitations exist and none is still pending.
 * - **reminders** — never blocking: `idle` until one is sent, because the API sends reminders
 *   only when asked (`SendRemindersAsync`), and a survey is ready to launch without one.
 */
export function launchChecklist(input: {
  audience: number | null
  publicLink: string | null
  summary: SurveyInvitationSummary | null
  reminders: number | null
}): LaunchStep[] {
  const invitationsDone =
    input.summary !== null && input.summary.total > 0 && input.summary.pending === 0
  return [
    { id: 'audience', state: input.audience !== null && input.audience > 0 ? 'done' : 'missing' },
    { id: 'link', state: input.publicLink !== null ? 'done' : 'missing' },
    { id: 'invitations', state: invitationsDone ? 'done' : 'missing' },
    { id: 'reminders', state: input.reminders !== null && input.reminders > 0 ? 'done' : 'idle' },
  ]
}

/** Steps that no longer block the launch — met, or never blocking. */
export function readySteps(steps: readonly LaunchStep[]): number {
  return steps.filter((step) => step.state !== 'missing').length
}

/**
 * The questions as the respondent meets them: in order, a new section wherever the dimension
 * changes. `index`/`count` number the sections, as the respond page's dimension header does.
 */
export function dimensionSections<Q extends { category: string | null }>(
  questions: readonly Q[],
): { category: string | null; index: number; count: number; questions: { question: Q; position: number }[] }[] {
  const sections: { category: string | null; questions: { question: Q; position: number }[] }[] = []
  questions.forEach((question, i) => {
    const category = question.category?.trim() || null
    const last = sections[sections.length - 1]
    if (last && last.category === category) last.questions.push({ question, position: i + 1 })
    else sections.push({ category, questions: [{ question, position: i + 1 }] })
  })
  return sections.map((section, index) => ({ ...section, index: index + 1, count: sections.length }))
}

/**
 * The share link as a full address. The API stores a path (`/s/{token}`); the respondent opens it
 * on this app's own origin, which is what `ShareLinkPanel` copies too.
 */
export function absoluteLink(link: string, origin: string): string {
  return /^https?:\/\//.test(link) ? link : `${origin.replace(/\/$/, '')}${link.startsWith('/') ? '' : '/'}${link}`
}

/**
 * What the screen prints in place of the credential: the origin and the route, never a character
 * of the token — `ShareLinkPanel`'s rule (a stable placeholder, not a partial mask).
 */
export function maskedLink(link: string, origin: string): string {
  const full = absoluteLink(link, origin)
  const cut = full.lastIndexOf('/')
  return `${full.slice(0, cut + 1)}••••••••••••`
}

/* The dates the tiles and the fact sheet print, in the canvas's short form. */

function localeTag(locale: string): string {
  return locale === 'es' ? 'es-CR' : 'en-US'
}

/**
 * "Encuesta periódica" — the fact sheet's sentence case over the vocabulary's title case
 * ("Encuesta Periódica"), as the SurveyDetail artboard prints the type.
 */
export function sentenceCase(text: string, locale: string): string {
  const tag = localeTag(locale)
  return text.charAt(0).toLocaleUpperCase(tag) + text.slice(1).toLocaleLowerCase(tag)
}

/** "10 oct" — the tiles' reading. */
export function dayMonth(iso: string, locale: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return '—'
  return shortMonth(new Intl.DateTimeFormat(localeTag(locale), { day: 'numeric', month: 'short' }).format(at))
}

/** The canvas prints "sep", not ICU's "sept.": three letters, no period, as every artboard does. */
function shortMonth(text: string): string {
  return text.replace('.', '').replace(/\bsept\b/, 'sep')
}

/** "10 sep 2026" — the fact sheet's reading. */
export function fullDay(iso: string, locale: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return '—'
  return shortMonth(
    new Intl.DateTimeFormat(localeTag(locale), { day: 'numeric', month: 'short', year: 'numeric' }).format(at).replace(/ de /g, ' '),
  )
}

export function yearOf(iso: string): string {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? '' : String(at.getFullYear())
}
