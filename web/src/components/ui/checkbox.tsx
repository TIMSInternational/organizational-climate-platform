import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { CheckIcon } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

/**
 * Ported from `climate-project/src/components/ui/checkbox.tsx`.
 *
 * Radix renders a `<button role="checkbox">`, not an `<input>`, so the
 * `input[type='checkbox']` rule in index.css does not reach it — the box is sized
 * here. 14px matches that rule's `--admin-size-checkbox`-equivalent inline sizing.
 */
export type CheckboxProps = ComponentProps<typeof CheckboxPrimitive.Root>

export function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer size-3.5 shrink-0 rounded-sm border border-line-default bg-surface-input',
        'transition-[background-color,border-color] ease-out',
        'hover:not-disabled:border-line-hover',
        'data-[state=checked]:border-accent-blue data-[state=checked]:bg-accent-blue',
        'data-[state=indeterminate]:border-accent-blue data-[state=indeterminate]:bg-accent-blue',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-accent-red',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-fg-on-accent"
      >
        <CheckIcon className="size-3" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}
