import type { TranslateFn } from '../../../../i18n'

/**
 * Catalogue lookups for the super administrator's screens — the closed vocabularies
 * the org-structure API speaks (`size`, `subscriptionTier`, `language`) and the
 * one/many pairs the catalogue spells out, because the translator has no plural
 * support of its own (`i18n/translate.ts` substitutes `{name}` and nothing else).
 *
 * Same rule as `../../labels.ts`: a `Map`, never an object literal, so a token the
 * API grows later is unknown here rather than resolved up the prototype chain; and an
 * unknown token comes back as the server's own word rather than as invented prose.
 */

const SIZE_KEYS = new Map<string, string>([
  ['startup', 'superadmin.next.sizes.startup'],
  ['small', 'superadmin.next.sizes.small'],
  ['medium', 'superadmin.next.sizes.medium'],
  ['large', 'superadmin.next.sizes.large'],
  ['enterprise', 'superadmin.next.sizes.enterprise'],
])

const TIER_KEYS = new Map<string, string>([
  ['basic', 'superadmin.next.tiers.basic'],
  ['professional', 'superadmin.next.tiers.professional'],
  ['enterprise', 'superadmin.next.tiers.enterprise'],
])

const LANGUAGE_KEYS = new Map<string, string>([
  ['es', 'superadmin.next.languages.es'],
  ['en', 'superadmin.next.languages.en'],
  ['both', 'superadmin.next.languages.both'],
])

/**
 * A company's size. `CompanyValidation.sizes` is the vocabulary a new company is
 * created with, but the column is free text on the wire and older tenants carry a
 * headcount range (`500-1000`); that reads as "500–1000 personas" rather than raw.
 * `null` for an unset size — the caller says "sin tamaño", never an empty cell.
 */
export function sizeText(t: TranslateFn, size: string | null): string | null {
  const value = size?.trim()
  if (!value) return null
  const key = SIZE_KEYS.get(value.toLowerCase())
  if (key) return t(key)
  const range = /^(\d+)\s*[-–]\s*(\d+)$/.exec(value)
  if (range) return t('superadmin.next.sizes.range', { range: `${range[1]}–${range[2]}` })
  return value
}

/** The subscription tier, or `null` when the company has none. */
export function tierText(t: TranslateFn, tier: string | null): string | null {
  const value = tier?.trim()
  if (!value) return null
  const key = TIER_KEYS.get(value.toLowerCase())
  return key ? t(key) : value
}

/** A content language — the company's setting or a survey's own. */
export function languageText(t: TranslateFn, language: string | null | undefined): string | null {
  const value = language?.trim()
  if (!value) return null
  const key = LANGUAGE_KEYS.get(value.toLowerCase())
  return key ? t(key) : value
}

const ROLE_KEYS = new Map<string, string>([
  ['super_admin', 'superadmin.next.users.roles.super_admin'],
  ['company_admin', 'superadmin.next.users.roles.company_admin'],
  ['leader', 'superadmin.next.users.roles.leader'],
  ['supervisor', 'superadmin.next.users.roles.supervisor'],
  ['employee', 'superadmin.next.users.roles.employee'],
])

/**
 * A role as the roster prints it, in sentence case ("Administrador de empresa"). The
 * canvas genders each chip by the person; nothing on the wire says a person's gender, so
 * the chip uses the unmarked form rather than guessing one from a first name.
 */
export function roleText(t: TranslateFn, role: string): string {
  const key = ROLE_KEYS.get(role)
  return key ? t(key) : role
}

/** A one/many pair of catalogue keys; both carry `{count}`. */
export interface CountKeys {
  one: string
  many: string
}

export function countText(t: TranslateFn, keys: CountKeys, count: number): string {
  return t(count === 1 ? keys.one : keys.many, { count })
}

export type SurveyStatusKey = 'active' | 'closed' | 'draft' | 'archived'

export const STATUS_COUNT_KEYS: Readonly<Record<SurveyStatusKey, CountKeys>> = {
  active: { one: 'superadmin.next.status.activeOne', many: 'superadmin.next.status.activeMany' },
  closed: { one: 'superadmin.next.status.closedOne', many: 'superadmin.next.status.closedMany' },
  draft: { one: 'superadmin.next.status.draftOne', many: 'superadmin.next.status.draftMany' },
  archived: { one: 'superadmin.next.status.archivedOne', many: 'superadmin.next.status.archivedMany' },
}

export const PERSON_COUNT_KEYS: CountKeys = {
  one: 'superadmin.next.personOne',
  many: 'superadmin.next.personMany',
}

/**
 * "sector, país, plan ni encuestas". A negative list takes *ni* in Spanish, which
 * `Intl.ListFormat` has no type for (`conjunction` gives *y*, `disjunction` gives *o*),
 * so the joiners are catalogue entries and the catalogue decides.
 */
export function joinNor(t: TranslateFn, items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  const head = items.slice(0, -1).join(t('superadmin.next.dashboard.attention.listJoin'))
  return `${head}${t('superadmin.next.dashboard.attention.norJoin')}${items[items.length - 1]}`
}

/** A calendar day with its year — the canvas's "10 sept 2026" under *Alta*. UTC, as `calendarDay`. */
export function dayWithYear(iso: string, locale: string): string {
  return new Date(Date.parse(iso)).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** A calendar day written out — the canvas's "8 de agosto". UTC, as `calendarDay`. */
export function longDay(iso: string, locale: string): string {
  return new Date(Date.parse(iso)).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })
}

/** `part` of `whole` as a percentage for a bar's width; 0 when there is no whole. */
export function percentOf(part: number, whole: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return 0
  return Math.max(0, Math.min(100, (part / whole) * 100))
}
