import * as DialogPrimitive from '@radix-ui/react-dialog'
import { XIcon } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

/**
 * Ported from `climate-project/src/components/ui/sheet.tsx`.
 *
 * A Dialog anchored to an edge. Same Radix root, so it inherits the same focus
 * trap and Escape handling.
 */
export function Sheet(props: ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="sheet" {...props} />
}

export function SheetTrigger(props: ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

export function SheetClose(props: ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="sheet-close" {...props} />
}

export type SheetContentProps = ComponentProps<typeof DialogPrimitive.Content> & {
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** Accessible name for the close button. Pass `t('common.close')`. */
  closeLabel: string
}

export function SheetContent({
  className,
  children,
  side = 'right',
  closeLabel,
  ...props
}: SheetContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-slot="sheet-overlay"
        className="fixed inset-0 z-50 bg-surface-scrim data-[state=open]:animate-fade-in"
      />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          // `Dialog`'s sheet anchored to an edge: the same ground, padding and gap, and the
          // sheet radius on the two corners that face the page.
          'fixed z-50 flex flex-col gap-4 bg-surface-card px-6 py-5.5 text-fg-primary shadow-lg',
          'data-[state=open]:animate-slide-up',
          side === 'right' &&
            'inset-y-0 right-0 h-full w-3/4 rounded-l-sheet border-l border-line-panel sm:max-w-sm',
          side === 'left' &&
            'inset-y-0 left-0 h-full w-3/4 rounded-r-sheet border-r border-line-panel sm:max-w-sm',
          side === 'top' && 'inset-x-0 top-0 h-auto rounded-b-sheet border-b border-line-panel',
          side === 'bottom' && 'inset-x-0 bottom-0 h-auto rounded-t-sheet border-t border-line-panel',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className={cn(
            'absolute top-4 right-4 flex size-control-lg items-center justify-center pointer-coarse:size-11',
            'rounded-md border-transparent bg-transparent p-0 text-fg-tertiary',
            'hover:bg-state-hover hover:text-fg-primary',
          )}
        >
          <XIcon className="size-icon" />
          <span className="sr-only">{closeLabel}</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export function SheetHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="sheet-header" className={cn('grid gap-1.5', className)} {...props} />
}

export function SheetFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn('mt-auto flex flex-col gap-inline', className)}
      {...props}
    />
  )
}

export function SheetTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="sheet-title"
      className={cn('font-display text-2xl font-semibold leading-tight tracking-title', className)}
      {...props}
    />
  )
}

export function SheetDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-base text-fg-secondary', className)}
      {...props}
    />
  )
}
