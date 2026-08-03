import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/cn'

/**
 * Ported from `climate-project/src/components/ui/badge.tsx`.
 *
 * The legacy variants were solid saturated fills (`bg-green-500 text-white`).
 * Here they use the token layer's *soft* accent fills with a matching hairline —
 * `--admin-accent-bg-*` over `--admin-accent-border-*` — which is what the legacy
 * admin status pills actually looked like, and what keeps a badge legible in both
 * themes. `destructive` keeps a solid fill, since a destructive badge is meant to
 * shout.
 */
export const badgeVariants = cva(
  cn(
    'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap',
    'rounded-lg border px-1.5 py-0.5 text-xs font-medium',
    'transition-[color,background-color,border-color] ease-out',
    '[&>svg]:pointer-events-none [&>svg]:size-3',
  ),
  {
    variants: {
      variant: {
        default: 'border-accent-blue-ring bg-accent-blue-soft text-accent-blue',
        secondary: 'border-line-default bg-surface-icon-box text-fg-secondary',
        destructive: 'border-transparent bg-accent-red text-fg-on-accent',
        outline: 'border-line-default bg-transparent text-fg-primary',
        success: 'border-accent-green-ring bg-accent-green-soft text-accent-green',
        warning: 'border-accent-amber-ring bg-accent-amber-soft text-accent-amber',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export type BadgeVariantProps = VariantProps<typeof badgeVariants>
