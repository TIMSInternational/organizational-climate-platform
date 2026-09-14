import { ANONYMITY_FLOOR, isSuppressed } from '../../../components/charts'
import type { Locale } from '../../../i18n'
import type { Microclimate, Question, WordCloudEntry } from '../api/microclimates'
import type { MicroclimateAnonymityGuarantee } from '../api/microclimateLinks'
import { participationPercent, suppressWordCloud } from '../microclimatePrivacy'
import type { FlowStep } from './model'

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
 * The schedule a new session starts with: opening at the current quarter hour — never in the
 * future, so a fresh form is launchable as it stands — and open for as
 * long as the previous session was (48 hours when there is none, or its window is unusable).
 *
 * Opening NOW rather than on a date the board picked, because that is what launching does:
 * `SubmitResponseAsync` checks `status == active` and nothing else, and the lifecycle sweep
 * refuses `draft -> active` on `StartTime` (`MicroclimateLifecycleSchedule.cs`). A session
 * cannot be scheduled to open by itself, so a default in the future would describe
 * something the product does not do.
 */
export function defaultWindow(now: Date, previous?: { startTime: string; endTime: string } | null): { start: Date; end: Date } {
  const start = new Date(Math.floor(now.getTime() / QUARTER_HOUR_MS) * QUARTER_HOUR_MS)
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
  if (ms >= 3_600_000) return { unit: 'hours', value: Math.round(ms / 3_600_000) }
  return { unit: 'minutes', value: Math.max(1, Math.round(ms / 60_000)) }
}

/* ------------------------------------------------------------------------------------
 * The list and the live session (`MicroclimatesListNextPage`, `MicroclimateLiveNextPage`)
 *
 * Two lanes wrote a `next/derive.ts` at once: the four authoring screens above and these
 * two below. Merged here rather than split, so one module still holds every microclimate
 * rule. Three names collided and only the ones below moved: `newestFirst` -> `byNewestFirst`
 * (a comparator here, a sorted copy above), and `wordBars`/`WordBars` -> `liveWordBars`/
 * `LiveWordBars`. Both word functions apply the SAME floor, `suppressWordCloud`; they differ
 * only in what they hand a view (`share` per bar, 8 max, for the live screen; 12 plain words
 * for Resultados). Unifying that cap is a product ruling, not a merge decision.
 * ---------------------------------------------------------------------------------- */

/**
 * The pure half of the two redesigned microclimate screens: what the artboards print
 * that the wire does not spell out — the order of the sessions, where the flow stands,
 * the short name a sentence refers to a session by, the word bars, the dates in the
 * artboards' two formats. No React, no request, so each rule is tested on its own.
 */

/** `MicroclimateValidation.ValidStatuses` — the complete, closed set. */
const OPEN = 'active'
const DRAFT = 'draft'
const CLOSED = 'closed'

function byNewestFirst(a: Microclimate, b: Microclimate): number {
  return Date.parse(b.createdAt) - Date.parse(a.createdAt)
}

/**
 * The list's two sections: what is in progress (open sessions, then drafts, each
 * newest first) and what is past.
 *
 * Anything that is neither open nor a draft lands in the past rather than nowhere: the
 * status set is closed today, and a row the page silently dropped the day it grew a
 * fourth value would be a session nobody could find. `filter` copies before `sort`
 * reorders, so the caller's array is never mutated.
 */
export function groupSessions(rows: readonly Microclimate[]): {
  inProgress: Microclimate[]
  past: Microclimate[]
} {
  const open = rows.filter((row) => row.status === OPEN).sort(byNewestFirst)
  const drafts = rows.filter((row) => row.status === DRAFT).sort(byNewestFirst)
  const past = rows.filter((row) => row.status !== OPEN && row.status !== DRAFT).sort(byNewestFirst)
  return { inProgress: [...open, ...drafts], past }
}

/**
 * Where a session stands on the flow card: Crear, Compartir, Ver en vivo, Leer.
 *
 * A draft is still being made (1) — it cannot be shared, the respond page refuses a
 * session that has not opened. An open session is being watched (3): sharing and
 * watching happen together, and the artboard puts the weekly pulse "por el paso 3" the
 * moment it opens, at 0 of 20. A closed one is read (4).
 */
