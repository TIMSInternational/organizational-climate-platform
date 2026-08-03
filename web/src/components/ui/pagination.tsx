/**
 * Ported from `climate-project/src/components/ui/pagination.tsx`.
 *
 * All copy is passed in — the legacy version hardcoded "Previous", "Next" and
 * "More pages". The page-window calculation lives in `usePagination.ts`.
 */
import { ChevronLeftIcon, ChevronRightIcon, MoreHorizontalIcon } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'
import { buttonVariants } from './buttonVariants'

export function Pagination({ className, ...props }: ComponentProps<'nav'>) {
  // `aria-label` is the caller's, for the same reason as Breadcrumb.
  return (
    <nav
      data-slot="pagination"
      className={cn('flex w-full justify-center', className)}
      {...props}
    />
  )
}

export function PaginationContent({ className, ...props }: ComponentProps<'ul'>) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn('flex flex-row items-center gap-1', className)}
      {...props}
    />
  )
}

export function PaginationItem(props: ComponentProps<'li'>) {
  return <li data-slot="pagination-item" {...props} />
}

export function PaginationLink({
  className,
  isActive,
  ...props
}: ComponentProps<'button'> & { isActive?: boolean }) {
  return (
    <button
      type="button"
      data-slot="pagination-link"
      // The active page is announced as current, not just coloured.
      aria-current={isActive ? 'page' : undefined}
      data-active={isActive || undefined}
      className={cn(
        buttonVariants({ variant: isActive ? 'primary' : 'ghost', size: 'sm' }),
        'min-w-control-md',
        className,
      )}
      {...props}
    />
  )
}

export function PaginationPrevious({
  label,
  className,
  ...props
}: ComponentProps<'button'> & { label: string }) {
  return (
    <button
      type="button"
      data-slot="pagination-previous"
      aria-label={label}
      className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), className)}
      {...props}
    >
      <ChevronLeftIcon aria-hidden="true" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

export function PaginationNext({
  label,
  className,
  ...props
}: ComponentProps<'button'> & { label: string }) {
  return (
    <button
      type="button"
      data-slot="pagination-next"
      aria-label={label}
      className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), className)}
      {...props}
    >
      <span className="hidden sm:inline">{label}</span>
      <ChevronRightIcon aria-hidden="true" />
    </button>
  )
}

export function PaginationEllipsis({
  label,
  className,
  ...props
}: ComponentProps<'span'> & { label: string }) {
  return (
    <span
      data-slot="pagination-ellipsis"
      aria-hidden="true"
      className={cn('flex size-control-md items-center justify-center text-fg-tertiary', className)}
      {...props}
    >
      <MoreHorizontalIcon className="size-icon" />
      <span className="sr-only">{label}</span>
    </span>
  )
}
