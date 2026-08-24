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
 *
 * ## Why `p-0` is load-bearing
 *
 * Being a `<button>`, this box DOES pick up the bare-button rule in `index.css`
 * `@layer base`, which sets `padding: 0 var(--admin-space-12)`. Under
 * `box-sizing: border-box` a specified width narrower than its own padding does not
 * win: the used border-box width is padding + border, so `size-3.5` rendered a
 * **26x14 rectangle** on every screen in the product until #115 photographed one.
 * Nothing caught it — `size-3.5` is present in the class list, the class compiles,
 * and Vitest runs on happy-dom, which has no layout engine to measure with.
 */
export type CheckboxProps = ComponentProps<typeof CheckboxPrimitive.Root>

export function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer size-3.5 shrink-0 p-0 rounded-sm border border-line-default bg-surface-input',
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
