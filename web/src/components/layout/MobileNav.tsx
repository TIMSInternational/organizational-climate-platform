import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { Menu } from 'lucide-react'
import { cn } from '../../lib/cn'
import { useTranslation } from '../../i18n'
import RoleBasedNav from '../../navigation/RoleBasedNav'
import { activeHref, leafNavItems, mobileTabs, type NavSection } from '../../navigation/navSections'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '../ui'

export interface MobileNavProps {
  sections: NavSection[]
  /**
   * Shell controls that live in the sidebar footer on desktop — language, theme,
   * sign out. Without them here they would be unreachable on a phone, because the
   * sidebar they live in is hidden below `md`.
   */
  footer?: ReactNode
}

/**
 * Bottom tab bar plus a drawer, below the `md` breakpoint only.
 * Ported from `climate-project/src/components/layout/MobileNav.tsx`.
 *
 * ## What changed from the legacy version
 *
 * - **The drawer is a `Sheet` (Radix Dialog), not a hand-rolled `position: fixed`
 *   div.** The legacy drawer had no focus trap, no Escape handler and no focus
 *   return: opening it left keyboard focus on the page behind, and Tab walked out
 *   of the drawer into content the overlay had covered. `Sheet` is the same
 *   primitive the rest of the app uses, so that behaviour comes for free and is
 *   the library's problem rather than ours. The overlay-click-to-close the legacy
 *   version implemented by hand is also Radix's default.
 * - **It closes on navigation.** Kept from the legacy `useEffect` on `pathname` —
 *   a drawer that stays open over the page you just navigated to reads as a
 *   broken link. Radix does not do this, since it has no idea a route changed.
 * - **`aria-current="page"`** on the active tab. The legacy bar signalled the
 *   active tab with colour alone.
 */
export function MobileNav({ sections, footer }: MobileNavProps) {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  // Nothing to show for a role with no admin pages (see navSections.ts).
  if (sections.length === 0) return null

  // One tab per section of the rail — see `mobileTabs` for why not its first four rows.
  const tabs = mobileTabs(sections)

  // A titled section's tab stands for the whole section, so it is the current tab on every
  // page of that section: "Encuestas" on Plantillas' page as on Todas las encuestas'. A home row (Inicio, Mis encuestas) is
  // only ever current on its own page. Which page owns the path is the rail's own answer
  // (`activeHref`: segment-aware, most specific row wins), so the two cannot disagree.
  const current = activeHref(pathname, sections)
  const currentSection = sections.find((section) =>
    section.items.some((item) => item.href === current || (item.sub ?? []).some((sub) => sub.href === current)),
  )
  function isActive(href: string): boolean {
    if (current === null || !currentSection) return false
    if (!currentSection.titleKey) return href === current
    return leafNavItems([currentSection]).some((item) => item.href === href)
  }

  return (
    <nav
      aria-label={t('shell.mainNavigation')}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line-panel bg-surface-panel md:hidden"
      // The bar sits at the very bottom of the viewport, so on a phone with a
      // home indicator the tab labels land underneath it. `env()` resolves to 0
      // everywhere that has no inset, so this costs nothing elsewhere. Inline
      // rather than `pb-[env(...)]` because it is a runtime device measurement,
      // not a spacing decision — the same reason `--radix-*` values are exempt
      // from ui/tokenDiscipline.test.ts.
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="m-0 flex list-none items-stretch justify-around p-0">
        {tabs.map((item) => {
          const active = isActive(item.href)
          const label = t(item.labelKey)
          return (
            <li key={item.href} className="mb-0 flex min-w-0 flex-1">
              <Link
                to={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-control-lg w-full flex-col items-center justify-center gap-0.5 px-1 py-2',
                  'no-underline transition-colors',
                  // Colours the icon, which inherits `currentColor`. The label
                  // overrides it below — see why there.
                  active ? 'text-accent-blue' : 'text-fg-tertiary',
                )}
              >
                <item.icon aria-hidden="true" className="size-icon" />
                {/* The label does NOT inherit the row colour. Measured in Chrome
                    at 10px on the panel: `--admin-accent-blue` #2E9098 is 3.78:1
                    and `--admin-font-tertiary` #818181 is 3.90:1 — both fail WCAG
                    AA 1.4.3 (4.5:1). The *icons* keep those colours legitimately,
                    because a graphic is held to 1.4.11's 3:1 and both clear it.
                    So the active/inactive distinction is carried by weight and ink
                    on the text, and by hue on the icon. */}
                <span
                  className={cn(
                    'max-w-full truncate text-2xs',
                    active ? 'font-semibold text-fg-primary' : 'font-medium text-fg-secondary',
                  )}
                >
                  {label}
                </span>
              </Link>
            </li>
          )
        })}
        <li className="mb-0 flex min-w-0 flex-1">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger
              className={cn(
                'flex min-h-control-lg w-full flex-col items-center justify-center gap-0.5 px-1 py-2',
                'h-auto rounded-none border-none bg-transparent text-fg-tertiary',
              )}
            >
              <Menu aria-hidden="true" className="size-icon" />
              <span className="max-w-full truncate text-2xs font-medium text-fg-secondary">
                {t('shell.more')}
              </span>
            </SheetTrigger>
            {/* `pt-10`: `SheetContent` puts its close button at `top-3 right-3`,
                which lands exactly on the first nav row's disclosure chevron — seen
                in Chrome at 390px, the X sitting over the "›" of "Administración de
                Empresa". 40px of top padding drops the nav clear of the 12+24px
                button rather than moving the button, which is shared #76 surface. */}
            <SheetContent
              side="left"
              closeLabel={t('common.close')}
              className="w-sidebar overflow-y-auto pt-10"
            >
              {/* Radix warns when a Dialog has no Title, and a drawer with no
                  accessible name announces as an unlabelled dialog. Visually
                  redundant next to the nav, hence sr-only. */}
              <SheetTitle className="sr-only">{t('shell.menu')}</SheetTitle>
              <RoleBasedNav sections={sections} onNavigate={() => setOpen(false)} />
              {footer}
            </SheetContent>
          </Sheet>
        </li>
      </ul>
    </nav>
  )
}
