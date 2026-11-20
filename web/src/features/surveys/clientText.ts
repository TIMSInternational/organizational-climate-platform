import type { TranslateFn } from '../../i18n'
import { effectiveText, type RespondentContentSource, type RespondentTextAlign } from './api/respondentContent'

/**
 * A translator that says the client's words where the payload carries them and the catalogue's
 * everywhere else — `effectiveText(source, locale, key, params) ?? t(key, params)` with the
 * three inputs bound once, for a respondent screen that reads several registry keys.
 *
 * Returned as `{ t }` so a component writes `const { t } = clientText(view, locale, catalogue)`
 * and keeps calling `t('demographics.intro')`: `keysExist.test.ts` reads every literal handed
 * to an identifier (or property) named `t`, so the keys stay checked against both catalogues.
 *
 * Only registry keys (`RespondentContentRegistry.cs`) ever arrive in `content` — the server
 * puts nothing else there — so a key outside it (an identified variant, an error, a device
 * note that states what is recorded) always reads the catalogue, whatever this is handed.
 * See `docs/decisions/editable-respondent-content.md`.
 *
 * @param source the respond view, the invitation landing, a refusal drawn as a card, or a Home
 * survey; null where none is loaded (every key reads the catalogue).
 * @param locale the screen's own language (`useTranslation().locale`) — `effectiveText`
 * returns the default whenever it is not the payload's `resolvedLocale`.
 * @param catalogue the `surveyRespond` translator.
 */
export function clientText(
  source: RespondentContentSource | null | undefined,
  locale: string,
  catalogue: TranslateFn,
): { t: TranslateFn } {
  return {
    t: (key, params) => effectiveText(source, locale, key, params) ?? catalogue(key, params),
  }
}

/**
 * The class a respondent paragraph is set with for `display.textAlign` (`textAlignOf`):
 * justified with hyphenation — PROCOMER's request of 2026-11-19, the product default — or ragged
 * (`start`) for a client who asks for it.
 *
 * `hyphens-auto` comes only with `justify`: it exists to keep a justified line on a phone from
 * opening wide gaps, and it hyphenates in the reader's language because `TranslationProvider`
 * sets `<html lang>` to the locale. A ragged line needs neither.
 */
export function respondAlignClass(align: RespondentTextAlign): string {
  return align === 'start' ? 'text-start' : 'text-justify hyphens-auto'
}
