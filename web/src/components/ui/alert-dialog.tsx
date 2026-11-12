import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'
import { buttonVariants, type ButtonVariantProps } from './buttonVariants'

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
        // The scrim, as `Dialog`'s: an alert must read as the one thing on screen, and the
        // white veil it used (`bg-surface-overlay`) left the page competing with it.
        className="fixed inset-0 z-50 bg-surface-scrim data-[state=open]:animate-fade-in"
      />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        className={cn(
          // `Dialog`'s sheet, narrower: an alert carries a sentence and two buttons.
          'fixed top-1/2 left-1/2 z-50 grid w-11/12 max-w-120 -translate-x-1/2 -translate-y-1/2 sm:w-full',
          'gap-4 rounded-sheet border border-line-panel bg-surface-card px-6 py-5.5',
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
      className={cn('font-display text-2xl font-semibold leading-tight tracking-title', className)}
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
      className={cn('text-base text-fg-secondary', className)}
      {...props}
    />
  )
}

/**
 * The answering action. `primary` by default; pass `variant="destructive"` when the action
 * destroys something — HIG `buttons.md` § "Role": "Don't assign the primary role to a button
 * that performs a destructive action, even if that action is the most likely choice."
 */
export function AlertDialogAction({
  className,
  variant = 'primary',
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Action> & Pick<ButtonVariantProps, 'variant'>) {
  return (
    <AlertDialogPrimitive.Action
      data-slot="alert-dialog-action"
      data-variant={variant}
      className={cn(buttonVariants({ variant }), className)}
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
      data-slot="alert-dialog-cancel"
      className={cn(buttonVariants({ variant: 'outline' }), className)}
      {...props}
    />
  )
}
