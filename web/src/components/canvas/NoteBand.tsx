import type { ReactNode } from 'react'
import { Shield } from 'lucide-react'
import { cn } from '../../lib/cn'

/**
 * The lavender band that closes a column — "Registra avance la administración…", "Cada
 * cifra de un pulso se calcula sobre la sesión entera…": the icon-box fill, 12px secondary
 * ink, a 14px glyph (the shield by default) on the first line.
 *
 * Not an `Alert`: an alert announces something that happened, and this is a standing
 * rule of the page. It is a paragraph, so a screen reader reads it in place.
 */
export function NoteBand({
  children,
  icon,
  roomy = false,
  className,
}: {
  children: ReactNode
  /** A lucide glyph; the shield when omitted. Decorative — the sentence carries the meaning. */
  icon?: ReactNode
  /** Detalle de plan's band: 8px radius and 14px 16px padding instead of 6px and 12px 14px. */
  roomy?: boolean
  className?: string
}) {
  return (
    <p
      className={cn(
        'm-0 flex items-start gap-2.5 bg-surface-icon-box text-sm leading-normal text-fg-secondary',
        roomy ? 'rounded-xl px-4 py-3.5' : 'rounded-lg px-3.5 py-3',
        className,
      )}
    >
      <span aria-hidden="true" className="mt-0.5 inline-flex shrink-0 [&_svg]:size-3.5">
        {icon ?? <Shield />}
      </span>
      <span className="min-w-0">{children}</span>
    </p>
  )
}
