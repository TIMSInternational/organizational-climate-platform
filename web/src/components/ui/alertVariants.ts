import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/cn'

/**
 * Ported from `climate-project/src/components/ui/alert.tsx`.
 *
 * Soft accent fill plus a matching hairline, the same treatment `Badge` uses, so
 * an inline alert and a status pill read as the same family.
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
        success:
          'border-accent-green-ring bg-accent-green-soft text-fg-primary [&>svg]:text-accent-green',
        warning:
          'border-accent-amber-ring bg-accent-amber-soft text-fg-primary [&>svg]:text-accent-amber',
        destructive:
          'border-accent-red-ring bg-accent-red-soft text-fg-primary [&>svg]:text-accent-red',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export type AlertVariantProps = VariantProps<typeof alertVariants>
