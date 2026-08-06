import type { Locale } from '../../i18n'

/**
 * Renders an API timestamp for display, in the reader's locale.
 *
 * The `ui/notification-dropdown` primitive takes `timestamp` pre-formatted on
 * purpose — "the caller owns locale-aware date formatting" — and the inbox table
 * needs the same string, so it lives here once rather than in both.
 *
 * `Intl` rather than a hand-rolled format because the two locales genuinely
 * disagree about order: 2 Aug in `en` is "Aug 2", in `es` "2 ago". A fixed
 * `YYYY-MM-DD` would be neither, and `toLocaleString()` with no locale argument
 * follows the *browser's* language rather than the one the user picked in the
 * shell, so a Spanish reader on an English machine would get English dates on an
 * otherwise Spanish page.
 *
 * An unparseable value renders as the raw string rather than "Invalid Date":
 * whatever the server sent is more useful to whoever has to debug it.
 */
export function formatNotificationTimestamp(iso: string, locale: Locale): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso
  return parsed.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
}
