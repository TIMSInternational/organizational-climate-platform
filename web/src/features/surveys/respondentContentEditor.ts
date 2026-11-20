import { createTranslator } from '../../i18n'
import { CATALOGUES } from '../../i18n/locale'
import {
  TEXT_ALIGN_KEY,
  type RespondentContent,
  type RespondentContentByLocale,
  type RespondentContentChanges,
  type RespondentContentEntry,
  type RespondentContentView,
  type RespondentTextLocale,
} from './api/respondentContent'

/**
 * The pure rules behind the two editors of a client's respondent texts — the company's
 * («Textos para quien responde» in company settings) and the survey's (`RespondentTextsDialog`).
 * Ruled 2026-11-19, `docs/decisions/editable-respondent-content.md`: survey → company → product
 * default, per locale; empty at a level means inherit.
 *
 * Kept out of the components so "what does an empty box stand for" and "what does a save send"
 * are asserted directly rather than only through a rendered form.
 */

/** The text locales both editors offer, in the order they are drawn. */
export const TEXT_LOCALES: readonly RespondentTextLocale[] = ['es', 'en']

/** One screen's entries, in the registry's order (which is the order a respondent meets them). */
export interface EntryGroup {
  group: string
  entries: RespondentContentEntry[]
}

/**
 * The screen texts, grouped by screen in registry order. The emails are not edited here (their
 * editors are another lane's), and the one display choice is drawn apart.
 */
export function screenGroups(entries: readonly RespondentContentEntry[]): EntryGroup[] {
  const groups: EntryGroup[] = []
  for (const entry of entries) {
    if (entry.kind !== 'screen') continue
    const last = groups[groups.length - 1]
    const existing = last?.group === entry.group ? last : groups.find((g) => g.group === entry.group)
    if (existing) existing.entries.push(entry)
    else groups.push({ group: entry.group, entries: [entry] })
  }
  return groups
}

/** The display choice the editors offer (`display.textAlign`), if the registry has it. */
export function textAlignEntry(entries: readonly RespondentContentEntry[]): RespondentContentEntry | null {
  return entries.find((entry) => entry.key === TEXT_ALIGN_KEY && entry.kind === 'display') ?? null
}

/** The catalogue key of a field's label: `surveys.next.respondentContent.fields.<key, dots as underscores>`. */
export function fieldLabelKey(key: string): string {
  return `surveys.next.respondentContent.fields.${key.replace(/\./g, '_')}`
}

/** The catalogue key of a screen's heading. */
export function groupLabelKey(group: string): string {
  return `surveys.next.respondentContent.groups.${group}`
}

/**
 * The product default for a screen key in `locale`, exactly as the catalogue holds it — its
 * `{placeholders}` unfilled, which is what tells an editor where the numbers go.
 */
export function productDefault(locale: RespondentTextLocale, key: string): string {
  return createTranslator(CATALOGUES[locale])(`surveyRespond.${key}`)
}

/** What an empty box at this level stands for. */
export interface Inherited {
  from: 'company' | 'default'
  text: string
}

/**
 * At the survey level: the company's text when it wrote one in this locale, else the product
 * default in this locale. At the company level: always the default.
 */
export function inheritedText(view: RespondentContentView, locale: RespondentTextLocale, key: string): Inherited {
  if (view.level === 'survey') {
    const company = view.companyValues[locale]?.[key]
    if (typeof company === 'string' && company.trim() !== '') return { from: 'company', text: company }
  }
  return { from: 'default', text: productDefault(locale, key) }
}

/** The values the editor's boxes start with: this level's own, every locale present. */
export function ownValues(view: RespondentContentView): RespondentContentByLocale {
  const own = view.level === 'survey' ? view.surveyValues : view.companyValues
  return {
    es: { ...(own?.es ?? {}) },
    en: { ...(own?.en ?? {}) },
    '*': { ...(own?.['*'] ?? {}) },
  }
}

/**
 * What a save sends: every key whose box differs from what is stored at this level, trimmed,
 * `''` for an emptied box (the PUT's "clear, inherit again"). Only `locales` are looked at for
 * texts; the display choices are always looked at. Nothing else is sent, so a save never
 * touches a key the editor did not change — and never writes the inherited text down as this
 * level's own.
 */
export function contentChanges(
  stored: RespondentContentByLocale,
  draft: RespondentContentByLocale,
  locales: readonly RespondentTextLocale[],
): RespondentContentChanges {
  const changes: RespondentContentChanges = {}
  const compare = (locale: 'es' | 'en' | '*') => {
    const before = stored[locale] ?? {}
    const after = draft[locale] ?? {}
    const keys = new Set([...Object.keys(before), ...Object.keys(after)])
    const out: Record<string, string> = {}
    for (const key of keys) {
      const was = (before[key] ?? '').trim()
      const now = (after[key] ?? '').trim()
      if (was !== now) out[key] = now
    }
    if (Object.keys(out).length > 0) changes[locale] = out
  }
  for (const locale of locales) compare(locale)
  compare('*')
  return changes
}

export function hasChanges(changes: RespondentContentChanges): boolean {
  return Object.values(changes).some((values) => values !== undefined && Object.keys(values).length > 0)
}

/**
 * The first `{name}` in `text` that `entry` does not allow, or null. The server refuses the same
 * thing (`respondent_content_unknown_placeholder`); saying it beside the box first means the
 * operator learns which box, not just that one of forty was wrong.
 */
export function unknownPlaceholder(entry: RespondentContentEntry, text: string): string | null {
  for (const match of text.matchAll(/\{(\w+)\}/g)) {
    if (!entry.placeholders.includes(match[1])) return match[0]
  }
  return null
}

/** Every text box in `draft` with a placeholder its entry does not allow. */
export function placeholderProblems(
  entries: readonly RespondentContentEntry[],
  draft: RespondentContentByLocale,
  locales: readonly RespondentTextLocale[],
): { locale: RespondentTextLocale; key: string; placeholder: string }[] {
  const problems: { locale: RespondentTextLocale; key: string; placeholder: string }[] = []
  for (const locale of locales) {
    for (const entry of entries) {
      if (entry.kind !== 'screen') continue
      const placeholder = unknownPlaceholder(entry, draft[locale]?.[entry.key] ?? '')
      if (placeholder !== null) problems.push({ locale, key: entry.key, placeholder })
    }
  }
  return problems
}

/** `draft` with one value replaced. */
export function withValue(
  draft: RespondentContentByLocale,
  locale: 'es' | 'en' | '*',
  key: string,
  value: string,
): RespondentContentByLocale {
  const next: RespondentContent = { ...draft[locale], [key]: value }
  return { ...draft, [locale]: next }
}
