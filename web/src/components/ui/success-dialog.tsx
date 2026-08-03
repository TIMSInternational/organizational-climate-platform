import { CheckIcon } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog'
import { Button } from './button'

/**
 * Ported from `climate-project/src/components/ui/success-dialog.tsx`.
 *
 * Copy is passed in rather than defaulted, for the same reason as
 * `ConfirmationDialog`.
 */
export interface SuccessDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  dismissText: string
}

export function SuccessDialog({
  open,
  onOpenChange,
  title,
  description,
  dismissText,
}: SuccessDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <div
            aria-hidden="true"
            className="flex size-icon-box items-center justify-center rounded-full bg-accent-green-soft"
          >
            <CheckIcon className="size-icon text-accent-green" />
          </div>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="primary" onClick={() => onOpenChange(false)}>
            {dismissText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
