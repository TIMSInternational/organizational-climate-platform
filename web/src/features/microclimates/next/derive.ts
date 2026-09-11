import { ANONYMITY_FLOOR, isSuppressed } from '../../../components/charts'
import type { Microclimate, WordCloudEntry } from '../api/microclimates'
import type { MicroclimateAnonymityGuarantee } from '../api/microclimateLinks'
import { participationPercent, suppressWordCloud } from '../microclimatePrivacy'

/**
 * The pure readings behind the four redesigned microclimate screens — Crear, Detalle,
 * Analítica and Resultados — so each rule is asserted directly (`derive.test.ts`) and no
 * screen computes one differently from another.
 *
 * ## What a microclimate can and cannot say, measured
 *
 * `MicroclimateEndpoints.SubmitResponseAsync` folds every submission into the parent row's
 * `ResponseCount`, `SentimentScore` and `WordCloudData` and discards the answers — there is
 * no per-response or per-question row, by design (the file's own comment on the dropped
 * `GET /{id}/responses`: "That is the anonymity guarantee, not an oversight"). So a session
 * can print its count, its target and its words; it can never print a per-question
 * distribution or a 1–5 average. The screens say so rather than drawing a number no
 * endpoint returns.
 */

/** The anonymity floor the microclimate screens apply: `ANONYMITY_FLOOR`, 5. */
export const FLOOR = ANONYMITY_FLOOR

/** Below the floor: no figure and no word of this session may be shown. A count may. */
export function belowFloor(responses: number): boolean {
  return isSuppressed(responses, FLOOR)
}

/** How many of the expected people have not answered yet — never negative. */
export function outstanding(responses: number, target: number): number {
  return Math.max(0, target - responses)
}

/** Where `count` sits on a 0..`target` bar, 0–100 and clamped; `null` when nothing is expected. */
export function barPosition(count: number, target: number): number | null {
  const share = participationPercent(count, target)
  return share === null ? null : Math.max(0, Math.min(100, share))
}

const TICK_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000] as const

/**
 * The labels under a 0..`max` count axis: a 1/2/5 step giving at most five intervals, and
 * `max` itself at the end — "0 5 10 15 20" for the boards' 20 expected. When `max` is not a
 * multiple of the step, the last step is replaced by `max` if it would sit closer than a
 * tenth of the axis, so two labels never collide.
 */
export function countTicks(max: number): number[] {
  if (!(max > 0)) return [0]
  const step = TICK_STEPS.find((candidate) => max / candidate <= 5) ?? Math.ceil(max / 5)
  const ticks: number[] = []
  for (let value = 0; value <= max; value += step) ticks.push(value)
  const last = ticks[ticks.length - 1] as number
  if (last !== max) {
    if ((max - last) / max < 0.1) ticks[ticks.length - 1] = max
    else ticks.push(max)
  }
  return ticks
}

/** The four steps of "crear, compartir, ver en vivo, leer" — the triage's one flow. */
export const JOURNEY = ['create', 'share', 'live', 'read'] as const
export type JourneyKey = (typeof JOURNEY)[number]
export type JourneyState = 'done' | 'current' | 'pending'

/**
 * Where a session stands on the flow, from its status alone. `draft`: still being created.
 * `active`: created and being shared (the live view and the reading are ahead). `closed`:
 * everything before the reading is behind it. An unknown status claims nothing — every step
 * pending — rather than guessing how far a session the server called something else got.
 */
export function journeyStates(status: string): Record<JourneyKey, JourneyState> {
  switch (status) {
    case 'draft':
      return { create: 'current', share: 'pending', live: 'pending', read: 'pending' }
    case 'active':
      return { create: 'done', share: 'current', live: 'pending', read: 'pending' }
    case 'closed':
      return { create: 'done', share: 'done', live: 'done', read: 'current' }
    default:
      return { create: 'pending', share: 'pending', live: 'pending', read: 'pending' }
  }
}

/** How a question's answers would be drawn: words for open text, columns for everything else. */
export type FigureKind = 'words' | 'scale' | 'choice'

export function figureKind(type: string): FigureKind {
  if (type === 'open_ended') return 'words'
  if (type === 'multiple_choice' || type === 'yes_no') return 'choice'
  return 'scale'
}

export interface TypeCount {
  type: string
  count: number
}

