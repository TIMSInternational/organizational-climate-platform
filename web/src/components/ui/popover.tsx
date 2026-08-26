import * as PopoverPrimitive from '@radix-ui/react-popover'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

/** Ported from `climate-project/src/components/ui/popover.tsx`. */
export function Popover(props: ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

export function PopoverTrigger(props: ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

export function PopoverAnchor(props: ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

export function PopoverContent({
  className,
  align = 'center',
  sideOffset = 4,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 w-72 rounded-xl border border-line-panel bg-surface-panel p-card',
          // #83: `outline-hidden` was in this list. Radix moves focus to the
          // panel when the popover opens, and killing the ring there means a
          // keyboard user who opened it has no idea where they are.
          'text-fg-primary shadow-md',
          'data-[state=open]:animate-scale-in',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}
