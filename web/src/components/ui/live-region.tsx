import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

/**
 * From `climate-project/src/components/ui/accessible-components.tsx` (`LiveRegion`
 * and `StatusMessage`, folded into one).
 *
 * Announces a change that has no visible focus change — a filter that reduced a
 * list, a background save that finished. `LoadingRegion` (#76) covers the loading
 * case specifically; this is the general one.
 */
export type LiveRegionProps = ComponentProps<'div'> & {
  /**
   * `polite` waits for a pause; `assertive` interrupts. Default polite — assertive
   * should be reserved for something the user must hear now.
   */
  politeness?: 'polite' | 'assertive'
  /** Render visibly as well as announcing. Off by default. */
  visible?: boolean
}

export function LiveRegion({
  politeness = 'polite',
  visible = false,
  className,
  ...props
}: LiveRegionProps) {
  return (
    <div
      data-slot="live-region"
      role={politeness === 'assertive' ? 'alert' : 'status'}
      aria-live={politeness}
      // Announce the region as a whole, so a partial update is not read as a
      // fragment.
      aria-atomic="true"
      className={cn(!visible && 'sr-only', className)}
      {...props}
    />
  )
}
