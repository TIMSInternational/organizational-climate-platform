import type { TranslateFn } from '../../../i18n'
import type { ReportShareSummary } from '../api/reportShares'
import type { ReportDocument } from '../reportDocument'
import type { ReportContents, ReportGroup, ReportRow } from './model'

/**
 * The arithmetic and the vocabulary behind the redesigned Informes and its share dialog.
 *
 * Pure and free of React so each figure can be asserted at values a fixture would take a
 * render to reach. Every number the two screens print comes from here.
 */

// ── Vocabulary ─────────────────────────────────────────────────────────────────────────

/**
 * Server values mapped to a catalogue key. Every one is free text or a small closed set on
 * the wire; a value this build ships no label for is printed as the server's own value
 * rather than as a missing key (the rule `components/ReportList.tsx` records).
 *
 * `climate_summary` is the type the product's own seeds and scheduled runs write
 * (`scripts/seed-demo-company.mjs`) — the key is the one PR #461 adds, byte for byte.
 */
const TYPE_KEYS: Record<string, string> = {
  summary: 'reports.type_summary',
  detailed: 'reports.type_detailed',
  comparison: 'reports.type_comparison',
  executive: 'reports.type_executive',
  climate_summary: 'reports.type_climate_summary',
}

const FORMAT_KEYS: Record<string, string> = {
  pdf: 'reports.format_pdf',
  excel: 'reports.format_excel',
  csv: 'reports.format_csv',
}

/** Status values `ReportEndpoints.CreateAsync` writes. */
const STATUS_KEYS: Record<string, string> = {
  generating: 'reports.statusGenerating',
  completed: 'reports.statusCompleted',
  failed: 'reports.statusFailed',
}

/** The six recurrences `RecurrenceSchedule.All` accepts. */
const RECURRENCE_KEYS: Record<string, string> = {
  daily: 'reports.recurrence_daily',
  weekly: 'reports.recurrence_weekly',
  biweekly: 'reports.recurrence_biweekly',
  monthly: 'reports.recurrence_monthly',
  quarterly: 'reports.recurrence_quarterly',
  yearly: 'reports.recurrence_yearly',
}

function vocabulary(t: TranslateFn, keys: Record<string, string>, value: string): string {
  const key = keys[value]
  return key ? t(key) : value
}

export const reportTypeLabel = (t: TranslateFn, value: string) => vocabulary(t, TYPE_KEYS, value)
export const reportFormatLabel = (t: TranslateFn, value: string) => vocabulary(t, FORMAT_KEYS, value)
export const reportStatusLabel = (t: TranslateFn, value: string) => vocabulary(t, STATUS_KEYS, value)
export const recurrenceLabel = (t: TranslateFn, value: string) => vocabulary(t, RECURRENCE_KEYS, value)

// ── Links ──────────────────────────────────────────────────────────────────────────────

/** The links that open right now, the one expiring first at the head. */
export function activeShares(shares: readonly ReportShareSummary[]): ReportShareSummary[] {
  return shares
    .filter((share) => share.isActive)
    .sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt))
}

/** Revoked or expired links, newest first — what "Mostrar revocados" opens. */
export function inactiveShares(shares: readonly ReportShareSummary[]): ReportShareSummary[] {
  return shares
    .filter((share) => !share.isActive)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}

/** How many times the given links were opened. */
export function opensOf(shares: readonly ReportShareSummary[]): number {
  return shares.reduce((sum, share) => sum + share.accessCount, 0)
}

export interface LinkReading {
  /** Links that open right now. */
  active: number
  /** When the first of them stops opening; `null` when none is active. */
  firstExpiry: string | null
  /** Opens of the active links only — a revoked link's history is not today's exposure. */
  opens: number
}

/** A report's public links, read off its shares; `null` when they were not read. */
export function linkReading(shares: readonly ReportShareSummary[] | null): LinkReading | null {
  if (shares === null) return null
  const active = activeShares(shares)
  return { active: active.length, firstExpiry: active[0]?.expiresAt ?? null, opens: opensOf(active) }
}

