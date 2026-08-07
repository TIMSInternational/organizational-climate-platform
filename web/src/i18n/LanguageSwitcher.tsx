import { useTranslation } from './useTranslation'
import { LOCALES, isLocale } from './locale'

/**
 * Locale picker for the app shell.
 *
 * A native `<select>` rather than a custom dropdown: it is keyboard- and
 * screen-reader-correct for free, and the overlay primitives that a bespoke one
 * would build on are not ported yet (#76).
 */
export interface LanguageSwitcherProps {
  /**
   * Drop the visible caption and let the control stand alone.
   *
   * For the sidebar rail, which is a fixed ~230px: "Select Language" beside a
   * select does not fit, so it wrapped onto its own line and the footer read as a
   * settings form pasted into the navigation. `aria-label` on the `<select>` below
   * already carries the accessible name, so nothing is lost by hiding the caption
   * -- it was duplicating that label, not supplying it.
   */
  compact?: boolean
}

export default function LanguageSwitcher({ compact = false }: LanguageSwitcherProps = {}) {
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
      {compact ? null : <span>{t('selectLanguage')}</span>}
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
