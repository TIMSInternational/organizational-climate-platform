import { useState } from 'react'
import { Link } from 'react-router'
import {
  ChevronDown,
  ChevronRight,
  LogOut,
  Monitor,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
  User,
} from 'lucide-react'
import { useTranslation } from '../../i18n'
import { LOCALES, isLocale } from '../../i18n/locale'
import { getToken } from '../../auth/token'
import { decodeJwtPayload } from '../../auth/jwt'
import { showsOwnName } from '../../auth/ownName'
import { useOwnDepartmentName } from '../../company-context/useCompanyName'
import {
  readAdminThemeMode,
  setAdminThemeMode,
  type AdminThemeMode,
} from '../../theme/adminTheme'

/**
 * The foot of the sidebar, ported from the ForMaps rail
 * (`app/dashboard/_components/StudentSidebar.tsx`) so the two products' shells are
 * the same component in different colours.
 *
 * Three parts, in their order: the person, a Settings/Sign-out row, and a menu that
 * opens *upward* out of the person.
 *
 * ## Why the pickers moved into a menu
 *
 * Language and theme used to sit in the rail as two labelled `<select>`s. Stacked
 * with their captions they took four lines of a 220px column — "Select Language"
 * did not fit beside its control and wrapped onto its own line — so the foot of the
 * navigation read as a settings form someone had pasted in. ForMaps puts the same
 * controls behind the user button, which is where a reader looks for "things about
 * me" and costs the rail nothing until opened.
 *
 * ## Colours
 *
 * Every value is a token. ForMaps hardcodes `#065292` for the selected fill and
 * `#fff` on top of it; the equivalents here are `--admin-accent-blue` and
 * `--admin-font-on-accent`, which `tokens.css` documents as existing for exactly
 * this row. Geometry — 28px rows, 4px radii, the 7px avatar tile — is theirs
 * verbatim, because that is what makes the two rails read as the same object.
 */

/** The wire role vocabulary is snake_case; the catalogue is camelCase. */
const ROLE_LABEL_KEY: Record<string, string> = {
  super_admin: 'users.superAdmin',
  company_admin: 'users.companyAdmin',
  leader: 'users.leader',
  supervisor: 'users.supervisor',
  employee: 'users.employee',
}

/**
 * The roles a department belongs to, whose rail line names it after the role — "Líder ·
 * Ingeniería", as every such role's artboard prints it (10 Sep). The two administrator roles
 * belong to no department and keep the role alone.
 */
const DEPARTMENT_ROLES: ReadonlySet<string> = new Set(['leader', 'supervisor', 'employee'])

const THEME_OPTIONS: readonly { mode: AdminThemeMode; labelKey: string; icon: typeof Sun }[] = [
  { mode: 'light', labelKey: 'shell.themeLight', icon: Sun },
  { mode: 'dark', labelKey: 'shell.themeDark', icon: Moon },
  { mode: 'system', labelKey: 'shell.themeSystem', icon: Monitor },
]

const ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  width: '100%',
  padding: '8px 10px',
  borderRadius: 4,
  border: 'none',
  background: 'transparent',
  color: 'var(--admin-font-secondary)',
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: 'inherit',
  textAlign: 'left',
}

export interface SidebarUserMenuProps {
  onSignOut: () => void
  /** Collapsed rail: avatar only, and opening the menu expands the rail instead. */
  collapsed?: boolean
  onExpand?: () => void
  /**
   * Where this block is drawn.
   *
   * `rail` is the sidebar's footer: a bordered block pinned to the bottom, the signed-in
   * person's name and role line under the avatar, Configuración and Cerrar sesión in a
   * row beneath, and the menu opening upward because there is nothing below it.
   *
   * `strip` is the railless shell (`isPerUserOnly`), where the same control sits in the
   * 52px top bar. Three differences, each for a reason rather than for taste:
   *
   * 1. The menu opens DOWNWARD and right-aligned. Upward from a top bar is off the top of
   *    the window — not a layout bug anyone can see, just a menu that appears not to open.
   * 2. The trigger is the avatar alone. The rail's trigger prints the role under the name,
   *    and `EMPLEADO` beside a respondent's own survey is the badge ESPH's rehearsal
   *    objected to; a strip is not the place to re-draw it.
   * 3. Configuración and Cerrar sesión move INTO the menu. In the rail they are a row
   *    under the avatar; in a 52px bar that row is a second line, which is how the first
   *    attempt grew the bar to 80px. **Sign out has to go somewhere** — it is the whole
   *    reason this control follows the rail into the header at all.
   */
  variant?: 'rail' | 'strip'
}

