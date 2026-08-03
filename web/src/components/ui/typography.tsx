import type { ComponentProps, ElementType } from 'react'
import { cn } from '../../lib/cn'
import {
  DEFAULT_ELEMENT,
  typographyVariants,
  type TypographyVariant,
} from './typographyVariants'

export type TypographyProps = ComponentProps<'p'> & {
  variant?: TypographyVariant
  /**
   * Render a different element. Use it to keep heading *levels* correct when the
   * visual size should not follow — a `variant="h3"` that is really the page's
   * `h2`, for instance.
   */
  as?: ElementType
}

export function Typography({
  variant = 'body',
  as,
  className,
  ...props
}: TypographyProps) {
  const Component = as ?? DEFAULT_ELEMENT[variant]
  return (
    <Component
      data-slot="typography"
      data-variant={variant}
      className={cn(typographyVariants[variant], className)}
      {...props}
    />
  )
}

export const H1 = (props: Omit<TypographyProps, 'variant'>) => (
  <Typography variant="h1" {...props} />
)
export const H2 = (props: Omit<TypographyProps, 'variant'>) => (
  <Typography variant="h2" {...props} />
)
export const H3 = (props: Omit<TypographyProps, 'variant'>) => (
  <Typography variant="h3" {...props} />
)
export const H4 = (props: Omit<TypographyProps, 'variant'>) => (
  <Typography variant="h4" {...props} />
)
export const Body = (props: Omit<TypographyProps, 'variant'>) => (
  <Typography variant="body" {...props} />
)
export const BodySmall = (props: Omit<TypographyProps, 'variant'>) => (
  <Typography variant="bodySmall" {...props} />
)
export const DataText = (props: Omit<TypographyProps, 'variant'>) => (
  <Typography variant="data" {...props} />
)
export const Caption = (props: Omit<TypographyProps, 'variant'>) => (
  <Typography variant="caption" {...props} />
)
export const SectionLabel = (props: Omit<TypographyProps, 'variant'>) => (
  <Typography variant="sectionLabel" {...props} />
)
export const Code = (props: Omit<TypographyProps, 'variant'>) => (
  <Typography variant="code" {...props} />
)