/** Question types in the order they first appear, each with how many questions use it. */
export function typeCounts(questions: readonly { type: string }[]): TypeCount[] {
  const counts: TypeCount[] = []
  for (const question of questions) {
    const found = counts.find((entry) => entry.type === question.type)
    if (found) found.count += 1
    else counts.push({ type: question.type, count: 1 })
  }
  return counts
}

export interface WordBars {
  /** The words that may be shown, most frequent first. Empty while `suppressed`. */
  words: WordCloudEntry[]
  /** Words dropped for being said once, reported so the total reconciles. */
  withheld: number
  /** The session is below the floor: nothing it said may be shown. */
  suppressed: boolean
}

/**
 * The word bars a session may show: `suppressWordCloud`'s two floors (the session under 5
 * withholds everything; a word said once is dropped and counted), then the most frequent
 * first, alphabetical among equals so the order is stable, capped at `limit`.
 */
export function wordBars(words: readonly WordCloudEntry[], responses: number, limit = 12): WordBars {
  const kept = suppressWordCloud(words, responses)
  const sorted = [...kept.words].sort((a, b) => b.value - a.value || a.text.localeCompare(b.text))
  return { words: sorted.slice(0, limit), withheld: kept.withheldCount, suppressed: kept.isSuppressed }
}

/** `MicroclimateInvitationStatuses`' ladder, in the order an invitation climbs it. */
export const INVITATION_LADDER = ['pending', 'sent', 'opened', 'started', 'completed'] as const

/**
 * Which rungs the server records for this session and which it refuses to, straight from
 * the list payload's anonymity contract: up to `highestRecordableState`, minus every
 * `suppressedStates` entry. For an anonymous session that is pending → sent → opened, with
 * started and completed struck — the ladder the board draws.
 */
export function invitationLadder(anonymity: Pick<MicroclimateAnonymityGuarantee, 'highestRecordableState' | 'suppressedStates'>): {
  recorded: string[]
  suppressed: string[]
} {
  const suppressed = INVITATION_LADDER.filter((state) => anonymity.suppressedStates.includes(state))
  const ceiling = INVITATION_LADDER.indexOf(anonymity.highestRecordableState as (typeof INVITATION_LADDER)[number])
  const reachable = ceiling === -1 ? INVITATION_LADDER : INVITATION_LADDER.slice(0, ceiling + 1)
  return { recorded: reachable.filter((state) => !suppressed.includes(state)), suppressed }
}

/** The sessions, newest first by creation — a copy; the caller's array is state. */
export function newestFirst(list: readonly Microclimate[]): Microclimate[] {
  return [...list].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}

const QUARTER_HOUR_MS = 15 * 60_000
/** The window a first session gets when there is no previous one to copy: 48 hours. */
export const DEFAULT_WINDOW_MS = 48 * 3_600_000

/**
 * The schedule a new session starts with: opening at the next quarter hour, and open for as
 * long as the previous session was (48 hours when there is none, or its window is unusable).
 *
 * Opening NOW rather than on a date the board picked, because that is what launching does:
 * `SubmitResponseAsync` checks `status == active` and nothing else, and the lifecycle sweep
 * refuses `draft -> active` on `StartTime` (`MicroclimateLifecycleSchedule.cs`). A session
 * cannot be scheduled to open by itself, so a default in the future would describe
 * something the product does not do.
 */
export function defaultWindow(now: Date, previous?: { startTime: string; endTime: string } | null): { start: Date; end: Date } {
  const start = new Date(Math.ceil(now.getTime() / QUARTER_HOUR_MS) * QUARTER_HOUR_MS)
  const copied = previous ? Date.parse(previous.endTime) - Date.parse(previous.startTime) : Number.NaN
  const length = Number.isFinite(copied) && copied > 0 ? copied : DEFAULT_WINDOW_MS
  return { start, end: new Date(start.getTime() + length) }
}

/** A `datetime-local` value — `2026-09-14T08:00` — in the reader's own zone. */
export function toLocalInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Milliseconds from `start` to `end`, or `null` when either is missing, unparseable or out of order. */
export function windowMs(start: string, end: string): number | null {
  const from = new Date(start).getTime()
  const to = new Date(end).getTime()
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null
  return to - from
}

/** A window as hours when it is at least one, else as minutes — `48 horas`, `30 minutos`. */
export function windowLength(ms: number): { unit: 'hours' | 'minutes'; value: number } {
  const hours = Math.round(ms / 3_600_000)
  return hours >= 1 ? { unit: 'hours', value: hours } : { unit: 'minutes', value: Math.max(1, Math.round(ms / 60_000)) }
}
