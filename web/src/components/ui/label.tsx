import * as LabelPrimitive from '@radix-ui/react-label'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

/**
 * Ported from `climate-project/src/components/ui/label.tsx`, set as the Apple design's field
 * label (`occ.css` `.field > label`, `.lbl`): 13px semibold in the primary ink, so a field's
 * name reads as its title. A label set BESIDE a checkbox or a switch reads as body text
 * instead — `FormField` passes `text-base font-normal` for those rows.
 *
 * The element rule in index.css makes a bare `<label>` a full form row —
 * `display: block` with a 12px bottom margin — because the existing pages write
 * `<label>Text <input/></label>`. This primitive is the other shape: an inline
 * label sitting *beside* its control, so it overrides to `inline-flex` and drops
 * the row margin. Wrap it in `FormItem` when you want the stacked row.
 */
export type LabelProps = ComponentProps<typeof LabelPrimitive.Root>

export function Label({ className, ...props }: LabelProps) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        'inline-flex items-center gap-inline mb-0 select-none',
        'text-sm font-semibold leading-snug text-fg-primary',
        'group-data-[disabled=true]/field:pointer-events-none group-data-[disabled=true]/field:opacity-50',
        'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