/**
 * The company's active links across every completed report — the second tile.
 *
 * `null` when any completed report's links were not read. A count over whichever rows
 * happened to load is a plausible wrong number, and "0 links" on a screen that could not
 * read them would say nobody can open a report when somebody can.
 */
export function companyLinks(rows: readonly ReportRow[]): LinkReading | null {
  const completed = rows.filter((row) => row.status === 'completed')
  if (completed.some((row) => row.shares === null)) return null
  return linkReading(completed.flatMap((row) => row.shares ?? []))
}

// ── Schedule and formats ───────────────────────────────────────────────────────────────

export interface ScheduleReading {
  count: number
  /** The earliest next generation among the recurring reports, ISO; `null` when none. */
  next: string | null
}

export function scheduleReading(rows: readonly ReportRow[]): ScheduleReading {
  const recurring = rows.filter((row) => row.isRecurring)
  const next = recurring
    .map((row) => row.nextGeneration)
    .filter((value): value is string => value !== null)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0]
  return { count: recurring.length, next: next ?? null }
}

/** "un CSV con los datos y un PDF para leer" — counted from the rows' formats. */
export function formatsSentence(t: TranslateFn, rows: readonly ReportRow[]): string | null {
  const csv = rows.filter((row) => row.format === 'csv').length
  const pdf = rows.filter((row) => row.format === 'pdf').length
  if (csv === 1 && pdf === 1) return t('reports.next.formatsOneEach')
  if (csv > 0 && pdf > 0) return t('reports.next.formatsBoth', { csv, pdf })
  if (csv > 0) return t('reports.next.formatsCsv', { count: csv })
  if (pdf > 0) return t('reports.next.formatsPdf', { count: pdf })
  return null
}

// ── Contents ───────────────────────────────────────────────────────────────────────────

export interface ContentsReading {
  /** Groups the report prints a number for. */
  shown: number
  total: number
  /** Names only. A protected group never yields a count, here or anywhere. */
  protectedGroups: string[]
  /**
   * The whole survey is under the floor: the report prints no response count at all, and
   * neither does this screen — an absent count is not a 0.
   */
  suppressed: boolean
}

export function contentsReading(contents: ReportContents): ContentsReading {
  const protectedGroups = contents.groups.filter((group) => group.isProtected).map((group) => group.name)
  return {
    shown: contents.groups.length - protectedGroups.length,
    total: contents.groups.length,
    protectedGroups,
    // The document's own decision OR this screen's re-floor, never one alone. #490's rule:
    // re-flooring what the server already floored means a document assembled any other way
    // still cannot put a number on this page.
    suppressed: contents.isSuppressed || contents.responses < contents.floor,
  }
}

/**
 * What a report contains, out of its own stored document.
 *
 * ## Every field here is DROPPED from the document, never recomputed
 *
 * `ReportDepartmentParticipation` says it outright (`ReportDtos.cs:28-36`): when
 * `isSuppressed` is true the aggregation has ALREADY zeroed `respondentCount`, so a
 * withheld department's headcount does not exist in the document for this function to
 * leak. It is carried across as a name and a boolean and nothing else — `ReportGroup` has
 * no count field, so there is no shape in which a `0` could reach the screen and read as
 * "nobody here answered". That is the specific failure the floor exists to prevent.
 *
 * Withheld departments ARE in `departments[]`, named, alongside the disclosed ones
 * (`ReportSurveySections.cs:77` maps every segment), which is what makes "4 de 5 grupos"
 * a true count of the document's groups rather than of its disclosed ones.
 *
 * ## Across sections
 *
 * `responses` sums the sections because the document is the sum of them; a total over
 * several surveys discloses no individual survey's count. A group is protected when it is
 * protected in ANY section — the safe direction: a department withheld in one survey and
 * disclosed in another still has numbers this document does not print.
 */
