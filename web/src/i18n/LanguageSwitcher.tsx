import { useTranslation } from './useTranslation'
import { LOCALES, isLocale } from './locale'

/**
 * Locale picker for the app shell.
 *
 * A native `<select>` rather than a custom dropdown: it is keyboard- and
 * screen-reader-correct for free, and the overlay primitives that a bespoke one
 * would build on are not ported yet (#76).
 */
export default function LanguageSwitcher() {
  const { t, locale, setLocale } = useTranslation('language')

  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--admin-size-inline-gap)',
        fontSize: 'var(--admin-text-sm)',
        color: 'var(--admin-font-secondary)',
      }}
    >
      <span>{t('selectLanguage')}</span>
      <select
        value={locale}
        aria-label={t('switchLanguage')}
        onChange={(event) => {
          const next = event.target.value
          // The value can only come from the options below, but narrowing here
          // keeps `setLocale` honestly typed rather than cast at the call site.
          if (isLocale(next)) setLocale(next)
        }}
        style={{
          minHeight: 'var(--admin-size-control-md)',
          padding: `var(--admin-space-4) var(--admin-space-8)`,
          borderRadius: 'var(--admin-radius-md)',
          border: '1px solid var(--admin-border-default)',
          background: 'var(--admin-bg-panel)',
          color: 'var(--admin-font-primary)',
          fontSize: 'var(--admin-text-sm)',
        }}
      >
        {LOCALES.map((option) => (
          <option key={option} value={option}>
            {t(option === 'en' ? 'english' : 'spanish')}
          </option>
        ))}
      </select>
    </label>
  )
}