export function SidebarUserMenu({
  onSignOut,
  collapsed = false,
  onExpand,
  variant = 'rail',
}: SidebarUserMenuProps) {
  const strip = variant === 'strip'
  const { t, locale, setLocale } = useTranslation()
  const [open, setOpen] = useState(false)
  const [submenu, setSubmenu] = useState<'theme' | 'language' | null>(null)
  const [mode, setMode] = useState<AdminThemeMode>(() => readAdminThemeMode())

  const token = getToken()
  const claims = token ? decodeJwtPayload(token) : null
  const claimedName = typeof claims?.name === 'string' ? claims.name : undefined
  const role = typeof claims?.role === 'string' ? claims.role : undefined
  // `showsOwnName` is the whole rule, and it is shared with `ShellControls` — see
  // `auth/ownName.ts`. A respondent's rail says "Mi cuenta" and carries the role line, which
  // names no person. Everything below reads `name`, so there is one place to be wrong.
  const name = showsOwnName(role) ? claimedName : undefined
  const roleKey = role ? ROLE_LABEL_KEY[role] : undefined
  const departmentName = useOwnDepartmentName(role !== undefined && DEPARTMENT_ROLES.has(role))
  const roleLine = roleKey
    ? departmentName
      ? t('shell.roleWithDepartment', { role: t(roleKey), department: departmentName })
      : t(roleKey)
    : null

  function close() {
    setOpen(false)
    setSubmenu(null)
  }

  return (
    <div
      style={
        strip
          ? { position: 'relative', display: 'flex', alignItems: 'center' }
          : { padding: collapsed ? '8px 6px' : '8px 8px', borderTop: '1px solid var(--admin-border-light)', position: 'relative' }
      }
    >
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        // The rail's trigger is named by the text inside it. A collapsed rail and the
        // strip both draw the avatar ALONE, and a nameless account button is one a
        // screen reader announces as "button" — so the label comes from here instead.
        // Caught by `AdminLayout.test.tsx`'s privacy-page tests, which look this control
        // up by its accessible name; without it a respondent's only route to their own
        // GDPR page is a button nothing can address.
        aria-label={collapsed || strip ? t('shell.account') : undefined}
        onClick={() => {
          // Collapsed, the menu has nowhere to go and the labels inside it would be
          // unreadable, so the click expands the rail — ForMaps' behaviour.
          if (collapsed) {
            onExpand?.()
            return
          }
          setSubmenu(null)
          setOpen((value) => !value)
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          gap: 10,
          width: '100%',
          padding: collapsed ? '6px 4px' : '8px 8px',
          borderRadius: 6,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          color: 'var(--admin-font-primary)',
          fontFamily: 'inherit',
        }}
      >
        {/* The canvas's `.avatar` (10 Sep, every role's rail): a 28px circle in the rail's
            raised indigo with its strong ink, 11px at 600 — not an accent-filled tile.

            With no name to take an initial from it holds a person glyph rather than the `?`
            it used to. A respondent now reaches this branch on every page (`ownName.ts`), and
            `?` read as an error — the rail asking who you were — where the collapsed rail
            renders this circle and nothing else. */}
        <span
          data-slot="sidebar-avatar"
          style={{
            width: collapsed ? 24 : 28,
            height: collapsed ? 24 : 28,
            borderRadius: 999,
            background: 'var(--admin-shell-bg-raised)',
            color: 'var(--admin-shell-font-strong)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {name ? (
            name.trim().charAt(0).toUpperCase()
          ) : (
            <User aria-hidden="true" style={{ width: collapsed ? 14 : 16, height: collapsed ? 14 : 16 }} />
          )}
        </span>
        {!collapsed && !strip && (
          <>
            <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {name ?? t('shell.account')}
              </span>
              {/* Truncated like the name above it. Without this the role wrapped to
                  two lines in Spanish -- "Administrador de Empresa" was wider than
                  the 150px this column had in a 220px rail -- which grew the block
                  and pushed it into the Settings/Sign-out row beneath. Rendered in
                  Chrome at 1440x900 with `preferredLocale=es`. */}
              {roleLine ? (
                <span
                  data-slot="sidebar-role"
                  title={roleLine}
                  style={{
                    display: 'block',
                    fontSize: 11,
                    color: 'var(--admin-font-tertiary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {roleLine}
                </span>
              ) : null}
            </span>
            {/* No disclosure chevron: the canvas draws none. The button still says it opens
                a menu (`aria-haspopup`, `aria-expanded`). */}
          </>
        )}
      </button>

      {!collapsed && !strip && (
        // ForMaps' Settings/Sign-out row, with one thing theirs does not need. Their
        // two labels are "Settings" and "Sign out"; the Spanish pair is
        // "Configuración" and "Cerrar sesión", which at 12px plus two 14px glyphs
        // and their gaps overran this row and wrapped each control onto its own
        // line, straight through the user block above. Both labels shrink and
        // ellipsise, with `title` making the full text recoverable — the same
        // treatment `RoleBasedNav` gives its rows, and for the same reason. Since the
        // canvas (10 Sep) the rail is 236px and each control carries 2px of padding
        // and a 4px gap, as the artboards draw the pair flush: both fit whole at
        // 1440 (measured: "Cerrar sesión" wants 78px), and the ellipsis is for a
        // longer label or a wider font.
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '4px 4px 0' }}>
          <Link
            to="/settings/notifications"
            title={t('shell.settings')}
            style={{ ...ROW, width: 'auto', minWidth: 0, gap: 4, height: 28, padding: '0 2px', fontSize: 12, textDecoration: 'none' }}
          >
            <Settings aria-hidden="true" style={{ width: 14, height: 14, color: 'var(--admin-font-tertiary)', flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t('shell.settings')}
            </span>
          </Link>
          <button
            type="button"
            onClick={onSignOut}
            title={t('shell.signOut')}
            style={{ ...ROW, width: 'auto', minWidth: 0, gap: 4, height: 28, padding: '0 2px', fontSize: 12, marginLeft: 'auto' }}
          >
            <LogOut aria-hidden="true" style={{ width: 14, height: 14, color: 'var(--admin-font-tertiary)', flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t('shell.signOut')}
            </span>
          </button>
        </div>
      )}

      {open && !collapsed && (
        <>
          {/* A full-viewport click catcher, so anywhere outside closes the menu.
              `inset: 0` and a lower z-index than the panel below it. */}
          <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={close} />
          <div
            role="menu"
            style={{
              position: 'absolute',
              ...(strip
                ? { top: '100%', right: 0, marginTop: 4 }
                : { bottom: '100%', left: 8, marginBottom: 4 }),
              width: 200,
              background: 'var(--admin-bg-overlay)',
              backdropFilter: 'blur(12px) saturate(200%) contrast(100%) brightness(130%)',
              WebkitBackdropFilter: 'blur(12px) saturate(200%) contrast(100%) brightness(130%)',
              border: '1px solid var(--admin-border-light)',
              borderRadius: 8,
              zIndex: 100,
              // `--admin-shadow-lg`, not ForMaps' literal
              // `rgba(0,0,0,0.16)` pair. Two reasons: `tokenDiscipline` forbids a
              // raw colour anywhere under layout/, and that literal is tuned for a
              // light surface -- on this product's dark overlay it would be very
              // nearly invisible. The token carries a stronger value in dark mode,
              // so the menu keeps its lift in both.
              boxShadow: 'var(--admin-shadow-lg)',
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '4px 4px' }}>
              {submenu === null && (
                <>
                  {/* #136. Inside the account menu rather than in `navSections`, for
                      the same reason notification preferences are: that module is
                      role-aware and returns nothing for employees, supervisors and
                      leaders, so a nav entry would hide the page from most of the
                      people whose own profile it is. This menu is where a reader
                      looks for "things about me". */}
                  {/* Not offered in the strip. `/profile` is where a respondent meets
                      their own Nombre completo, Rol, Empresa and Departamento, under copy
                      that says "así te ven en la bitácora de cada plan y en lo que creas" —
                      and ESPH's reviewer read that, correctly, as the platform telling them
                      their name is attached to what they do. It is their own data and no
                      leak, but it is an admin's page: nothing on it a respondent answering a
                      one-week survey needs, and the one thing it offers them to change is
                      the name they were told not to think about. The route still exists. */}
                  {strip ? null : (
                  <Link
                    to="/profile"
                    role="menuitem"
                    style={{ ...ROW, textDecoration: 'none' }}
                    onClick={close}
                  >
                    <User aria-hidden="true" style={{ width: 16, height: 16, color: 'var(--admin-font-tertiary)', flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t('profile.title')}
                    </span>
                  </Link>
                  )}
                  {/* #137, immediately after Profile because it answers the same
                      question — "what does this product know about me". Same
                      argument for being here rather than in `navSections`: the page
                      is per-user surface every role can load, and that module is
                      role-aware. */}
                  {/* Nor Privacidad, and this is the one that was reported as costing an
                      answer. The page is honest and it is a right — but it opens on "Qué se
                      guarda sobre ti" and tells a respondent, in a table, that "tus
                      respuestas... llevan tu identificador", then prints their Nombre and
                      Correo at the foot. ESPH's reviewer read exactly that and wrote: "mi
                      información sí es guardada, no está siendo anónima, entonces no voy a
                      contestar."

                      Hiding the LINK does not remove the right, and this product already
                      routes the other half of it through an administrator — the page itself
                      says "el borrado no es un botón de esta página... lo pides tú; lo
                      ejecuta quien administra tu organización". Access now travels the same
                      way, which is consistent rather than a reduction.

                      It also had to go for a reason the menu alone did not show: that page
                      carries a tab bar — Tu perfil / Notificaciones / Privacidad — so while
                      it was offered here, dropping the other two rows bought nothing. */}
                  {strip ? null : (
                  <Link
                    to="/settings/privacy"
                    role="menuitem"
                    style={{ ...ROW, textDecoration: 'none' }}
                    onClick={close}
                  >
                    <ShieldCheck aria-hidden="true" style={{ width: 16, height: 16, color: 'var(--admin-font-tertiary)', flexShrink: 0 }} />
                    {/* `navLabel`, not `title`. This menu is 200px wide and the page's
                        own title ("Privacy and your data") ellipsised to "Privacy and
                        your dat…" in a screenshot — the same overrun the Settings and
                        Sign-out row above was rebuilt for. */}
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t('privacy.navLabel')}
                    </span>
                  </Link>
                  )}
                  <button type="button" role="menuitem" style={ROW} onClick={() => setSubmenu('theme')}>
                    <Moon aria-hidden="true" style={{ width: 16, height: 16, color: 'var(--admin-font-tertiary)', flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t('shell.theme')} · {t(THEME_OPTIONS.find((option) => option.mode === mode)!.labelKey)}
                    </span>
                    <ChevronRight aria-hidden="true" style={{ width: 12, height: 12, color: 'var(--admin-font-section-label)' }} />
                  </button>
                  <button type="button" role="menuitem" style={ROW} onClick={() => setSubmenu('language')}>
                    <Monitor aria-hidden="true" style={{ width: 16, height: 16, color: 'var(--admin-font-tertiary)', flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t('language.menuLabel')} · {t(locale === 'en' ? 'language.english' : 'language.spanish')}
                    </span>
                    <ChevronRight aria-hidden="true" style={{ width: 12, height: 12, color: 'var(--admin-font-section-label)' }} />
                  </button>
                  {strip && (
                    <>
                      {/* Configuración is NOT offered here, and that is finding 4 rather
                          than tidiness. It opens `/settings/notifications`, whose rows
                          include "Correos de planes de acción — Asignaciones y avances de
                          los planes de acción": action plans are *seguimiento*, and ESPH's
                          reviewer reported being shown "asociado al sistema de seguimiento"
                          without being able to tell whether that was meant for them. It was
                          not — a respondent is assigned no action plans. The page offers
                          them four toggles, three of which govern mail they will never be
                          sent, and the fourth of which can switch off the invitation this
                          whole launch depends on. */}
                      <div style={{ height: 1, background: 'var(--admin-border-hover)', margin: '4px 6px' }} />
                      <button
                        type="button"
                        role="menuitem"
                        style={ROW}
                        onClick={() => {
                          close()
                          onSignOut()
                        }}
                      >
                        <LogOut aria-hidden="true" style={{ width: 16, height: 16, color: 'var(--admin-font-tertiary)', flexShrink: 0 }} />
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {t('shell.signOut')}
                        </span>
                      </button>
                    </>
                  )}
                </>
              )}

              {submenu !== null && (
                <>
                  <button
                    type="button"
                    style={{ ...ROW, gap: 8, fontSize: 12, fontWeight: 500 }}
                    onClick={() => setSubmenu(null)}
                  >
                    <ChevronDown aria-hidden="true" style={{ width: 12, height: 12, transform: 'rotate(90deg)', color: 'var(--admin-font-section-label)' }} />
                    <span>{submenu === 'theme' ? t('shell.theme') : t('language.menuLabel')}</span>
                  </button>
                  <div style={{ height: 1, background: 'var(--admin-border-hover)', margin: '2px 6px' }} />
                </>
              )}

              {submenu === 'theme' &&
                THEME_OPTIONS.map((option) => (
                  <button
                    key={option.mode}
                    type="button"
                    role="menuitemradio"
                    aria-checked={mode === option.mode}
                    style={{ ...ROW, color: mode === option.mode ? 'var(--admin-font-primary)' : 'var(--admin-font-secondary)' }}
                    onClick={() => {
                      setMode(option.mode)
                      setAdminThemeMode(option.mode)
                      close()
                    }}
                  >
                    <option.icon
                      aria-hidden="true"
                      style={{ width: 16, height: 16, flexShrink: 0, color: mode === option.mode ? 'var(--admin-font-primary)' : 'var(--admin-font-tertiary)' }}
                    />
                    <span style={{ flex: 1 }}>{t(option.labelKey)}</span>
                    {mode === option.mode && <span aria-hidden="true" style={{ color: 'var(--admin-font-tertiary)', fontSize: 14 }}>✓</span>}
                  </button>
                ))}

              {submenu === 'language' &&
                LOCALES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="menuitemradio"
                    aria-checked={locale === option}
                    style={{ ...ROW, color: locale === option ? 'var(--admin-font-primary)' : 'var(--admin-font-secondary)' }}
                    onClick={() => {
                      if (isLocale(option)) setLocale(option)
                      close()
                    }}
                  >
                    <span style={{ flex: 1 }}>{t(option === 'en' ? 'language.english' : 'language.spanish')}</span>
                    {locale === option && <span aria-hidden="true" style={{ color: 'var(--admin-font-tertiary)', fontSize: 14 }}>✓</span>}
                  </button>
                ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
