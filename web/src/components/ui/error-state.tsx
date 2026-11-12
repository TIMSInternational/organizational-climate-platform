import { AlertTriangleIcon, InboxIcon } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { useTranslation } from '../../i18n'
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
  /**
   * The recovery action, when the failure can be retried: renders a bordered button that
   * calls this. Ignored when `action` is given — that is the caller's own action.
   *
   * HIG `feedback.md` § "Best practices": "Show people when a command can't be carried out
   * and help them understand why" — and, when it can be tried again, give them the way to.
   */
  onRetry?: () => void
  /**
   * The retry button's word. **Already translated.** Defaults to the catalogue's
   * `ui.state.retry` ("Reintentar"), so a retry is never an untranslated English default.
   */
  retryLabel?: string
}

/** The catalogue's retry word — a component, so `useTranslation` runs only when it renders. */
function DefaultRetryLabel() {
  const { t } = useTranslation()
  return <>{t('ui.state.retry')}</>
}

export function ErrorState({
  title,
  description,
  action,
  icon,
  role = 'alert',
  fill = false,
  onRetry,
  retryLabel,
  className,
  // Destructured out rather than read off `props`: spreading `{...props}` after a
  // `style=` attribute puts the caller's `style` back on top and silently drops
  // the fill height. Merged explicitly instead, caller last so they can still win.
  style,
  ...props
}: ErrorStateProps) {
  const failure = role === 'alert'
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
      {/* An error's icon and title wear the red TEXT ink — the one red mark a failure keeps
          (Apple design ruling, 11 Nov: the box is neutral, only the words and the icon are red;
          `alertVariants.ts` draws the inline alert the same way). An empty state is not a
          failure: `role="status"` keeps the quiet tertiary icon and the primary title. */}
      <span aria-hidden="true" className={failure ? 'text-accent-red-ink' : 'text-fg-tertiary'}>
        {icon ?? <AlertTriangleIcon className="size-6" />}
      </span>
      {/* `max-w-prose` and `justify-self-center`: the shell's panel fills the
          viewport now, so without a cap this copy ran the full width of the card —
          132 characters per line on a 1280px panel, against a readable maximum of
          about 70. `grid` alone would stretch the block; the cap needs the
          centring to stay centred once it stops stretching. */}
      <div className="grid max-w-prose justify-self-center gap-1">
        {/* 17px semibold over 15px secondary: a heading one step over the body and the
            body itself, the Apple design's `h3` over `.sub`. */}
        <p className={cn('m-0 text-xl font-semibold', failure ? 'text-accent-red-ink' : 'text-fg-primary')}>{title}</p>
        {description && <p className="m-0 text-base text-fg-secondary">{description}</p>}
      </div>
      {action ??
        (onRetry && (
          <Button type="button" onClick={onRetry}>
            {retryLabel ?? <DefaultRetryLabel />}
          </Button>
        ))}
    </div>
  )
}

export type NetworkErrorProps = Omit<ErrorStateProps, 'icon'> & {
  onRetry?: () => void
  retryText?: string
}

/**
 * A screen that could not load its data, with a way to try again.
 *
 * It drew a Wi-Fi-off glyph until 12 Nov. Most of its callers are not offline at all: the
 * survey list's 404 printed «No se encontró lo que busca» under a crossed-out Wi-Fi icon,
 * so the icon, the title and the body named three different failures (review 12 Nov). The
 * caller's `description` says the cause, so the glyph is the failure's own triangle and the
 * name is kept only so the twenty callers did not have to move.
 */
export function NetworkError({ onRetry, retryText, ...props }: NetworkErrorProps) {
  return (
    <ErrorState
      action={
        onRetry && retryText ? (
          <Button type="button" variant="outline" onClick={onRetry}>
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
