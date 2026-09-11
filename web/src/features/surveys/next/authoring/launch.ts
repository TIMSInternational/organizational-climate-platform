import type { SurveyInvitationDetail, SurveyInvitationSummary } from '../../api/surveyDistribution'
import type { Department } from '../../../org-structure/api/departments'

/**
 * Detalle de encuesta and Distribución, redesigned (canvas boards "SurveyDetail" and
 * "Distribution"), as data. Every number either screen prints is derived here from a
 * payload — `GET /surveys/{id}`, `GET /surveys/{id}/distribution`,
 * `GET /surveys/{id}/invitations`, `GET /admin/departments`, `GET /admin/users` — and none is
 * typed. No region of either screen is sample-fed.
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

/** `ReminderSchedule.DefaultMaxReminders` (ReminderSchedule.cs:23) — the job passes no override. */
export const MAX_REMINDERS = 3
/** `ReminderSchedule.MinimumFrequencyDays` (ReminderSchedule.cs:32) — the interval's floor. */
const MIN_FREQUENCY_DAYS = 1
/** `ReminderSchedule.InvitationIsOutstanding` (ReminderSchedule.cs:115-119). */
const OUTSTANDING: ReadonlySet<string> = new Set(['pending', 'sent', 'opened', 'started'])

export type ReminderOutlook =
  /** The earliest reminder the sweep will raise, as an ISO instant. */
  | { kind: 'scheduled'; at: string }
  /** `settings.notificationSendReminders` is off: the sweep skips the survey. */
  | { kind: 'off' }
  /** The sweep reads active surveys only (`InvitationReminderJob.SweepSurveysAsync`). */
  | { kind: 'inactive' }
  /** No invitation has gone out, so there is nothing to remind anybody of. */
  | { kind: 'awaiting' }
  /** Every outstanding invitation is capped, expired, answered, or due after the close. */
  | { kind: 'none' }

/**
 * When the next automatic reminder goes out. Reminders are not sent by hand only:
 * `InvitationReminderWorker` (Workers/Jobs.cs:72-95) sweeps every 15 minutes
 * (`WorkerSchedulingOptions.InvitationReminderInterval`, :59) and raises one for each outstanding
 * invitation that `ReminderSchedule.Evaluate` (ReminderSchedule.cs:40-102) finds due — at
 * `(lastReminderSent ?? sentAt) + max(1, frequencyDays)` days, at most three, never once the
 * invitation expired or the survey closed. This is that rule, read over the invitation list;
 * null while the list is unread.
 */
export function nextReminder(input: {
  invitations: readonly SurveyInvitationDetail[] | null
  status: string
  endDate: string
  sendReminders: boolean
  frequencyDays: number
  now: Date
}): ReminderOutlook | null {
  if (input.invitations === null) return null
  if (!input.sendReminders) return { kind: 'off' }
  if (input.status !== 'active') return { kind: 'inactive' }
  const closes = Date.parse(input.endDate)
  const days = Math.max(MIN_FREQUENCY_DAYS, input.frequencyDays)
  let earliest: number | null = null
  for (const invitation of input.invitations) {
    if (invitation.completedAt !== null || !OUTSTANDING.has(invitation.status) || invitation.sentAt === null) continue
    if (invitation.reminderCount >= MAX_REMINDERS) continue
    const since = Date.parse(invitation.lastReminderSent ?? invitation.sentAt)
    if (Number.isNaN(since)) continue
    const due = since + days * DAY_MS
    const expires = Date.parse(invitation.expiresAt)
    if (due >= closes || (!Number.isNaN(expires) && due >= expires)) continue
    if (earliest === null || due < earliest) earliest = due
  }
  if (earliest !== null) {
    // An overdue reminder leaves on the sweep's next tick, so it is today's, not a past date's.
    return { kind: 'scheduled', at: new Date(Math.max(earliest, input.now.getTime())).toISOString() }
  }
  return input.invitations.some((invitation) => invitation.sentAt !== null) ? { kind: 'none' } : { kind: 'awaiting' }
}

export type LaunchStepId = 'audience' | 'link' | 'invitations' | 'reminders'
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
 * The four steps of the launch checklist and whether each is met.
 *
 * - **audience** — somebody would receive the survey: the resolved audience is not empty. A
 *   directory this viewer cannot read is `unknown` — unless invitations already went out, which
 *   is an audience with people in it however it was chosen.
 * - **link** — the survey has a share link (`publicLink`).
 * - **invitations** — invitations exist and none is still pending.
 * - **reminders** — never blocking: `idle` until one is sent. They are raised automatically on
 *   a schedule (`nextReminder`) and a survey is ready to launch before the first is due.
 */
export function launchChecklist(input: {
  /** The audience resolved from the directory, or null when this viewer cannot read it. */
  audience: number | null
  publicLink: string | null
  summary: SurveyInvitationSummary | null
  reminders: number | null
}): LaunchStep[] {
  const invitationsDone =
    input.summary !== null && input.summary.total > 0 && input.summary.pending === 0
  const audience: LaunchStepState =
    input.audience === null
      ? input.summary !== null && input.summary.total > 0
        ? 'done'
        : 'unknown'
      : input.audience > 0
        ? 'done'
        : 'missing'
  return [
    { id: 'audience', state: audience },
    { id: 'link', state: input.publicLink !== null ? 'done' : 'missing' },
    { id: 'invitations', state: invitationsDone ? 'done' : 'missing' },
    { id: 'reminders', state: input.reminders !== null && input.reminders > 0 ? 'done' : 'idle' },
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
