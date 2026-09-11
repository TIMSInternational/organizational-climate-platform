/**
 * The options of the detail's País select (the `SuperCompanyDetail` artboard draws a select,
 * not a text box).
 *
 * The wire is free text: `PUT /admin/companies/{id}` trims whatever string it is given
 * (`CompanyEndpoints.cs`), and the tenants hold names ("Costa Rica", "Colombia"). So the list
 * is not typed here and invents no closed set of its own: it is every region the reader's
 * browser can name (`Intl.DisplayNames`, two-letter region subtags), in the reader's
 * language and alphabetical order, less the subtags that are not countries. A tenant whose
 * country is spelled some other way keeps it: the current value is always an option, so
 * opening the form never changes what a save would send.
 */

/** Region subtags ICU names that are not a country: groupings, pseudo-locales, the unknown region. */
const NOT_A_COUNTRY = new Set(['EU', 'EZ', 'UN', 'QO', 'XA', 'XB', 'ZZ'])

const cache = new Map<string, readonly string[]>()

/** Every country name the reader's browser knows, in `locale`, sorted; empty where `Intl` cannot say. */
export function countryNames(locale: string): readonly string[] {
  const cached = cache.get(locale)
  if (cached) return cached
  const names = new Set<string>()
  try {
    const display = new Intl.DisplayNames([locale], { type: 'region', fallback: 'none' })
    for (let first = 0; first < 26; first += 1) {
      for (let second = 0; second < 26; second += 1) {
        const code = String.fromCharCode(65 + first, 65 + second)
        if (NOT_A_COUNTRY.has(code)) continue
        const name = display.of(code)
        if (name && name !== code) names.add(name)
      }
    }
  } catch {
    // An engine without region display names offers the current value alone.
  }
  const sorted = [...names].sort((a, b) => a.localeCompare(b, locale))
  cache.set(locale, sorted)
  return sorted
}

/** The select's options: the countries, with the tenant's current value first when it is not one of them. */
export function countryOptions(locale: string, current: string): readonly string[] {
  const names = countryNames(locale)
  const value = current.trim()
  return value === '' || names.includes(value) ? names : [value, ...names]
}
