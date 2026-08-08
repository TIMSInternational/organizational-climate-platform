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
  /**
   * Set when this block *is* the page, rather than sitting inside a panel beside
   * other content.
   *
   * The shell's card is `min-h-full` — deliberately, because a short page used to
   * render as a stub stranded at the top of a large grey field. The cost is that a
   * page whose only content is "nothing here yet" leaves the rest of the card
   * empty: measured across eleven viewports, between 400px and 1100px of dead
   * space, and it is the whole of what a large screen shows. Filling reserves a
   * viewport-relative block and centres the message in it, so the copy sits in the
   * space instead of clinging to the heading.
   *
   * **Opt-in on purpose.** Twenty of the twenty-seven call sites are inline — the
   * word-cloud panel, a question list, a progress form — where half the viewport
   * of centred whitespace inside a small card would be far worse than the gap it
   * fixes. Only a page's primary empty state should set it.
   */
  fill?: boolean
}

export function ErrorState({
  title,
  description,
  action,
  icon,
  role = 'alert',
  fill = false,
  className,
  // Destructured out rather than read off `props`: spreading `{...props}` after a
  // `style=` attribute puts the caller's `style` back on top and silently drops
  // the fill height. Merged explicitly instead, caller last so they can still win.
  style,
  ...props
}: ErrorStateProps) {
  return (
    <div
      data-slot="error-state"
      data-fill={fill || undefined}
      role={role}
      className={cn(
        'grid justify-items-center gap-panel-gap px-card py-section text-center',
        // `content-center` is what actually centres it; the min-height is what
        // gives it something to be centred in. Viewport-relative rather than a
        // fixed number so it tracks the screen it is compensating for — half of a
        // 1440px-tall monitor, half of a 768px laptop.
        fill && 'content-center',
        className,
      )}
      style={fill ? { minHeight: 'var(--admin-size-empty-fill)', ...style } : style}
      {...props}
    >
      <span aria-hidden="true" className="text-fg-tertiary">
        {icon ?? <AlertTriangleIcon className="size-6" />}
      </span>
      {/* `max-w-prose` and `justify-self-center`: the shell's panel fills the
          viewport now, so without a cap this copy ran the full width of the card —
          132 characters per line on a 1280px panel, against a readable maximum of
          about 70. `grid` alone would stretch the block; the cap needs the
          centring to stay centred once it stops stretching. */}
      <div className="grid max-w-prose justify-self-center gap-1">
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
