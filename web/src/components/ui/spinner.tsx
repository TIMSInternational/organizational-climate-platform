import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

/**
 * Ported from `climate-project/src/components/ui/LoadingSpinner.tsx` and the
 * `Loading` family in `Loading.tsx`.
 *
 * The legacy pair was 286 lines and framer-motion-driven: a rotating SVG, plus
 * `LoadingOverlay`, `LoadingButton`, `LoadingCard`, `LoadingTable` and a
 * `LoadingDots`. Most of that is composition a caller can do in a line, and the
 * framer-motion rotation is a CSS `animate-spin`.
 *
 * Kept: the spinner itself, and `LoadingRegion` — the one piece that carries real
 * behaviour rather than layout, because it is where `aria-busy` and the polite
 * live-region announcement belong. Dropped: `LoadingButton` (Button already has
 * `disabled`, and a caller composes the spinner as a child), `LoadingCard` and
 * `LoadingTable` (legacy page shapes — use `Skeleton`), `LoadingDots` (decoration).
 */
const SIZES = {
  sm: 'size-3',
  md: 'size-icon',
  lg: 'size-6',
} as const

export type SpinnerProps = ComponentProps<'svg'> & {
  size?: keyof typeof SIZES
}

export function Spinner({ size = 'md', className, ...props }: SpinnerProps) {
  return (
    <svg
      data-slot="spinner"
      // Decorative on its own; the loading state is announced by LoadingRegion or
      // by the caller's own live region.
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      className={cn('animate-spin text-fg-tertiary', SIZES[size], className)}
      {...props}
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}

export type LoadingRegionProps = ComponentProps<'div'> & {
  loading: boolean
  /** Announced politely while loading. Pass a translated string. */
  label: string
}

/**
 * Wraps content that is being replaced by fresh data.
 *
 * Marks the region `aria-busy` while loading and announces `label` once, rather
 * than leaving a screen reader to infer the state from a spinner it cannot see.
 */
export function LoadingRegion({
  loading,
  label,
  className,
  children,
  ...props
}: LoadingRegionProps) {
  return (
    <div
      data-slot="loading-region"
      aria-busy={loading || undefined}
      className={cn('relative', className)}
      {...props}
    >
      <span role="status" aria-live="polite" className="sr-only">
        {loading ? label : ''}
      </span>
      {children}
    </div>
  )
}
