import * as LabelPrimitive from '@radix-ui/react-label'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

/**
 * Ported from `climate-project/src/components/ui/label.tsx`.
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
        'text-lg font-medium leading-none text-fg-secondary',
        'group-data-[disabled=true]/field:pointer-events-none group-data-[disabled=true]/field:opacity-50',
        'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
