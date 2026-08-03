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
        'peer inline-flex h-4 w-7 shrink-0 items-center rounded-full border border-transparent',
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
          'pointer-events-none block size-3 rounded-full bg-surface-panel shadow-sm ring-0',
          'transition-transform ease-out',
          'translate-x-0.5 data-[state=checked]:translate-x-3.5',
        )}
      />
    </SwitchPrimitive.Root>
  )
}
