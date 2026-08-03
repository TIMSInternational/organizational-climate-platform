import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'
import { alertVariants, type AlertVariantProps } from './alertVariants'

export type AlertProps = ComponentProps<'div'> & AlertVariantProps

/**
 * An inline message.
 *
 * `role` is a prop rather than hardcoded: a `destructive` alert that reports a
 * failure the user just caused should be `role="alert"` so it is announced, but a
 * standing informational banner should not interrupt. Defaults to `status`, which
 * announces politely.
 */
export function Alert({ className, variant, role = 'status', ...props }: AlertProps) {
  return (
    <div
      data-slot="alert"
      role={role}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

export function AlertTitle({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn('col-start-2 font-medium leading-normal', className)}
      {...props}
    />
  )
}

export function AlertDescription({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn('col-start-2 grid gap-1 text-sm text-fg-secondary', className)}
      {...props}
    />
  )
}
