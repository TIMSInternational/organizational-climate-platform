import * as ProgressPrimitive from '@radix-ui/react-progress'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

/**
 * Ported from `climate-project/src/components/ui/Progress.tsx`.
 *
 * The legacy version was hand-rolled from divs with no ARIA at all — no
 * `role="progressbar"`, no `aria-valuenow` — so a screen reader saw a coloured
 * box. Rebuilt on `@radix-ui/react-progress`, which supplies all of it; that is a
 * change from the legacy implementation but not from its intended behaviour.
 *
 * `value` is 0–100. Pass `null` for indeterminate.
 *
 * At 0 (and indeterminate) the indicator is hidden, not merely translated out: a
 * `translateX(-100%)` indicator inside a rounded, clipped track left an antialiased
 * sliver of fill at the track's left end (sampled (207,208,239) on the microclimate
 * live bar at 2x, 11 Sep), where every artboard draws an empty track flat.
 */
export type ProgressProps = ComponentProps<typeof ProgressPrimitive.Root> & {
  /**
   * Overrides the fill colour of the bar itself.
   *
   * The indicator is an inner element, so `className` (which lands on the root)
   * cannot reach it. Added for `charts/ParticipationTracker`, which colours the
   * bar by status band — good/warning/critical — rather than always blue. The
   * alternative was an arbitrary-variant selector
   * (`[&>[data-slot=progress-indicator]]:bg-accent-green`) at every call site,
   * which is both harder to read and easy to get subtly wrong.
   */
  indicatorClassName?: string
}

export function Progress({ className, indicatorClassName, value, ...props }: ProgressProps) {
  const empty = (value ?? 0) <= 0
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={cn(
        'relative h-1.5 w-full overflow-hidden rounded-full bg-surface-icon-box',
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          'size-full flex-1 bg-accent-blue transition-transform ease-out',
          indicatorClassName,
          empty && 'invisible',
        )}
        style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}
