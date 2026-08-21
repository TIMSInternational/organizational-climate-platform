import { useState } from 'react'
import { Link } from 'react-router'
import { BellRing, LogOut, ShieldCheck, UserRound } from 'lucide-react'
import { useTranslation, LanguageSwitcher } from '../../i18n'
import { Avatar, AvatarFallback } from '../ui/avatar'
import { getToken } from '../../auth/token'
import { decodeJwtPayload } from '../../auth/jwt'
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
export function ThemeSwitcher({ compact = false }: { compact?: boolean } = {}) {
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
      {compact ? null : <span>{t('shell.theme')}</span>}
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

/**
 * Who is signed in, at the foot of the rail — the ForMaps sidebar's user block.
 *
 * Reads the JWT rather than taking props, for the same reason `AdminLayout` does:
 * the claims are the only thing that knows, there is no `/auth/me` on this API, and
 * threading name and role down through the shell would mean two components could
 * disagree about who is signed in.
 *
 * The role vocabulary is snake_case on the wire (`company_admin`) and camelCase in
 * the catalogue (`users.companyAdmin`), so it is mapped explicitly rather than
 * transformed — an unrecognised role then renders nothing instead of a half-built
 * key like `users.some_new_role` appearing in the sidebar.
 */
const ROLE_LABEL_KEY: Record<string, string> = {
  super_admin: 'users.superAdmin',
  company_admin: 'users.companyAdmin',
  leader: 'users.leader',
  supervisor: 'users.supervisor',
  employee: 'users.employee',
}

function SidebarUser() {
  const { t } = useTranslation()
  const token = getToken()
  const claims = token ? decodeJwtPayload(token) : null
  const name = typeof claims?.name === 'string' ? claims.name : undefined
  const role = typeof claims?.role === 'string' ? claims.role : undefined

  // No name means no block. A tile showing a blank initial over an empty line is
  // worse than nothing there, and says less than the sign-out button below it.
  if (!name) return null

  const roleKey = role ? ROLE_LABEL_KEY[role] : undefined

  return (
    <div className="flex w-full items-center gap-inline">
      <Avatar className="size-icon-box shrink-0">
        {/* The initial, not an image: there is no avatar upload in this product,
            so an <AvatarImage> would always fall through to this anyway. */}
        <AvatarFallback className="text-2xs font-semibold">
          {name.trim().charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="flex min-w-0 flex-col">
        {/* `truncate` on both: the rail is a fixed width and a long name has to
            clip rather than widen it or wrap into the controls below. */}
        <span className="truncate text-sm font-medium text-fg-primary">{name}</span>
        {roleKey ? (
          <span className="truncate text-2xs text-fg-tertiary">{t(roleKey)}</span>
        ) : null}
      </span>
    </div>
  )
}

export interface ShellControlsProps {
  onSignOut: () => void
}

/**
 * Language, theme, notification preferences and sign out.
 *
 * One component rendered in two places — the desktop sidebar footer and the
 * mobile drawer — because the sidebar is `hidden` below `md`. Duplicating the
 * three controls in `AdminLayout` and `MobileNav` is how one of them ends up
 * missing a control that the other has.
 *
 * Notification preferences (#103) live here rather than in `navSections`
 * deliberately. That module is role-aware and returns nothing at all for
 * employees, supervisors and leaders, so a nav entry would hide the page from
 * exactly the people whose own preferences it manages. This block is the shell's
 * per-account surface — language, theme, sign out — and the page belongs beside
 * them, on every role.
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
      <SidebarUser />

      {/* The two pickers share one row, captions off. Stacked with their captions
          they occupied four lines of a 230px rail — "Select Language" alone wrapped
          onto its own — and the foot of the navigation read as a settings form
          rather than as part of the shell. `min-w-0` lets each select shrink to its
          half instead of forcing the row wider than the rail. */}
      <div className="flex w-full min-w-0 items-center gap-inline [&>label]:min-w-0 [&_select]:w-full">
        <LanguageSwitcher compact />
        <ThemeSwitcher compact />
      </div>

      {/* All three rows share the nav items' shape, so the foot of the rail reads as
          navigation rather than as unrelated controls.

          The profile row (#136) is here for exactly the reason the notification
          preferences row below it is: every role owns a profile, and `navSections`
          is role-aware and returns nothing for most of them. */}
      <Link
        to="/profile"
        className="flex w-full items-center gap-inline rounded-md px-2 py-1 text-sm text-fg-secondary no-underline hover:bg-state-hover hover:text-fg-primary"
      >
        <UserRound aria-hidden="true" className="nav-icon" />
        {t('profile.title')}
      </Link>
      <Link
        to="/settings/notifications"
        className="flex w-full items-center gap-inline rounded-md px-2 py-1 text-sm text-fg-secondary no-underline hover:bg-state-hover hover:text-fg-primary"
      >
        <BellRing aria-hidden="true" className="nav-icon" />
        {t('notifications.preferences.title')}
      </Link>
      {/* #137. Third per-account row, on the same argument as the two above: the one
          endpoint behind `/settings/privacy` is `GET /gdpr/access` with no user id,
          which the handler documents as the self-service case that needs no role, so
          every role can load it and `navSections` would hide it from most of them. */}
      <Link
        to="/settings/privacy"
        className="flex w-full items-center gap-inline rounded-md px-2 py-1 text-sm text-fg-secondary no-underline hover:bg-state-hover hover:text-fg-primary"
      >
        <ShieldCheck aria-hidden="true" className="nav-icon" />
        {/* The short label, matching `SidebarUserMenu`: this rail is 230px and the two
            rows above it are two words each. */}
        {t('privacy.navLabel')}
      </Link>
      <button
        type="button"
        onClick={onSignOut}
        className="flex w-full items-center gap-inline rounded-md border-none bg-transparent px-2 py-1 text-left text-sm text-fg-secondary hover:bg-state-hover hover:text-fg-primary"
      >
        <LogOut aria-hidden="true" className="nav-icon" />
        {t('shell.signOut')}
      </button>
    </div>
  )
}
