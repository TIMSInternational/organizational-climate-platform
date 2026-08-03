import { AlertTriangleIcon, InboxIcon, WifiOffIcon } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { Button } from './button'

/**
 * Ported from `climate-project/src/components/ui/error-handling.tsx`.
 *
 * #76 says this should integrate with the existing `RouteErrorBoundary` rather
 * than duplicate it, so the legacy `LoadingErrorBoundary` class is **not** ported:
 * `src/app/RouteErrorBoundary.tsx` is already the router's `errorElement` and is
 * where a thrown render error lands. What was worth taking is the *presentation* —
 * a consistent empty/error block — which `RouteErrorBoundary` can now render.
 *
 * The legacy `SuccessDisplay` is dropped too: a success message is a toast or an
 * `Alert`, and a third spelling of it would just be a third thing to keep in sync.
 *
 * `ValidationError` is dropped as well — field-level errors belong to `FormMessage`
 * (#75), which already wires `aria-invalid` and `aria-describedby`.
 */
export type ErrorStateProps = ComponentProps<'div'> & {
  title: string
  description?: string
  /** Rendered as the primary action. Pass a translated label. */
  action?: ReactNode
  icon?: ReactNode
  /** `alert` announces immediately; use it when the user just caused the failure. */
  role?: 'alert' | 'status'
}

export function ErrorState({
  title,
  description,
  action,
  icon,
  role = 'alert',
  className,
  ...props
}: ErrorStateProps) {
  return (
    <div
      data-slot="error-state"
      role={role}
      className={cn(
        'grid justify-items-center gap-panel-gap px-card py-section text-center',
        className,
      )}
      {...props}
    >
      <span aria-hidden="true" className="text-fg-tertiary">
        {icon ?? <AlertTriangleIcon className="size-6" />}
      </span>
      <div className="grid gap-1">
        <p className="text-lg font-medium text-fg-primary">{title}</p>
        {description && <p className="text-sm text-fg-secondary">{description}</p>}
      </div>
      {action}
    </div>
  )
}

export type NetworkErrorProps = Omit<ErrorStateProps, 'icon'> & {
  onRetry?: () => void
  retryText?: string
}

export function NetworkError({ onRetry, retryText, ...props }: NetworkErrorProps) {
  return (
    <ErrorState
      icon={<WifiOffIcon className="size-6" />}
      action={
        onRetry && retryText ? (
          <Button variant="outline" onClick={onRetry}>
            {retryText}
          </Button>
        ) : undefined
      }
      {...props}
    />
  )
}

/**
 * The "nothing here yet" block.
 *
 * `role="status"` rather than `alert`: an empty list is not an error, and
 * interrupting a screen reader to say so is wrong.
 */
export function EmptyState({ icon, ...props }: ErrorStateProps) {
  return <ErrorState role="status" icon={icon ?? <InboxIcon className="size-6" />} {...props} />
}