export function flowStepOf(status: string): FlowStep | null {
  if (status === DRAFT) return 1
  if (status === OPEN) return 3
  if (status === CLOSED) return 4
  return null
}

/**
 * The name a sentence refers to a session by: the title before its dash.
 * "Pulso semanal — ¿cómo fue la semana?" is "Pulso semanal" in the flow caption and in
 * the past-sessions note, as the artboard writes it. A title with no dash is itself.
 */
export function shortTitle(title: string): string {
  const [head] = title.split(/\s+[—–-]\s+/)
  const trimmed = head.trim()
  return trimmed === '' ? title : trimmed
}

/** The article a Spanish sentence sets before a session's noun: "el pulso", "la encuesta". */
export type SessionGender = 'masculine' | 'feminine'

/**
 * The nouns a session title is known to start with, and the article each takes in
 * Spanish. Closed on purpose: the payload carries a free `title` and nothing about its
 * grammar (`GET /microclimates`, `GET /microclimates/{id}`), and an article guessed from
 * a word's ending would write "la clima" in a climate product. Singular only: the
 * sentences say "va por" and "cierre".
 */
const SESSION_NOUNS: Readonly<Record<string, SessionGender>> = {
  pulso: 'masculine',
  microclima: 'masculine',
  clima: 'masculine',
  sondeo: 'masculine',
  encuesta: 'feminine',
  consulta: 'feminine',
  retro: 'feminine',
  retrospectiva: 'feminine',
}

/** How a sentence names the session in progress — see `sessionReference`. */
export type SessionReference =
  | { kind: 'noun'; gender: SessionGender; phrase: string }
  | { kind: 'title'; title: string }

/**
 * How a sentence names the session in progress. The artboard writes "el pulso semanal va
 * por el paso 3" and "cuando el pulso semanal cierre" for the title "Pulso semanal —
 * ¿cómo fue la semana?": the head (`shortTitle`) read as a common noun, its first letter
 * lower-cased, behind its article. That is grammatical only in a Spanish sentence and
 * only when the head's first word is a noun whose article is known, so it is done only
 * then; any other title is named the way the product names a title inside a sentence,
 * «Check-in del lunes». Only the first letter moves, so a department named later keeps
 * its capital ("el pulso de Operaciones"), and a first word in capitals ("PULSO") does
 * not match and keeps its title.
 */
export function sessionReference(title: string, locale: Locale): SessionReference {
  const head = shortTitle(title)
  if (locale !== 'es') return { kind: 'title', title: head }
  const [first] = head.split(/\s+/)
  const noun = first.charAt(0).toLocaleLowerCase('es') + first.slice(1)
  if (!Object.hasOwn(SESSION_NOUNS, noun)) return { kind: 'title', title: head }
  return { kind: 'noun', gender: SESSION_NOUNS[noun], phrase: noun + head.slice(first.length) }
}

/** The respond route — `/microclimates/:id/respond`, the public page. */
export function respondPath(id: string): string {
  return `/microclimates/${id}/respond`
}

/** The absolute link a respondent opens: the origin the administrator is looking at. */
export function respondUrl(origin: string, id: string): string {
  return `${origin}${respondPath(id)}`
}

/** The link as the artboard prints it: host and path, no scheme. The copy carries the scheme. */
export function displayLink(origin: string, id: string): string {
  return `${origin.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')}${respondPath(id)}`
}

/** The bar's fill, 0–100, or `null` when there is no target — a denominator is never invented. */
export function fillPercent(responses: number, target: number): number | null {
  const rate = participationPercent(responses, target)
  return rate === null ? null : Math.max(0, Math.min(100, rate))
}

/**
 * What one question asks, as the Preguntas fact words it ("una escala de 1 a 5, una
 * palabra opcional"): a catalogue key, its count when the scale is configured, and
 * whether it may be skipped.
 *
 * `open_ended` is "una palabra" because that is all this surface keeps of it:
 * `SubmitResponseAsync` folds the text into word frequencies and discards the answer,
 * and the screen calls them "palabras" everywhere else.
 */
export interface QuestionKind {
  kindKey: string
  /** Points on a configured scale; only read by `kindScaleOptions`. */
  count: number
  optional: boolean
}

