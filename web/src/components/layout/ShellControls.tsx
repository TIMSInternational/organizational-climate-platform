import { useState } from 'react'
import { LogOut } from 'lucide-react'
import { useTranslation, LanguageSwitcher } from '../../i18n'
import { readAdminThemeMode, setAdminThemeMode, type AdminThemeMode } from '../../theme/adminTheme'

const THEME_MODES: readonly AdminThemeMode[] = ['light', 'dark', 'system']

const THEME_LABEL_KEY: Record<AdminThemeMode, string> = {
  light: 'shell.themeLight',
  dark: 'shell.themeDark',
  system: 'shell.themeSystem',
}

/**
 * Theme picker for the shell.
 *
 * `theme/adminTheme.ts` has shipped `setAdminThemeMode` since #74 and the token
 * layer has shipped a full dark palette, but **nothing in the app ever called
 * it** — `initAdminTheme()` reads `localStorage` at boot and there was no UI to
 * write it, so the dark palette was unreachable except by editing storage by
 * hand, and the four `shell.theme*` catalogue keys were dead. That is a shell
 * gap, so it is closed here.
 *
 * A native `<select>` for the same reason `LanguageSwitcher` uses one: correct
 * keyboard and screen-reader behaviour with no work, and it is already styled by
 * the element layer in index.css.
 */
export function ThemeSwitcher() {
  const { t } = useTranslation()
  // Read once on mount rather than every render: `localStorage` is the source of
  // truth, but reading it in a render body makes the component impure.
  const [mode, setMode] = useState<AdminThemeMode>(() => readAdminThemeMode())

  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--admin-size-inline-gap)',
        marginBottom: 0,
        fontSize: 'var(--admin-text-sm)',
        color: 'var(--admin-font-secondary)',
      }}
    >
      <span>{t('shell.theme')}</span>
      <select
        value={mode}
        aria-label={t('shell.theme')}
        onChange={(event) => {
          const next = event.target.value
          // Narrow rather than cast: the options below are the only source, but a
          // cast here would hide it if that ever stopped being true.
          if (!THEME_MODES.includes(next as AdminThemeMode)) return
          setMode(next as AdminThemeMode)
          setAdminThemeMode(next as AdminThemeMode)
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
        {THEME_MODES.map((option) => (
          <option key={option} value={option}>
            {t(THEME_LABEL_KEY[option])}
          </option>
        ))}
      </select>
    </label>
  )
}

export interface ShellControlsProps {
  onSignOut: () => void
}

/**
 * Language, theme and sign out.
 *
 * One component rendered in two places — the desktop sidebar footer and the
 * mobile drawer — because the sidebar is `hidden` below `md`. Duplicating the
 * three controls in `AdminLayout` and `MobileNav` is how one of them ends up
 * missing a control that the other has.
 */
export function ShellControls({ onSignOut }: ShellControlsProps) {
  const { t } = useTranslation()

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 'var(--admin-size-inline-gap)',
        marginTop: 'var(--admin-size-panel-gap)',
        paddingTop: 'var(--admin-size-panel-gap)',
        borderTop: '1px solid var(--admin-border-light)',
      }}
    >
      <LanguageSwitcher />
      <ThemeSwitcher />
      <button type="button" onClick={onSignOut}>
        <LogOut aria-hidden="true" className="nav-icon" />
        {t('shell.signOut')}
      </button>
    </div>
  )
}
