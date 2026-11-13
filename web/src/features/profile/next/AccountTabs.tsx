import { NavLink } from 'react-router'
import { Bell, Lock, UsersRound } from 'lucide-react'
import { useTranslation } from '../../../i18n'
import { cn } from '../../../lib/cn'
import { useRespondentShell } from '../../../navigation/useRespondentShell'

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
  const respondent = useRespondentShell()

  // Nothing at all in the respondent's shell, and this is the hop that mattered. The two
  // account rows were taken out of their menu on 2026-10-18; this strip put them straight
  // back, because landing on ANY of the three pages offered the other two. A respondent
  // reaches one through the bell -> /notifications -> "Preferencias de notificaciones",
  // which is a chain of links the shell does not control.
  //
  // `null` rather than a filtered list: with one page left the strip is a single raised
  // chip labelling the page you are already on, which is chrome, not navigation.
  if (respondent) return null

  return (
    <nav aria-label={t('profile.next.tabs.label')} className="w-full self-start sm:w-auto">
      {/* The `.seg` of `occ.css`, drawn as `ui/SegmentedControl` draws it (and NOT that component:
          these are links to three routes, not a value to pick). Until 12 Nov this sat on
          `--fill` with the chosen tab only raised and bolder, and in dark the raised card is
          DARKER than that track — 1.30:1, measured by the review, against the 3:1 WCAG 1.4.11
          asks of the cue that marks the selected state. Now: the recessed tile track, the
          chosen tab edged in the control line (the 3:1 boundary `controlBoundaryContrast.test.ts`
          holds), and weight plus ink (600 primary against 500 secondary). Full width on a
          phone, each tab sharing it, so no label wraps. */}
      <ul className="m-0 flex list-none gap-0.5 rounded-lg border border-line-light bg-surface-icon-box p-0.5 sm:inline-flex">
        {TABS.map(({ to, key, icon: Icon }) => (
          <li key={to} className="m-0 flex-1 sm:flex-none">
            <NavLink
              to={to}
              end
              className={({ isActive }) =>
                cn(
                  'flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-sm sm:px-3 no-underline hover:no-underline pointer-coarse:h-11',
                  isActive
                    ? 'border-line-control bg-surface-card font-semibold text-fg-primary shadow-sm'
                    : 'border-transparent font-medium text-fg-secondary hover:bg-state-hover hover:text-fg-primary',
                )
              }
            >
              <Icon aria-hidden="true" className="hidden size-3.5 sm:block" />
              {t(key)}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
