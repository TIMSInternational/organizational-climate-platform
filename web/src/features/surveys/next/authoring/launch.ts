import { type SurveyInvitationDetail, type SurveyInvitationSummary } from '../../api/surveyDistribution'
import type { Department } from '../../../org-structure/api/departments'

/**
 * Detalle de encuesta and Distribución, redesigned (canvas boards "SurveyDetail" and
 * "Distribution"), as data. Every number either screen prints is derived here from a
 * payload — `GET /surveys/{id}`, `GET /surveys/{id}/distribution`,
 * `GET /surveys/{id}/invitations`, `GET /admin/departments`, `GET /admin/users` — and none is
 * typed. No region of either screen is sample-fed.
 */

/**
 * The invitation table's columns, placed where the Distribution artboard's grid puts them
 * (`3fr 4fr 2fr 2fr`, 12px gaps and padding, measured at Correo x≈568, Departamento 872, Estado
 * 1029 inside 325–1187): the same text positions as fractions of a fixed-layout table.
 */
export const INVITATION_COLUMNS = ['26.8%', '35.3%', '18.3%', '19.6%'] as const

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
 * Who in the audience has what this survey hands out — the invitations step's buckets and the
 * checklist's verdict, from one rule.
 *
 * What an invitation IS depends on the survey's credential mode, and neither is "an email that
 * went out": the survey invitation email was deleted on 2026-10-19 (#606), nothing sets
 * `sentAt` any more, and the old "Enviadas 0 / Pendientes = everyone" read that absence as a
 * backlog that would never clear.
 *
 * - **per_survey** — the person holds a key for THIS survey (`summary.withCode`). A key exists
 *   only once its mail went: one whose send failed is withdrawn on the server.
 * - **shared** — the person has an invitation row: a record that they are in the audience.
 *   Nothing is mailed; they sign in with the account they already have.
 *
 * `uncovered` is counted against the audience when it is known (the directory's resolution),
 * because people with no invitation row at all hold nothing either; otherwise against the live
 * invitations, which is all an out-of-scope viewer can see. Revoked invitations are neither.
 */
export function invitationCoverage(input: {
  summary: SurveyInvitationSummary
  /** The audience resolved from the directory, or null when this viewer cannot read it. */
  audience: number | null
  perSurvey: boolean
}): { covered: number; uncovered: number; revoked: number } {
  const { summary } = input
  const live = summary.total - summary.revoked
  const covered = input.perSurvey ? (summary.withCode ?? 0) : live
  const whole = input.audience ?? live
  return { covered, uncovered: Math.max(0, whole - covered), revoked: summary.revoked }
}

/**
 * The statuses an invitation can be created in: `SurveyStatuses.RespondentVisible`. A draft
 * may still have its link and settings edited (`canDistribute`), but the server answers an
 * invitation to it with a 409, so nothing on the page offers one.
 */
export const SENDABLE_STATUSES: readonly string[] = ['scheduled', 'active']

export function canSend(status: string): boolean {
  return SENDABLE_STATUSES.includes(status)
}

/** Where the one audience figure both screens print comes from. */
export type AudienceSource = 'invited' | 'directory' | 'stated'

/**
 * THE audience of a survey, one number for Detalle and Distribución alike: the people invited
 * once invitations exist; before that, the people the server would resolve from the directory
 * (`estimateAudience('allTargeted', …)` mirrors `ResolveAudienceAsync`); the stated
 * `targetAudienceCount` only for a viewer who cannot read the directory. The same figure is every
 * response rate's denominator on both screens. Measured on Meridiano's Q4 survey: 41 resolved,
 * 24 stated — the detail page printed 24 and Distribución 41 for one survey (refuter, 11 Sep).
 * Null when nothing is known, never 0.
 */
export function surveyAudience(input: {
  invited: number | null
  resolved: number | null
  stated: number | null
}): { count: number; source: AudienceSource } | null {
  if (input.invited !== null && input.invited > 0) return { count: input.invited, source: 'invited' }
  if (input.resolved !== null) return { count: input.resolved, source: 'directory' }
  if (input.stated !== null && input.stated > 0) return { count: input.stated, source: 'stated' }
  return null
}

export type LaunchStepId = 'audience' | 'link' | 'invitations'
/**
 * `unknown` is its own state, never `missing`: a viewer who cannot read the directory (a
 * super_admin working in another company's context, whom `CanAdminister` still lets read this
 * page) does not know the audience, and "no people" would be a claim about it.
 */
export type LaunchStepState = 'done' | 'missing' | 'idle' | 'unknown'

export interface LaunchStep {
  id: LaunchStepId
  state: LaunchStepState
}

/**
 * The three steps of the launch checklist and whether each is met.
 *
 * ## A survey needs ONE open door, not every door
 *
 * The share link and the invitations are two ways into the same survey, and this list used
 * to demand both: `invitations` was `missing` whenever none had been sent, so a survey
 * distributed by its link alone said "Falta que las invitaciones salgan" **forever**. For a
 * client whose respondents have no email — the case the public link and its QR exist for —
 * that is not a nudge, it is a permanent and false "not ready".
 *
 * So a door that works makes the other doors non-blocking. `doorOpen` is `invitationsDone`,
 * not merely "invitations exist": a `per_survey` audience half of whom still hold no key is not
 * yet a way in for the other half.
 *
 * - **audience** — somebody would receive the survey: the resolved audience is not empty. A
 *   directory this viewer cannot read is `unknown` — unless invitations already exist, which
 *   is an audience with people in it however it was chosen. Empty is only `missing` when no
 *   door is open: with a working link, a survey needs no roster at all.
 * - **link** — the survey has a share link (`publicLink`), or `idle` when invitations are the
 *   door being used.
 * - **invitations** — everyone in the audience holds what this survey hands out
 *   (`invitationCoverage`: a key on a `per_survey` survey, an invitation on a `shared` one), or
 *   `idle` when the link is the door being used. It used to require every invitation to have
 *   left `pending`, which nothing has done since the invitation email was deleted — so it could
 *   never complete.
 *
 * There is no reminders step. The reminder sweep was deleted with the invitation email, and the
 * manual route answers zeros by design, so a step about reminders could only ever describe
 * something that does not happen.
 *
 * With neither door open both are `missing`, which is the one state that genuinely blocks:
 * the survey has no way to be answered.
 */
export function launchChecklist(input: {
  /** The audience resolved from the directory, or null when this viewer cannot read it. */
  audience: number | null
  publicLink: string | null
  summary: SurveyInvitationSummary | null
  perSurvey: boolean
}): LaunchStep[] {
  const coverage =
    input.summary === null ? null : invitationCoverage({ summary: input.summary, audience: input.audience, perSurvey: input.perSurvey })
  const invitationsDone = coverage !== null && coverage.covered > 0 && coverage.uncovered === 0
  /** A way in that actually works today. */
  const doorOpen = input.publicLink !== null || invitationsDone
  const audience: LaunchStepState =
    input.audience === null
      ? input.summary !== null && input.summary.total > 0
        ? 'done'
        : 'unknown'
      : input.audience > 0
        ? 'done'
        : doorOpen
          ? 'idle'
          : 'missing'
  return [
    { id: 'audience', state: audience },
    { id: 'link', state: input.publicLink !== null ? 'done' : doorOpen ? 'idle' : 'missing' },
    { id: 'invitations', state: invitationsDone ? 'done' : doorOpen ? 'idle' : 'missing' },
  ]
}

/** Steps that no longer block the launch — met, or never blocking. An unknown step is neither. */
export function readySteps(steps: readonly LaunchStep[]): number {
  return steps.filter((step) => step.state === 'done' || step.state === 'idle').length
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
