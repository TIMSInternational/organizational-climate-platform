import * as DialogPrimitive from '@radix-ui/react-dialog'
import { XIcon } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

/**
 * Ported from `climate-project/src/components/ui/dialog.tsx`.
 *
 * Radix handles focus trapping and restore-on-close, `Escape`, and the
 * `aria-modal` wiring. #76 calls that out as the most common place a port
 * silently regresses accessibility, so `dialog.test.tsx` asserts it here rather
 * than trusting the library.
 */
export function Dialog(props: ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

export function DialogTrigger(props: ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

export function DialogClose(props: ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

export function DialogPortal(props: ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

export function DialogOverlay({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-surface-overlay',
        'data-[state=open]:animate-fade-in',
        className,
      )}
      {...props}
    />
  )
}

/**
 * Either show the close button and supply its accessible name, or opt out.
 *
 * A union rather than an optional string, so it is a type error to render a close
 * button with no name — and there is no English default to leak into a Spanish
 * UI. Pass `t('common.close')`.
 */
export type DialogContentProps = ComponentProps<typeof DialogPrimitive.Content> &
  ({ showCloseButton?: true; closeLabel: string } | { showCloseButton: false; closeLabel?: never })

export function DialogContent({
  className,
  children,
  showCloseButton = true,
  closeLabel,
  ...props
}: DialogContentProps) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2',
          'gap-panel-gap rounded-xl border border-line-panel bg-surface-panel p-panel',
          'text-fg-primary shadow-lg',
          'data-[state=open]:animate-scale-in',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className={cn(
              'absolute top-3 right-3 flex size-control-sm items-center justify-center',
              'rounded-md border-transparent bg-transparent p-0 text-fg-tertiary',
              'hover:bg-state-hover hover:text-fg-primary',
            )}
          >
            <XIcon className="size-icon" />
            <span className="sr-only">{closeLabel}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

export function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('grid gap-1.5', className)}
      {...props}
    />
  )
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-col-reverse gap-inline sm:flex-row sm:justify-end', className)}
      {...props}
    />
  )
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-xl font-semibold leading-tight', className)}
      {...props}
    />
  )
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-sm text-fg-tertiary', className)}
      {...props}
    />
  )
}
