import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router'
import { cn } from '../../lib/cn'
import { useTranslation } from '../../i18n'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '../ui'
import type { PageBreadcrumb } from './PageTopBar'

/**
 * The page header of the Apple design, as ONE component: breadcrumb, eyebrow, serif title,
 * sub, and the page's actions — the `.crumb` + `.hdr` pattern every board of 11 Nov draws
 * (Main, CompanyHome, TeamHome, Surveys, SurveyDetail, Results; `occ.css` "page header").
 *
 * ## The pattern
 *
 * - **Breadcrumb** (optional): 13px secondary ink, a chevron between crumbs, the current page
 *   last in the primary ink and semibold. 16px above the header block (the boards' 24px page
 *   gap pulled up 8px).
 * - **Eyebrow** (optional): 11px, uppercase, tracked .1em, semibold, in the label ink — the
 *   one size the type ruling lets go under 13px, and only for this.
 * - **Title**: the page's one `<h1>`, in the display serif at 30px (index.css sets the face,
 *   weight and tracking on every `h1`; `text-3xl` names the step).
 * - **Sub** (optional): 15px secondary ink, capped at the 70ch measure — the boards cap it at
 *   72ch; prose past that stops being read.
 * - **Actions**, trailing: `actions` for the secondary ones, then `primaryAction` — a SLOT for
 *   one primary, not a list. HIG `buttons.md` § Style: *"use a button that has a prominent
 *   visual style for the most likely action in a view"* and *"Presenting too many prominent
 *   buttons increases cognitive load"*; the product ruling is one blue button per header, and
 *   every board draws exactly one. The slot makes a second primary something a caller has to
 *   work around rather than something they drift into, and it is drawn last, at the trailing
 *   edge, where every board puts it.
 *
 * The block closes with the hairline and 18px of air above it, and sits 24px over whatever the
 * page draws next (`mb-section`), so a page needs no spacer of its own.
 *
 * ### Wrapping
 *
 * The text column has a real flex basis (`basis-header-text`, 20rem), not `flex-1`: a zero
 * basis means the two items always "fit", so `flex-wrap` never fires and the column is
 * squeezed to nothing beside the buttons (measured once at 1px wide at 320, `PageTopBar`'s
 * docstring). With the basis, the actions drop to their own line as soon as the column cannot
 * keep 320px. Actions align to the column's FOOT (`items-end`, the boards' `.hdr`), so on a
 * shared line they sit level with the sub rather than floating at the eyebrow.
 *
 * ## Relationship to `PageTopBar`
 *
 * `PageTopBar` is the header 113 pages render today, and feature tests pin its geometry
 * (`gap-9.5`, `gap-3.5`, its meta classes). It is left as it is so no page changes under
 * them; this is what a page adopts when its lane redesigns it. Unlike `PageTopBar` it derives
 * nothing from the nav: the boards' eyebrows are page facts ("Meridiano", "Resultados · 412
 * respuestas"), so a page passes its own or none.
 */
export interface PageHeaderProps {
  /** Already translated. Rendered as the page's one `<h1>`. */
  title: ReactNode
  /** Already translated. The 11px uppercase line over the title; omit for none. */
  eyebrow?: ReactNode
  /** Already translated. The supporting line under the title. */
  description?: ReactNode
  /** Trail, outermost first. The last entry renders as the current page, linked or not. */
  breadcrumbs?: PageBreadcrumb[]
  /** Accessible name for the breadcrumb `<nav>`. Defaults to `shell.breadcrumb`. */
  breadcrumbLabel?: string
  /** Beside the title on its line: a status chip, say. */
  titleAccessory?: ReactNode
  /** The secondary actions, in reading order — outline or plain buttons and links. */
  actions?: ReactNode
  /** The page's ONE primary action, drawn last. See the docstring. */
  primaryAction?: ReactNode
  /** A line of chips and facts under the sub (`canvas/PageMeta`). */
  meta?: ReactNode
  className?: string
}

export function PageHeader({
  title,
  eyebrow,
  description,
  breadcrumbs,
  breadcrumbLabel,
  titleAccessory,
  actions,
  primaryAction,
  meta,
  className,
}: PageHeaderProps) {
  const { t } = useTranslation()
  const hasActions = Boolean(actions) || Boolean(primaryAction)

  return (
    <div data-slot="page-header" className={cn('mb-section flex flex-col gap-4', className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <Breadcrumb aria-label={breadcrumbLabel ?? t('shell.breadcrumb')}>
          <BreadcrumbList className="gap-1.5 text-sm text-fg-secondary">
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1
              return (
                // The separator is a sibling `<li>`, not a child of the item: an `<li>`
                // nested in another breaks the list the AT walks.
                <Fragment key={`${crumb.label}-${index}`}>
                  {index > 0 && <BreadcrumbSeparator className="text-fg-tertiary" />}
                  <BreadcrumbItem>
                    {isLast ? (
                      <BreadcrumbPage className="font-semibold">{crumb.label}</BreadcrumbPage>
                    ) : crumb.href ? (
                      // `asChild` so the router owns the navigation: a bare `<a href>`
                      // full-page-reloads the SPA and drops the in-memory token.
                      <BreadcrumbLink asChild className="text-fg-secondary no-underline hover:text-fg-primary">
                        <Link to={crumb.href}>{crumb.label}</Link>
                      </BreadcrumbLink>
                    ) : (
                      <span data-slot="breadcrumb-ancestor">{crumb.label}</span>
                    )}
                  </BreadcrumbItem>
                </Fragment>
              )
            })}
          </BreadcrumbList>
        </Breadcrumb>
      )}

      <div className="flex flex-wrap items-end gap-4 border-b border-line-default pb-4.5">
        <div data-slot="page-header-text" className="flex min-w-0 grow basis-header-text flex-col gap-1.5">
          {eyebrow && (
            // A `<p>` so it is a block, and `m-0` because index.css gives every `p` a bottom
            // margin that would push it off the title it labels.
            <p data-slot="page-header-eyebrow" className="m-0 text-2xs font-semibold uppercase tracking-eyebrow text-fg-label">
              {eyebrow}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-inline">
            {/* `mb-0`: index.css gives every `h1` a bottom margin, which would double the gap. */}
            <h1 className="mb-0 min-w-0 break-words text-3xl">{title}</h1>
            {titleAccessory}
          </div>
          {description && (
            <p data-slot="page-header-description" className="mb-0 max-w-measure break-words text-base text-fg-secondary">
              {description}
            </p>
          )}
          {meta && (
            <div data-slot="page-header-meta" className="flex flex-wrap items-center gap-1.5 text-sm text-fg-secondary">
              {meta}
            </div>
          )}
        </div>
        {hasActions && (
          <div data-slot="page-header-actions" className="flex flex-wrap items-center gap-2">
            {actions}
            {primaryAction}
          </div>
        )}
      </div>
    </div>
  )
}
