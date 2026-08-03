import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './alert-dialog'
import { Spinner } from './spinner'
import { cn } from '../../lib/cn'

/**
 * Ported from `climate-project/src/components/ui/confirmation-dialog.tsx`.
 *
 * The legacy props are kept as-is, so a ported call site needs no rewriting —
 * `confirmText`/`cancelText` rather than the `*Label` this codebase would
 * otherwise favour.
 *
 * Copy is passed in, never defaulted: a default English "Confirm" would be an
 * untranslated string inside a primitive, which is the failure #78 exists to
 * prevent.
 */
export interface ConfirmationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmText: string
  cancelText: string
  variant?: 'default' | 'destructive'
  onConfirm: () => void | Promise<void>
  /** Force the pending state from outside; otherwise it is tracked internally. */
  loading?: boolean
}

export function ConfirmationDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText,
  cancelText,
  variant = 'default',
  onConfirm,
  loading,
}: ConfirmationDialogProps) {
  const [pending, setPending] = useState(false)
  const busy = loading ?? pending

  async function handleConfirm() {
    // The legacy version closed the dialog immediately and let the caller's
    // promise settle unobserved, so a failed confirm looked like a success. Stay
    // open until it resolves, and stay open on rejection so the caller can
    // surface the error.
    setPending(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } catch {
      // Swallowed on purpose, and only to avoid an unhandled rejection: the
      // caller owns `onConfirm`, so reporting the failure is theirs to do, next
      // to whatever state they set. What this component owes them is to stay
      // open so there is somewhere for that message to appear.
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{cancelText}</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            className={cn(
              variant === 'destructive' && 'bg-accent-red text-fg-on-accent',
            )}
            // Radix closes on Action click by default; the async flow above owns
            // closing instead.
            onClick={(event) => {
              event.preventDefault()
              void handleConfirm()
            }}
          >
            {busy && <Spinner size="sm" className="text-fg-on-accent" />}
            {confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
