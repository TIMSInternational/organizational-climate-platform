import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'
import { buttonVariants } from './buttonVariants'

/**
 * Ported from `climate-project/src/components/ui/alert-dialog.tsx`.
 *
 * Differs from `Dialog` on purpose: there is no close button and no
 * backdrop-click dismissal, because an alert dialog must be answered. Radix
 * enforces that; `alert-dialog.test.tsx` asserts it, since "backdrop click
 * closes" is the behaviour a port tends to copy across by accident.
 */
export function AlertDialog(props: ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

export function AlertDialogTrigger(
  props: ComponentProps<typeof AlertDialogPrimitive.Trigger>,
) {
  return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
}

export function AlertDialogContent({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay
        data-slot="alert-dialog-overlay"
        className="fixed inset-0 z-50 bg-surface-overlay data-[state=open]:animate-fade-in"
      />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2',
          'gap-panel-gap rounded-xl border border-line-panel bg-surface-panel p-panel',
          'text-fg-primary shadow-lg',
          'data-[state=open]:animate-scale-in',
          className,
        )}
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  )
}

export function AlertDialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="alert-dialog-header" className={cn('grid gap-1.5', className)} {...props} />
}

export function AlertDialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn('flex flex-col-reverse gap-inline sm:flex-row sm:justify-end', className)}
      {...props}
    />
  )
}

export function AlertDialogTitle({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn('text-xl font-semibold leading-tight', className)}
      {...props}
    />
  )
}

export function AlertDialogDescription({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn('text-sm text-fg-tertiary', className)}
      {...props}
    />
  )
}

export function AlertDialogAction({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Action>) {
  return (
    <AlertDialogPrimitive.Action
      className={cn(buttonVariants({ variant: 'primary' }), className)}
      {...props}
    />
  )
}

export function AlertDialogCancel({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  return (
    <AlertDialogPrimitive.Cancel
      className={cn(buttonVariants({ variant: 'outline' }), className)}
      {...props}
    />
  )
}
