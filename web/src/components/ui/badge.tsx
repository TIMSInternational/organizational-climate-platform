import { Slot } from '@radix-ui/react-slot'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'
import { badgeVariants, type BadgeVariantProps } from './badgeVariants'

export type BadgeProps = ComponentProps<'span'> &
  BadgeVariantProps & {
    /** Render the child element instead of a `<span>`, keeping the styling. */
    asChild?: boolean
  }

export function Badge({ className, variant, asChild = false, ...props }: BadgeProps) {
  const Component = asChild ? Slot : 'span'

  return (
    <Component
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

