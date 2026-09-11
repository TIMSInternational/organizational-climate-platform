import * as SwitchPrimitive from '@radix-ui/react-switch'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

/** Ported from `climate-project/src/components/ui/switch.tsx`. */
export type SwitchProps = ComponentProps<typeof SwitchPrimitive.Root>

export function Switch({ className, ...props }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        // The root is a <button>, and index.css (`button`, ~l. 298) gives every bare button
        // 12px of padding a side and `justify-content: center`. `p-0`: the padding squeezed
        // the thumb to a 2px sliver on the 28px track. `justify-start`: centring put the thumb
        // mid-track before its translate, so an off switch read as on and an on switch's knob
        // ran past the track's right end (crop-bank-switch.png, crop-checked-switch.png).
        'peer inline-flex h-4 w-7 shrink-0 items-center justify-start rounded-full border border-transparent p-0',
        'transition-colors ease-out',
        'bg-line-default data-[state=checked]:bg-accent-blue',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'pointer-events-none block size-3 shrink-0 rounded-full bg-surface-panel shadow-sm ring-0',
          'transition-transform ease-out',
          'translate-x-0.5 data-[state=checked]:translate-x-3.5',
        )}
      />
    </SwitchPrimitive.Root>
  )
}
