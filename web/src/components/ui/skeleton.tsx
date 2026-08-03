import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

/**
 * Ported from `climate-project/src/components/ui/skeleton.tsx`.
 *
 * The legacy file was 354 lines: a framer-motion shimmer plus a dozen composed
 * presets (card, table, form, dashboard…). Those presets encoded the *legacy*
 * page layouts, which is exactly what this migration is replacing, so porting
 * them would ship dead shapes. What survives is the primitive plus `SkeletonText`,
 * the one preset that is layout-independent.
 *
 * `animate-pulse` replaces the framer-motion shimmer — Tailwind's own utility,
 * and index.css already zeroes animations under `prefers-reduced-motion`.
 */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      // Decorative: a screen reader should hear the loading state from the
      // region's own aria-busy, not from a stack of empty boxes.
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-surface-icon-box', className)}
      {...props}
    />
  )
}

/** Placeholder lines, with the last one short so it reads as a paragraph. */
export function SkeletonText({
  lines = 3,
  className,
  ...props
}: ComponentProps<'div'> & { lines?: number }) {
  return (
    <div
      data-slot="skeleton-text"
      aria-hidden="true"
      className={cn('grid gap-2', className)}
      {...props}
    >
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          className={cn('h-3', index === lines - 1 && lines > 1 && 'w-3/5')}
        />
      ))}
    </div>
  )
}
