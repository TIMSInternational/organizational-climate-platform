import { NavLink } from 'react-router'
import { Bell, Lock, UsersRound } from 'lucide-react'
import { useTranslation } from '../../../i18n'
import { cn } from '../../../lib/cn'

const TABS = [
  { to: '/profile', key: 'profile.next.tabs.profile', icon: UsersRound },
  { to: '/settings/notifications', key: 'profile.next.tabs.notifications', icon: Bell },
  { to: '/settings/privacy', key: 'profile.next.tabs.privacy', icon: Lock },
] as const

/**
 * The three account pages' shared strip — *Tu perfil · Notificaciones · Privacidad* — as the
 * Profile, NotificationPreferences and PrivacySettings artboards (10 Sep) draw it: a recessed
 * track with the current page raised on a card. Links, not tabs: each is its own route, the
 * user menu reaches each directly, and the browser's back button should step between them.
 */
export default function AccountTabs() {
  const { t } = useTranslation()
  return (
    <nav aria-label={t('profile.next.tabs.label')} className="self-start">
      <ul className="m-0 inline-flex list-none gap-1 rounded-lg border border-line-default bg-surface-icon-box p-1">
        {TABS.map(({ to, key, icon: Icon }) => (
          <li key={to} className="m-0">
            <NavLink
              to={to}
              end
              className={({ isActive }) =>
                cn(
                  'inline-flex h-7.5 items-center gap-1.5 rounded-md px-3 text-sm no-underline hover:no-underline',
                  isActive
                    ? 'border border-line-default bg-surface-card font-semibold text-fg-primary shadow-sm'
                    : 'border border-transparent text-fg-secondary hover:text-fg-primary',
                )
              }
            >
              <Icon aria-hidden="true" className="size-3.5" />
              {t(key)}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
