import { Slot } from '@radix-ui/react-slot'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'
import { buttonVariants, type ButtonVariantProps } from './buttonVariants'

export type ButtonProps = ComponentProps<'button'> &
  ButtonVariantProps & {
    /** Render the child element instead of a `<button>`, keeping the styling. */
    asChild?: boolean
  }

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Component = asChild ? Slot : 'button'

  return (
    <Component
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

