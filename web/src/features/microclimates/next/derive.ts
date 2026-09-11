import type { Microclimate, Question, WordCloudEntry } from '../api/microclimates'
import { participationPercent, suppressWordCloud } from '../microclimatePrivacy'
import type { FlowStep } from './model'

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

function newestFirst(a: Microclimate, b: Microclimate): number {
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
  const open = rows.filter((row) => row.status === OPEN).sort(newestFirst)
  const drafts = rows.filter((row) => row.status === DRAFT).sort(newestFirst)
  const past = rows.filter((row) => row.status !== OPEN && row.status !== DRAFT).sort(newestFirst)
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

export interface WordBars {
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
export function wordBars(
  words: readonly WordCloudEntry[],
  responseCount: number,
  max = MAX_WORD_BARS,
): WordBars {
  const { words: kept, withheldCount, isSuppressed } = suppressWordCloud(words, responseCount)
  if (isSuppressed) return { isSuppressed, bars: [], withheldCount }
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
