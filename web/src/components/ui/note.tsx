import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../../lib/cn'

/**
 * A standing note inside the content box: the Apple design's `.note` — an icon and a short
 * paragraph on a quiet fill, 14px, the card radius, 14px by 16px of padding.
 *
 * Not `Alert`. An alert reports something that just happened (a failure, a success) and is
 * announced; a note states a standing fact about the screen ("Un departamento solo se muestra
 * a la administración desde 1 respuesta") and is read in place, so it has no live role.
 *
 * ## Two tones, not three
 *
 * `neutral` is the 7% grey fill (`--admin-bg-fill-subtle`); `info` is the blue tint
 * (`--admin-accent-bg-blue`), for a note about how the screen behaves. The canvas also draws a
 * `.note.warn` on the Oportunidad amber; it is deliberately not offered. Amber, green and red
 * are the three result areas and nothing else (the user's ruling of 11 Nov), and a warning
 * drawn in the Oportunidad colour reads as a result.
 *
 * Measured: the body is the primary ink — 14.65:1 on the blue tint over the card in light,
 * 11.21:1 in dark; on the grey fill the secondary ink would still be 8.37:1 / 8.33:1. The icon
 * is a graphic, in the tertiary ink (neutral) or the identity blue (info).
 */
export type NoteProps = ComponentProps<'div'> & {
  /** A glyph before the text. Decorative: rendered `aria-hidden`. */
  icon?: ReactNode
  tone?: 'neutral' | 'info'
}

export function Note({ icon, tone = 'neutral', className, children, ...props }: NoteProps) {
  return (
    <div
      data-slot="note"
      data-tone={tone}
      className={cn(
        'flex items-start gap-3 rounded-xl px-4 py-3.5 text-ui leading-normal text-fg-primary',
        tone === 'info' ? 'bg-accent-blue-soft' : 'bg-surface-fill-subtle',
        className,
      )}
      {...props}
    >
      {icon && (
        <span
          aria-hidden="true"
          className={cn(
            'mt-0.5 inline-flex shrink-0 [&>svg]:size-4',
            tone === 'info' ? 'text-accent-blue' : 'text-fg-tertiary',
          )}
        >
          {icon}
        </span>
      )}
      <div className="min-w-0">{children}</div>
    </div>
  )
}
