import { Slot } from '@radix-ui/react-slot'
import { ChevronRightIcon, MoreHorizontalIcon } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

/**
 * Ported from `climate-project/src/components/ui/breadcrumb.tsx`.
 *
 * The legacy `accessible-components.tsx` also had an `AccessibleBreadcrumb`; this
 * is the one that survives, and it already carries what that one added — a labelled
 * `<nav>`, `aria-current="page"` on the last crumb, and `aria-hidden` separators.
 * `BreadcrumbEllipsis` needs a translated label from the caller, so it takes one.
 */
export function Breadcrumb({ ...props }: ComponentProps<'nav'>) {
  // `aria-label` is required rather than defaulted: "breadcrumb" is copy, and an
  // English default would be wrong in Spanish.
  return <nav data-slot="breadcrumb" {...props} />
}

export function BreadcrumbList({ className, ...props }: ComponentProps<'ol'>) {
  return (
    <ol
      data-slot="breadcrumb-list"
      // `m-0 list-none p-0`: `index.css` gives every `ol` an 8px bottom margin and a
      // 20px indent, which set the trail 20px in from the title under it and 10px
      // taller than its line. The artboards (10 Sep) draw it flush with the title, at
      // 13px — `text-base`, one line of 19.5px.
      className={cn(
        'm-0 flex list-none flex-wrap items-center gap-inline break-words p-0 text-base text-fg-tertiary',
        className,
      )}
      {...props}
    />
  )
}

export function BreadcrumbItem({ className, ...props }: ComponentProps<'li'>) {
  return (
    <li
      data-slot="breadcrumb-item"
      // `mb-0`: `index.css` gives every `li` a 4px bottom margin.
      className={cn('mb-0 inline-flex items-center gap-inline', className)}
      {...props}
    />
  )
}

export function BreadcrumbLink({
  className,
  asChild,
  ...props
}: ComponentProps<'a'> & { asChild?: boolean }) {
  const Component = asChild ? Slot : 'a'
  return (
    <Component
      data-slot="breadcrumb-link"
      className={cn('transition-colors hover:text-fg-primary', className)}
      {...props}
    />
  )
}

/** The current page. Not a link, and marked `aria-current`. */
export function BreadcrumbPage({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="breadcrumb-page"
      role="link"
      aria-disabled="true"
      aria-current="page"
      className={cn('font-medium text-fg-primary', className)}
      {...props}
    />
  )
}

export function BreadcrumbSeparator({ children, className, ...props }: ComponentProps<'li'>) {
  return (
    <li
      data-slot="breadcrumb-separator"
      role="presentation"
      aria-hidden="true"
      className={cn('mb-0 [&>svg]:size-3.5', className)}
      {...props}
    >
      {children ?? <ChevronRightIcon />}
    </li>
  )
}

export function BreadcrumbEllipsis({
  label,
  className,
  ...props
}: ComponentProps<'span'> & { label: string }) {
  return (
    <span
      data-slot="breadcrumb-ellipsis"
      role="presentation"
      className={cn('flex size-control-sm items-center justify-center', className)}
      {...props}
    >
      <MoreHorizontalIcon aria-hidden="true" className="size-icon" />
      <span className="sr-only">{label}</span>
    </span>
  )
}