export function contentsOf(document: ReportDocument | null): ReportContents | null {
  const sections = document?.surveys ?? []
  if (sections.length === 0) return null

  const groups = new Map<string, ReportGroup>()
  for (const section of sections) {
    for (const department of section.departments) {
      // A department the document did not name is not a group this screen can name.
      const name = department.name?.trim()
      if (!name) continue
      const seen = groups.get(name)
      groups.set(name, { name, isProtected: (seen?.isProtected ?? false) || department.isSuppressed })
    }
  }

  return {
    surveyName: sections.length === 1 ? (sections[0].title?.trim() || null) : null,
    surveyCount: sections.length,
    responses: sections.reduce((total, section) => total + section.participation.responseCount, 0),
    groups: [...groups.values()],
    // Every section withheld means the document has no disclosed numbers at all, whatever
    // the totals add up to.
    isSuppressed: sections.every((section) => section.isSuppressed),
    // The strictest floor any section was generated under.
    floor: Math.max(...sections.map((section) => section.minimumGroupSize)),
  }
}

/**
 * The survey every row's contents names, or `null` when they name different ones, name
 * none, or any row has no contents at all. A multi-survey document names none, so a list
 * holding one never claims a single survey.
 */
export function commonSurvey(rows: readonly ReportRow[]): string | null {
  if (rows.length === 0 || rows.some((row) => row.contents === null)) return null
  const names = new Set(rows.map((row) => row.contents?.surveyName ?? null))
  if (names.size !== 1) return null
  return rows[0].contents?.surveyName ?? null
}

// ── Share dialog ───────────────────────────────────────────────────────────────────────

/** The server's default lifetime when none is sent (`ReportShareTokens.DefaultLifetimeDays`). */
export const DEFAULT_LIFETIME_DAYS = 30

const DAY_MS = 86_400_000

/**
 * The lifetime the server will mint for what was typed — `ClampLifetimeDays` clamps to
 * [1, 365] rather than refusing. Used for the "hasta el …" PREVIEW only: the request sends
 * what was typed, and the mint response's `expiresAt` stays the authority afterwards.
 */
export function previewLifetime(input: string): number {
  const parsed = Number.parseInt(input, 10)
  if (!Number.isFinite(parsed)) return DEFAULT_LIFETIME_DAYS
  return Math.min(365, Math.max(1, parsed))
}

/** The instant a link minted now for `days` would stop opening. */
export function expiryPreview(days: number, now: number): number {
  return now + days * DAY_MS
}

/** The first and last day the given inactive links stopped opening (revoked, else expired). */
export function inactiveSpan(inactive: readonly ReportShareSummary[]): { first: number; last: number } | null {
  const instants = inactive
    .map((share) => Date.parse(share.revokedAt ?? share.expiresAt))
    .filter((instant) => !Number.isNaN(instant))
  if (instants.length === 0) return null
  return { first: Math.min(...instants), last: Math.max(...instants) }
}

/** Same calendar day in UTC — the zone `calendarDay` renders in, so the two cannot disagree. */
export function sameUtcDay(a: number, b: number): boolean {
  const x = new Date(a)
  const y = new Date(b)
  return (
    x.getUTCFullYear() === y.getUTCFullYear() && x.getUTCMonth() === y.getUTCMonth() && x.getUTCDate() === y.getUTCDate()
  )
}

/** "2 aperturas" / "1 apertura". */
export function opensPhrase(t: TranslateFn, count: number): string {
  return count === 1 ? t('reports.next.opensOne') : t('reports.next.opens', { count })
}

/**
 * The address of a link minted before this dialog opened. The token exists in readable
 * form only in the mint response (`report_shares` stores a SHA-256 hash), so an earlier
 * link can be named by its route and never shown or copied.
 */
export function maskedShareUrl(host: string): string {
  return `${host}/shared/reports/····`
}
