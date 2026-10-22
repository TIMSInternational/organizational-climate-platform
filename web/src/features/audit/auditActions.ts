import type { Messages, TranslateFn } from '../../i18n/translate'

/**
 * The audit trail's `action` is a code derived from the route that wrote it
 * (`AuditPolicy.Decide`: the route's literal segments joined by `.`, then the verb), plus a
 * handful written directly (`gdpr.erasure`, `surveys.status.closed` …). The screen never prints
 * one: each has a label under `audit.actions` in both catalogues.
 *
 * ## The key
 *
 * The catalogues are dot-path trees (`translate.ts`), so a dotted code cannot be a key as it is.
 * Every `.` becomes `__` — not `_`, which codes already contain (`profile.password_change`) and
 * which would make the key impossible to turn back into the code the filter has to send.
 *
 * ## What says "every"
 *
 * `AuditActionLabelsTests.cs` reads the API's live route table through the middleware's own
 * `AuditPolicy.Decide`, adds the directly written codes by their constants, and fails until each
 * has a non-empty label in `en.json` AND `es.json`. A route mapped later is in that test the
 * moment it is mapped.
 *
 * ## An unknown code
 *
 * Still possible — a row older than a renamed route, an API newer than this bundle — and it
 * reads as `audit.unknownAction`, never as the code: `t()` returns the key itself on a miss, so
 * the miss is detected by comparing against the key rather than trusted to come back empty.
 */
export const AUDIT_ACTIONS_NAMESPACE = 'audit.actions'

export function auditActionKey(action: string): string {
  return action.split('.').join('__')
}

export function auditActionFromKey(key: string): string {
  return key.split('__').join('.')
}

export function auditActionLabel(t: TranslateFn, action: string): string {
  const key = `${AUDIT_ACTIONS_NAMESPACE}.${auditActionKey(action)}`
  const label = t(key)
  return label === key || label.trim() === '' ? t('audit.unknownAction') : label
}

/** Every labelled code, as the filter offers them: sorted by the label the reader sees. */
export function knownAuditActions(messages: Messages, t: TranslateFn, locale: string): string[] {
  const audit = messages.audit
  const actions = typeof audit === 'object' && audit !== null ? audit.actions : undefined
  if (typeof actions !== 'object' || actions === null) return []
  return Object.keys(actions)
    .map(auditActionFromKey)
    .sort((a, b) => auditActionLabel(t, a).localeCompare(auditActionLabel(t, b), locale))
}

/** Minutes the zone is ahead of UTC at `instant`, via Intl (no date library is a dependency here). */
function zoneOffsetMinutes(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant))
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0')
  const asUtc = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'))
  return Math.round((asUtc - instant) / 60000)
}

/** A zone the browser accepts, or `UTC` — a stored zone the runtime does not know must not throw. */
export function safeTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return 'UTC'
  try {
    Intl.DateTimeFormat('en-US', { timeZone }).format(0)
    return timeZone
  } catch {
    return 'UTC'
  }
}

/**
 * The instant a calendar day (`yyyy-mm-dd`) starts in `timeZone`, or the instant it ends with
 * `end` — what "from 20 Oct to 21 Oct" means to an administrator in Costa Rica, not in UTC.
 */
export function zonedDayBoundary(day: string, timeZone: string, end: boolean): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!match) return undefined
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const wall = end ? Date.UTC(year, month - 1, date, 23, 59, 59, 999) : Date.UTC(year, month - 1, date)
  const instant = wall - zoneOffsetMinutes(wall, timeZone) * 60000
  return new Date(instant).toISOString()
}

/** "22 oct 2026, 13:05" in the company's zone and the reader's language. */
export function formatAuditInstant(iso: string, locale: string, timeZone: string): string {
  const instant = new Date(iso)
  if (Number.isNaN(instant.getTime())) return iso
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(instant)
}
