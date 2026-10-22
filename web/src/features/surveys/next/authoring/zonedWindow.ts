/**
 * A survey's response window, read and written on the COMPANY's clock (audit G16).
 *
 * `StartDate` and `EndDate` are instants: `SurveyLifecycleJob` opens a scheduled survey at
 * `StartDate <= now` and closes an active one at `EndDate <= now`, to the minute. An
 * administrator who types "28 oct, 23:59" means 23:59 where the company is, not where their
 * laptop happens to be -- the builder reads them in the browser's zone (`wizardValues.ts`),
 * which is the same thing only while everybody sits in Costa Rica.
 *
 * So the editor works in wall-clock strings, `2026-10-28T23:59`, the shape a
 * `datetime-local` input and `DateTimeField` take, and these two functions are the only
 * crossing between that string and an instant. Nothing here touches the browser's own zone:
 * every conversion names the zone it is in.
 *
 * Pure `Intl`, no dependency: the conversion is "what does this instant read as in that zone",
 * asked of the platform, and a wall clock is resolved by asking it twice so a DST edge (none in
 * Costa Rica, but the zone is a setting) lands on the reading the zone actually has.
 */

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

/** Whether `timeZone` is an IANA zone this platform knows. */
export function isKnownTimeZone(timeZone: string | null | undefined): timeZone is string {
  if (!timeZone) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

/** The browser's own zone -- the fallback when the company's cannot be read. */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

function readingIn(at: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(at))
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') }
}

/** How far `timeZone` is ahead of UTC at `at`, in milliseconds (Costa Rica: -6 h). */
function offsetAt(at: number, timeZone: string): number {
  const r = readingIn(at, timeZone)
  const wholeSecond = at - (((at % 1000) + 1000) % 1000)
  return Date.UTC(r.year, r.month - 1, r.day, r.hour, r.minute, r.second) - wholeSecond
}

/** `instant` as the wall clock reads it in `timeZone`: `2026-10-28T23:59`. Null when unparseable. */
export function wallClockIn(instant: string | number | Date, timeZone: string): string | null {
  const at = new Date(instant).getTime()
  if (Number.isNaN(at) || !isKnownTimeZone(timeZone)) return null
  const r = readingIn(at, timeZone)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${r.year}-${two(r.month)}-${two(r.day)}T${two(r.hour)}:${two(r.minute)}`
}

/** The instant at which the wall clock in `timeZone` reads `wallClock`. Null when unparseable. */
export function instantOfWallClock(wallClock: string, timeZone: string): Date | null {
  const match = WALL_CLOCK.exec(wallClock)
  if (!match || !isKnownTimeZone(timeZone)) return null
  const [, y, mo, d, h, mi] = match.map(Number)
  const asIfUtc = Date.UTC(y, mo - 1, d, h, mi)
  const first = asIfUtc - offsetAt(asIfUtc, timeZone)
  // Asked again at the candidate: across a DST change the offset at the answer is the one
  // that counts, not the offset at the naive guess.
  const second = asIfUtc - offsetAt(first, timeZone)
  return new Date(second)
}

/**
 * The zone as a reader recognises it: `America/Costa_Rica (GMT-6)`. The offset is the one in
 * force at `at`, in the platform's own short spelling.
 */
export function zoneLabel(timeZone: string, at: number | Date = Date.now()): string {
  try {
    const offset = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
      .formatToParts(new Date(at))
      .find((part) => part.type === 'timeZoneName')?.value
    return offset ? `${timeZone} (${offset})` : timeZone
  } catch {
    return timeZone
  }
}

/** "28 oct 2026 · 23:59" -- the day and the 24-hour time `instant` reads as in `timeZone`. */
export function dayTimeIn(instant: string | number | Date, timeZone: string, locale: string): string {
  const at = new Date(instant)
  if (Number.isNaN(at.getTime()) || !isKnownTimeZone(timeZone)) return '—'
  const tag = locale === 'es' ? 'es-CR' : 'en-US'
  const day = new Intl.DateTimeFormat(tag, { timeZone, day: 'numeric', month: 'short', year: 'numeric' })
    .format(at)
    .replace(/ de /g, ' ')
    .replace('.', '')
    .replace(/\bsept\b/, 'sep')
  const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at)
  return `${day} · ${time}`
}
