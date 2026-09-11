import type { SystemJobStatus, SystemStatusResponse } from '../../api/systemStatus'
import type { SystemEmailSettings } from '../../api/systemSettings'

/**
 * The pure readings behind the redesigned Estado del sistema (`/admin/system`), drawn from
 * `GET /admin/system/status` (`SystemStatusDtos.cs`) and, for the mail tile only,
 * `GET /admin/system-settings`. Every number the page prints is counted here from those two
 * payloads, never typed.
 */

/** A chip's tone. Never the only carrier of meaning: every chip also prints its word. */
export type HealthTone = 'good' | 'warning' | 'critical' | 'neutral'

/**
 * Component tokens (`SystemComponentStatuses`) to tones — the same mapping the old page drew
 * (`SystemHealthPage.tsx`): a hang or a refusal is critical, anything a human should look at
 * is a warning, and a token this screen has not learned is neutral rather than green.
 */
export function componentTone(status: string): HealthTone {
  switch (status) {
    case 'ok':
      return 'good'
    case 'slow':
    case 'backlog':
    case 'failing':
    case 'never-run':
      return 'warning'
    case 'timeout':
    case 'unreachable':
    case 'stale':
      return 'critical'
    default:
      return 'neutral'
  }
}

/** The aggregate verdict (`SystemStatuses`): `ok`, `degraded` (HTTP 200), `unhealthy` (HTTP 503). */
export function aggregateTone(status: string): HealthTone {
  if (status === 'ok') return 'good'
  return status === 'degraded' ? 'warning' : 'critical'
}

/**
 * The mail tile's tone, from the stored SMTP switch in Configuración del Sistema. `null` —
 * the settings read failed — is neutral: the page says it could not look, which is not the
 * same answer as "off".
 */
export function mailTone(email: SystemEmailSettings | null): HealthTone {
  if (email === null) return 'neutral'
  return email.smtpEnabled ? 'good' : 'warning'
}

/** Worst first — "not running" outranks "running badly" (`SystemStatusPolicy.ClassifyJob`). */
const JOB_SEVERITY = ['stale', 'timeout', 'unreachable', 'failing', 'never-run', 'unknown'] as const

export interface JobsTally {
  total: number
  /** Jobs whose own heartbeat reads `ok`. */
  ok: number
  /** Consecutive failures summed across every job — zero after each one's last success. */
  failures: number
  /** The most recent attempt by any job, or `null` when none has ever run. */
  lastAttemptAt: string | null
  /** The most severe non-`ok` job token, or `null` when every job is `ok`. */
  worst: string | null
}

export function tallyJobs(jobs: readonly SystemJobStatus[]): JobsTally {
  let lastAttemptAt: string | null = null
  for (const job of jobs) {
    if (job.lastAttemptAt !== null && (lastAttemptAt === null || Date.parse(job.lastAttemptAt) > Date.parse(lastAttemptAt))) {
      lastAttemptAt = job.lastAttemptAt
    }
  }
  const tokens = jobs.map((job) => job.status).filter((status) => status !== 'ok')
  const worst = tokens.length === 0 ? null : ([...JOB_SEVERITY].find((token) => tokens.includes(token)) ?? tokens[0])
  return {
    total: jobs.length,
    ok: jobs.filter((job) => job.status === 'ok').length,
    failures: jobs.reduce((sum, job) => sum + job.consecutiveFailures, 0),
    lastAttemptAt,
    worst,
  }
}

/**
 * Every chip on the page that does not read "Correcto" — the "N avisos" beside the verdict:
 * the database, the queue, the dispatcher, the stored mail switch, and each scheduled job.
 * The API tile is not counted: the payload arriving IS the API answering.
 */
export function warningCount(status: SystemStatusResponse, email: SystemEmailSettings | null): number {
  const components = [status.database.status, status.notificationQueue.status, status.dispatcher.status]
  let count = components.filter((token) => componentTone(token) !== 'good').length
  if (email !== null && !email.smtpEnabled) count += 1
  for (const job of status.jobs ?? []) {
    if (componentTone(job.status) !== 'good') count += 1
  }
  return count
}

/**
 * Whole minutes from `fromIso` to `toIso`, at least one: a job that ran 28 seconds before the
 * check "ran a minute ago", never "0 minutes ago".
 */
export function minutesSince(fromIso: string, toIso: string): number {
  const seconds = Math.max(0, (Date.parse(toIso) - Date.parse(fromIso)) / 1000)
  return Math.max(1, Math.round(seconds / 60))
}

/** `HH:mm` on the 24-hour clock, in `timeZone` (the viewer's, unless a test names one). */
export function clockTime(iso: string, locale: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(
    new Date(iso),
  )
}

/**
 * "9 sept" — the day of an instant in `timeZone` (the viewer's, unless a test names one),
 * the same zone `clockTime` prints the hour in. `calendarDay` reads the day in UTC, which is
 * right for a survey's close date and wrong beside a local clock time: a job that ran at
 * 03:01 UTC on 10 Sep is "9 sept · 22:01" in Costa Rica, never "10 sept · 22:01".
 */
export function localDay(iso: string, locale: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone }).format(new Date(iso))
}

/** The calendar day of an instant, as `YYYY-MM-DD` in `timeZone` — for "same day as the check". */
export function dayKey(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(
    new Date(iso),
  )
}

/**
 * "UTC−6" for a zone at an instant: the offset the job times on this page are printed in.
 * `null` when the runtime cannot name it, and the page then names the zone alone.
 */
export function utcOffsetLabel(timeZone: string, at: Date): string | null {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
    .formatToParts(at)
    .find((piece) => piece.type === 'timeZoneName')?.value
  if (!part) return null
  if (part === 'GMT') return 'UTC'
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(part)
  if (!match) return null
  // Some engines name UTC itself "GMT+0"; a zero offset is just UTC.
  if (Number(match[2]) === 0 && !match[3]) return 'UTC'
  const sign = match[1] === '-' ? '−' : '+'
  return `UTC${sign}${match[2]}${match[3] ? `:${match[3]}` : ''}`
}
