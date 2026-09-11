import type { TranslateFn } from '../i18n'

/**
 * A count as the canvas writes it inside a sentence: two to ten spelled out — «cinco
 * departamentos y la administración», «seis consentimientos» — and any other count as the
 * numeral in the reader's locale. The words are `dashboard.next.countWord`, the catalogue the
 * Panel de Control already reads for «tres encuestas cerradas». A tile, a table cell or a
 * reading prints digits and never comes through here: this is for running prose only.
 *
 * One and zero stay numerals on purpose: «uno»/«una» agrees with the noun it counts, and a
 * sentence that can say "none" should say it in its own words rather than spell a zero.
 */
export function countWord(t: TranslateFn, count: number, locale: string): string {
  return Number.isInteger(count) && count >= 2 && count <= 10 ? t(`dashboard.next.countWord.${count}`) : count.toLocaleString(locale)
}
