import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

/** Ported from `climate-project/src/components/ui/radio-group.tsx`. */
export function RadioGroup({
  className,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn('grid gap-row', className)}
      {...props}
    />
  )
}

export function RadioGroupItem({
  className,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        'aspect-square size-3.5 shrink-0 rounded-full border border-line-default bg-surface-input',
        'transition-[background-color,border-color] ease-out',
        'hover:not-disabled:border-line-hover',
        'data-[state=checked]:border-accent-blue',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-accent-red',
        className,
      )}
      {...props}
    >
      {/* A filled dot rather than the legacy lucide `Circle` icon: an icon inside
          a 14px control renders as a smudge, and a dot needs no glyph. */}
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="flex items-center justify-center"
      >
        <span className="block size-1.5 rounded-full bg-accent-blue" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  )
}
