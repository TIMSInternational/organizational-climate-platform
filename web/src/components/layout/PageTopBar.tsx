import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useTranslation } from '../../i18n'
import {
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Separator,
  type BadgeVariantProps,
} from '../ui'

/**
 * The header of a page: title, breadcrumbs, a status badge and the page's actions.
 *
 * ## Which legacy component this actually is
 *
 * #80 asks for "`PageTopBar` (page title, breadcrumb slot, action slot)". The
 * legacy `layout/PageTopBar.tsx` has **none of those** — it is 19 lines that
 * render a right-aligned `<NotificationDropdown />` and nothing else. The
 * component with the title, breadcrumbs, description, badge and actions is the
 * legacy `layout/Navbar.tsx`, which despite the name is a page header and not a
 * navigation bar. So this is a port of `Navbar.tsx` under the issue's name, which
 * is what the issue describes and what "adopt it in existing pages" can only
 * mean; the legacy `PageTopBar`'s one job is deliberately not ported, because
 * `NotificationDropdown` has no data source until #99 and a bell that can only
 * ever say "no notifications" is worse than no bell. Recorded here rather than
 * silently reconciled.
 *
 * ## Deviations from `Navbar.tsx`
 *
 * - No `framer-motion` entrance (the repo does not port it — #75–#77). The
 *   `animate-slide-up` keyframe exists in `theme.css` if a page ever wants one.
 * - The four `SurveyNavbar`/`MicroclimateNavbar`/`ActionPlanNavbar` presets are
 *   not ported. Each hardcoded an English title, description and breadcrumb
 *   trail, so every one of them would need to become a translated wrapper around
 *   this component, and the breadcrumb trail they hardcode
 *   (`Dashboard → Surveys`) points at a `/dashboard` route that does not exist in
 *   this app yet. A page passes its own props instead.
 * - Copy is never defaulted in English. `breadcrumbLabel` falls back to
 *   `shell.breadcrumb` from the catalogue rather than to the string "Breadcrumb"
 *   — this component is app-level and has translation context, unlike the `ui/`
 *   primitives that have to take their labels as props.
 */
export interface PageBreadcrumb {
  /** Already-translated text. */
  label: string
  /** In-app path. Omit for the current page, which renders unlinked. */
  href?: string
}

export interface PageTopBarProps {
  /** Already-translated. Rendered as the page's `<h1>`. */
  title: string
  /** Optional supporting line under the title. */
  description?: string
  /**
   * Trail, outermost first. The last entry is rendered as the current page
   * whether or not it has an `href`, matching `BreadcrumbPage`'s contract.
   */
  breadcrumbs?: PageBreadcrumb[]
  /** Accessible name for the breadcrumb `<nav>`. Defaults to `shell.breadcrumb`. */
  breadcrumbLabel?: string
  badge?: {
    /** Already-translated. */
    text: string
    variant?: BadgeVariantProps['variant']
  }
  /** Buttons, links, filters — whatever the page acts with. */
  actions?: ReactNode
}

export function PageTopBar({
  title,
  description,
  breadcrumbs,
  breadcrumbLabel,
  badge,
  actions,
}: PageTopBarProps) {
  const { t } = useTranslation()

  return (
    <div data-slot="page-top-bar" className="mb-section flex flex-col gap-inline">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <Breadcrumb aria-label={breadcrumbLabel ?? t('shell.breadcrumb')}>
          <BreadcrumbList>
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1
              return (
                // The separator is a sibling `<li>`, not a child of the item.
                // `BreadcrumbSeparator` renders an `<li>`, and the legacy Navbar
                // wrapped both in a `<div>` inside the `<ol>` — an `<li>` inside a
                // `<div>` inside an `<ol>` is invalid either way, and the
                // separators stop being list items the AT can skip past.
                <Fragment key={`${crumb.label}-${index}`}>
                  {index > 0 && <BreadcrumbSeparator />}
                  <BreadcrumbItem>
                    {crumb.href && !isLast ? (
                      // `asChild` so the router owns the navigation: a bare
                      // `<a href>` full-page-reloads the SPA, which throws away the
                      // token in memory and every bit of loaded state.
                      <BreadcrumbLink asChild className="text-fg-secondary hover:text-fg-primary">
                        <Link to={crumb.href}>{crumb.label}</Link>
                      </BreadcrumbLink>
                    ) : (
                      <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                    )}
                  </BreadcrumbItem>
                </Fragment>
              )
            })}
          </BreadcrumbList>
        </Breadcrumb>
      )}

      {/* `flex-wrap` rather than a fixed two-column row: the actions slot holds
          real buttons, and at 320px a title plus two buttons does not fit on one
          line. Without it the row overflows the panel horizontally. */}
      <div className="flex flex-wrap items-center justify-between gap-inline">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-inline">
            {/* No bottom margin: index.css gives every `h1` `margin-bottom: 8px`,
                which would double up with this container's `gap`. */}
            <h1 className="mb-0 min-w-0 break-words">{title}</h1>
            {badge && <Badge variant={badge.variant}>{badge.text}</Badge>}
          </div>
          {/* `text-fg-secondary`, not `text-fg-tertiary`. Measured in Chrome:
              `--admin-font-tertiary` #818181 on the panel #ffffff is **3.90:1** at
              13px, which fails WCAG AA 1.4.3 (4.5:1 for body text). #474747 is
              8.59:1. The dark palette passes either way (4.60:1), which is exactly
              how a light-mode-only failure survives review. */}
          {/* `break-words` for the same reason the title has it, and it took a
              320px Spanish render to show: "Retroalimentación" is 120px at 13px
              type and the description box is 110px there, so a single unbreakable
              word pushed 10px out of its own box. */}
          {description && <p className="mb-0 break-words text-fg-secondary">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-inline">{actions}</div>}
      </div>

      <Separator />
    </div>
  )
}
