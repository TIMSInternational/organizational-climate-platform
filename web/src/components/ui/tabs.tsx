import * as TabsPrimitive from '@radix-ui/react-tabs'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

/**
 * Ported from `climate-project/src/components/ui/tabs.tsx`.
 *
 * The legacy `enhanced-tabs.tsx` (195 lines) is **not** ported separately: it was
 * this component plus a framer-motion sliding indicator. The indicator is a
 * `transition` on the active trigger's own border, so the animation does not need
 * a library, and two tab components would be two things to keep in sync.
 */
export function Tabs({ className, ...props }: ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn('flex flex-col gap-panel-gap', className)}
      {...props}
    />
  )
}

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn('flex items-center gap-1 border-b border-line-default', className)}
      {...props}
    />
  )
}

export function TabsTrigger({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'inline-flex h-control-lg items-center gap-inline whitespace-nowrap px-3',
        '-mb-px border-b-2 border-transparent text-base font-medium text-fg-secondary',
        'transition-[color,border-color] ease-out',
        'hover:text-fg-primary',
        'data-[state=active]:border-accent-blue data-[state=active]:text-fg-primary',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export function TabsContent({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('outline-hidden', className)}
      {...props}
    />
  )
}
