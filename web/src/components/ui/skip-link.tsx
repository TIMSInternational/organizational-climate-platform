import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

/**
 * From `climate-project/src/components/ui/accessible-components.tsx`.
 *
 * Only `SkipLink` and `LiveRegion` are taken from that file. The rest of it was
 * superseded by batch 2: `AccessibleModal` by `Dialog`, `ProgressBar` by `Progress`,
 * `AccessibleLoadingSpinner` by `Spinner`/`LoadingRegion`, `AccessibleBreadcrumb` by
 * `Breadcrumb`. Porting them too would leave two spellings of each.
 *
 * Visually hidden until focused — the standard pattern, so it costs sighted users
 * nothing and gives keyboard users a way past the sidebar.
 */
export function SkipLink({
  href = '#main',
  className,
  ...props
}: ComponentProps<'a'>) {
  return (
    <a
      data-slot="skip-link"
      href={href}
      className={cn(
        'sr-only',
        'focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50',
        'focus:rounded-md focus:bg-surface-panel focus:px-3 focus:py-2',
        'focus:text-base focus:font-medium focus:text-fg-primary focus:shadow-lg',
        className,
      )}
      {...props}
    />
  )
}
