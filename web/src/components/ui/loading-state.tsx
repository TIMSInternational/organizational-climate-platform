import type { ComponentProps } from 'react'
import { useTranslation } from '../../i18n'
import { cn } from '../../lib/cn'
import { Skeleton } from './skeleton'

/**
 * The loading state of a region: placeholder rows in the shape of what is coming, and one
 * polite announcement for assistive technology.
 *
 * HIG `loading.md` § "Best practices": "Show something as soon as possible … consider
 * showing placeholder text, graphics, or animations as content loads, replacing these
 * elements as content becomes available." So this draws skeleton rows (the canvas's `.sk`),
 * not a spinner in an empty box. The rows are decoration (`Skeleton` is `aria-hidden`); what
 * a screen reader hears is the `role="status"` word, "Cargando…" from the catalogue
 * (`ui.state.loading`) unless the caller names what is loading.
 *
 * For content that is being REFRESHED in place, use `LoadingRegion` (it keeps the old content
 * mounted and marks it `aria-busy`); this is for content that is not there yet.
 */
export type LoadingStateProps = Omit<ComponentProps<'div'>, 'children'> & {
  /** What is loading. **Already translated.** Defaults to "Cargando…". */
  label?: string
  /** How many placeholder rows. Defaults to 3. */
  rows?: number
}

export function LoadingState({ label, rows = 3, className, ...props }: LoadingStateProps) {
  const { t } = useTranslation()
  const count = Math.max(1, Math.floor(rows))
  return (
    <div
      data-slot="loading-state"
      role="status"
      aria-live="polite"
      className={cn('grid gap-3', className)}
      {...props}
    >
      <span className="sr-only">{label ?? t('ui.state.loading')}</span>
      {Array.from({ length: count }, (_, index) => (
        // Full rows with the last one short, so the block reads as a list of things rather
        // than as one bar.
        <Skeleton key={index} className={cn('h-4', index === count - 1 && count > 1 && 'w-2/3')} />
      ))}
    </div>
  )
}
