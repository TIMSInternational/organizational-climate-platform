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
 */
export type ProgressProps = ComponentProps<typeof ProgressPrimitive.Root>

export function Progress({ className, value, ...props }: ProgressProps) {
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
        className="size-full flex-1 bg-accent-blue transition-transform ease-out"
        style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}
