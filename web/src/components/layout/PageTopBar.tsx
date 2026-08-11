import { Fragment, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { useTranslation } from '../../i18n'
import { getToken } from '../../auth/token'
import { decodeJwtPayload } from '../../auth/jwt'
import { buildNavSections, sectionTitleKeyForPath } from '../../navigation/navSections'
import {
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
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
 *
 * ## The page layout rule (UI-0)
 *
 * One rule carries every screen in the redesign: **page header, then a KPI row,
 * then the work.** This component is the header half of it, and its geometry is
 * the prototype's `.ptb`: a 14px pad under the content, a hairline bottom rule,
 * and 16px of air below that before the KPI row starts. The container itself
 * therefore owns the rule — there is no `<Separator />` element any more,
 * because a separator is a sibling with its own margins and the design's rule is
 * a property of the header box.
 *
 * The row is `items-start`, not `items-center`: when the actions wrap to two
 * lines the title must stay pinned to the top of the block rather than drifting
 * to its middle.
 *
 * Three deliberate deviations from `.ptb`, each because the repo's own layer
 * already answers the question:
 *
 * - **`<h1>`, not `<h2>`.** The prototype nests its screens inside a page that
 *   already has an `<h1>` in the caption above the shell; here the page title is
 *   the document's heading, 27 callers render exactly one of them, and demoting
 *   it would break the heading outline for AT.
 * - **20px, not 19px.** `text-2xl` is the type scale's step here, and the scale
 *   is a checked port (`styles/tokens.test.ts` pins it at eight `rem` sizes). A
 *   ninth token for a 1px difference buys nothing; the change that matters is
 *   away from the bare `h1`'s 24px, which is 26% too heavy for this header.
 *   `tracking-tight` is -0.025em against the prototype's -0.02em, and
 *   `font-semibold` is 600 against its 640 — which no static Poppins weight can
 *   render anyway, `styles/fonts.css` loading 400/500/600/700.
 * - **The description's cap is `max-w-measure`, not `max-w-prose`.** The design
 *   caps prose at 70ch; Tailwind v4 emits `max-w-prose` as a static utility with
 *   a literal 65ch rather than from a theme key, so it cannot be re-pointed, and
 *   `styles/theme.css` declares `--container-measure` instead. Tables and charts
 *   fill the width; only prose is capped, and there is no page width cap (see
 *   `app/AdminLayout.tsx`).
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
  /**
   * The small-caps line over the title — ForMaps prints "STUDENT PORTAL" there.
   *
   * Already translated. **Normally omitted**: left off, the component names the
   * area itself from the nav section the current route sits in, which is right
   * for all 27 callers and stays right when a nav entry changes group. Pass it
   * only where a page belongs somewhere the nav does not say, and pass `null` to
   * suppress it — `undefined` means "derive it", which is not the same request.
   */
  eyebrow?: string | null
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
  eyebrow,
  description,
  breadcrumbs,
  breadcrumbLabel,
  badge,
  actions,
}: PageTopBarProps) {
  const { t } = useTranslation()
  const derivedEyebrow = useSectionEyebrow()
  // `undefined` means derive; `null` means the caller asked for none.
  const eyebrowText = eyebrow === undefined ? derivedEyebrow : eyebrow

  return (
    // `.ptb`: 14px of pad, then the hairline, then 16px before the KPI row.
    // `pb-3.5` is 3.5 x the 4px `--spacing` token; `mb-panel` is the 16px
    // `--admin-size-panel-padding`.
    <div
      data-slot="page-top-bar"
      className="mb-panel flex flex-col gap-inline border-b border-line-light pb-3.5"
    >
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
      <div className="flex flex-wrap items-start justify-between gap-panel">
        <div className="min-w-0 flex-1">
          {/* ForMaps' page eyebrow: `text-[10px] uppercase tracking-[0.2em]
              font-bold` in the muted tone, on its own line above the title. A
              `<p>` rather than a `<span>` so it is a block without needing a
              utility to say so, and `m-0` because index.css gives every `p` a
              bottom margin that would push it off the heading it belongs to. */}
          {eyebrowText && (
            <p
              data-slot="page-eyebrow"
              className="m-0 text-2xs font-bold uppercase tracking-eyebrow text-fg-label"
            >
              {eyebrowText}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-inline">
            {/* No bottom margin: index.css gives every `h1` `margin-bottom: 8px`,
                which would double up with this container's `gap`. */}
            <h1 className="mb-0 min-w-0 break-words text-2xl">{title}</h1>
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
          {/* `max-w-measure` caps the line length at the design's 70ch. The
              shell's content panel has no width cap any more (see `AdminLayout`)
              because a table or a chart is better for the room — but prose is not,
              and measured across eleven viewports this line ran to 132 characters
              at 1280 and wider. The cap is on the text, where it belongs, rather
              than on the page around it. */}
          {description && (
            <p className="mb-0 max-w-measure break-words text-fg-secondary">{description}</p>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-inline">{actions}</div>}
      </div>
    </div>
  )
}

/**
 * The area the open page sits in, translated — or `null` where the nav does not
 * cover the route.
 *
 * Reads the JWT the same way `AdminLayout` and `SidebarUserMenu` do, rather than
 * taking role and company as props: the eyebrow has to be right on all 27 callers
 * without any of them being edited, and threading two claims through 27 call
 * sites is exactly the per-page duplication deriving it was meant to avoid.
 *
 * Needs a router, like the breadcrumbs above it already did — `useLocation`
 * throws outside one, so this adds no constraint the component did not have.
 * Returns `null` for a signed-out render (no token, so no sections) and for any
 * route the nav does not cover, which is the honest answer in both cases.
 */
function useSectionEyebrow(): string | null {
  const { t } = useTranslation()
  const { pathname } = useLocation()

  const token = getToken()
  const claims = token ? decodeJwtPayload(token) : null
  const role = typeof claims?.role === 'string' ? claims.role : undefined
  const companyId = typeof claims?.companyId === 'string' ? claims.companyId : undefined

  const titleKey = sectionTitleKeyForPath(pathname, buildNavSections(role, companyId))
  return titleKey ? t(titleKey) : null
}
