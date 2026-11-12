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
        // The canvas's dialog scrim (ReportShare, 10 Sep): the ink at 45%, not the white
        // veil `bg-surface-overlay` paints — every dialog reads as the one thing on screen.
        'fixed inset-0 z-50 bg-surface-scrim',
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
          // The Apple design's `.sheet`: 560px wide, the sheet radius (16px), 22px by 24px of
          // padding and 16px between its parts, on the card ground with the large shadow — a
          // modal sheet is the one surface inside the frame that IS lifted. Eleven twelfths
          // wide on a phone, so it keeps a 16px gutter from each edge at 390px.
          'fixed top-1/2 left-1/2 z-50 grid w-11/12 max-w-140 -translate-x-1/2 -translate-y-1/2 sm:w-full',
          'gap-4 rounded-sheet border border-line-panel bg-surface-card px-6 py-5.5',
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
              // The canvas's `.ib`: a 32px icon button (44px under a finger).
              'absolute top-4 right-4 flex size-control-lg items-center justify-center pointer-coarse:size-11',
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
      // `.sheet .foot`: trailing, 8px apart. On a phone the actions stack with the primary on
      // top (HIG `alerts.md` § "Buttons": the default button "at the top in a stack").
      className={cn('flex flex-col-reverse gap-inline sm:flex-row sm:justify-end', className)}
      {...props}
    />
  )
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      // The card title: the title serif at 20px (the canvas's `.h`).
      className={cn('font-display text-2xl font-semibold leading-tight tracking-title', className)}
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
      // The body size in the secondary ink (the canvas's `.sub`): a dialog's description is
      // usually the consequence of the action, and it is read, not skimmed.
      className={cn('text-base text-fg-secondary', className)}
      {...props}
    />
  )
}
