import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/cn'

/**
 * Ported from `climate-project/src/components/ui/alert.tsx`.
 *
 * A panel hairline on a card or neutral fill; the glyph, not the box, says what kind
 * of message it is.
 *
 * Apple design ruling (11 Nov): one colour = one meaning. Green, amber and red are the
 * three result areas (Fortaleza, Oportunidad, Crítica) and nothing else, so a success,
 * a warning or an error no longer paints its whole box in a result area's tint — a pink
 * error panel read as «Crítica». A success is the plain card with its tick; a warning
 * and an error sit on the neutral fill, as a Note does. The error keeps one red mark —
 * its icon in the red ink, the ink destructive actions already use — so a failure is
 * still told from a warning at a glance, with the words carrying the message (WCAG 1.4.1).
 * `info` stays blue: it is the live/selection hue.
 */
export const alertVariants = cva(
  cn(
    'relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-xl border px-card py-3',
    'text-lg has-[>svg]:grid-cols-[calc(var(--spacing-icon))_1fr] has-[>svg]:gap-x-3',
    '[&>svg]:size-icon [&>svg]:translate-y-0.5',
  ),
  {
    variants: {
      variant: {
        default: 'border-line-panel bg-surface-card text-fg-primary',
        info: 'border-accent-blue-ring bg-accent-blue-soft text-fg-primary [&>svg]:text-accent-blue',
        success: 'border-line-panel bg-surface-card text-fg-primary [&>svg]:text-fg-secondary',
        warning: 'border-line-panel bg-surface-fill-subtle text-fg-primary [&>svg]:text-fg-secondary',
        destructive: 'border-line-panel bg-surface-fill-subtle text-fg-primary [&>svg]:text-accent-red-ink',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export type AlertVariantProps = VariantProps<typeof alertVariants>