const KIND_KEYS: Record<string, string> = {
  likert: 'microclimates.next.live.kindLikert',
  rating: 'microclimates.next.live.kindLikert',
  open_ended: 'microclimates.next.live.kindOpenEnded',
  yes_no: 'microclimates.next.live.kindYesNo',
  multiple_choice: 'microclimates.next.live.kindMultipleChoice',
  emoji_rating: 'microclimates.next.live.kindEmojiRating',
}

const SCALE_TYPES = new Set(['likert', 'rating'])

export function questionKinds(questions: readonly Question[]): QuestionKind[] {
  return questions
    .toSorted((a, b) => a.order - b.order)
    .map((question) => {
      const configured = question.options?.length ?? 0
      // `NUMERIC_SCALE_TYPES`: a likert or rating question with no options is a 1-5
      // scale; one with options is a scale of that many points.
      const kindKey =
        SCALE_TYPES.has(question.type) && configured > 0
          ? 'microclimates.next.live.kindScaleOptions'
          : (KIND_KEYS[question.type] ?? 'microclimates.next.live.kindOther')
      return { kindKey, count: configured, optional: !question.required }
    })
}

/** How many word bars the live panel draws. Past this the words stop being a reading. */
export const MAX_WORD_BARS = 8

export interface WordBar {
  text: string
  value: number
  language: string
  /** Its length against the most frequent word, 0–1. */
  share: number
}

export interface LiveWordBars {
  /** Under the floor: no bar, no count, nothing but the hatch. */
  isSuppressed: boolean
  bars: WordBar[]
  /** Words dropped for being too rare, reported so the total still reconciles. */
  withheldCount: number
}

/**
 * The word bars, with both floors of `microclimatePrivacy.ts` applied first: below
 * `MINIMUM_RESPONDENTS` responses there are no bars at all, and above it a word needs
 * `MINIMUM_WORD_OCCURRENCES` before it is drawn. Frequencies only — a bar is a word and
 * a count, never an answer.
 *
 * Sorted here rather than trusted: the endpoint returns whatever order the stored JSON
 * holds, and "the top eight" of an unsorted list is eight arbitrary words.
 */
export function liveWordBars(
  words: readonly WordCloudEntry[],
  responseCount: number,
  max = MAX_WORD_BARS,
): LiveWordBars {
  // One guard, the shared one: under the floor `suppressWordCloud` hands back no words at
  // all, so nothing below can draw a bar. A second early return here was a copy of it —
  // breaking it changed nothing (mutation M1), which is how a floor ends up held in two
  // places at two different values.
  const { words: kept, withheldCount, isSuppressed } = suppressWordCloud(words, responseCount)
  const top = kept
    .toSorted((a, b) => b.value - a.value || a.text.localeCompare(b.text))
    .slice(0, max)
  const peak = top[0]?.value ?? 0
  return {
    isSuppressed,
    bars: top.map((word) => ({ ...word, share: peak > 0 ? word.value / peak : 0 })),
    withheldCount,
  }
}

function format(value: string | Date, locale: string, options: Intl.DateTimeFormatOptions): string | null {
  const instant = value instanceof Date ? value.getTime() : Date.parse(value)
  if (Number.isNaN(instant)) return null
  return new Intl.DateTimeFormat(locale, options).format(instant)
}

/** "11 sept" — the list row's close date. `null` for an unreadable instant, never "Invalid Date". */
export function dayMonth(value: string, locale: string): string | null {
  return format(value, locale, { day: 'numeric', month: 'short' })
}

/** "11 de septiembre" — a date in a sentence. */
export function dayMonthLong(value: string, locale: string): string | null {
  return format(value, locale, { day: 'numeric', month: 'long' })
}

/** "21:06" — the hour a session opens or closes. */
export function clock(value: string | Date, locale: string): string | null {
  return format(value, locale, { hour: 'numeric', minute: '2-digit' })
}

/** "21:50:42" — when the live figure was last read. */
export function clockSeconds(value: Date, locale: string): string | null {
  return format(value, locale, { hour: 'numeric', minute: '2-digit', second: '2-digit' })
}

/** "9 sept 2026, 21:06" — the facts under the link. */
export function stamp(value: string, locale: string): string | null {
  return format(value, locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
