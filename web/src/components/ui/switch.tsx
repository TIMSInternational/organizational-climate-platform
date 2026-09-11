import * as SwitchPrimitive from '@radix-ui/react-switch'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

/**
 * Ported from `climate-project/src/components/ui/switch.tsx`, sized to the canvas: an 18×32 track and a
 * 14px knob in `fg-on-accent` (#ffffff in both themes). The knob used to be `bg-surface-panel`, and
 * the 10 Sep shots showed a solid pill with no visible knob; the canvas draws a white one.
 */
export type SwitchProps = ComponentProps<typeof SwitchPrimitive.Root>

export function Switch({ className, ...props }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        // Radix renders the track as a <button>, and index.css pads every bare button as a carded
        // control and centres its content. `p-0`: the padding squeezed the knob to nothing inside
        // the 32px track. `justify-start`: centred before its translate, an off knob sat mid-track
        // and an on knob ran past the track's right end (found on the authoring screens, #472).
        'peer inline-flex h-4.5 w-8 shrink-0 items-center justify-start rounded-full border border-transparent p-0',
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
          'pointer-events-none block size-3.5 shrink-0 rounded-full bg-fg-on-accent shadow-sm ring-0',
          'transition-transform ease-out',
          'translate-x-0.5 data-[state=checked]:translate-x-3.5',
        )}
      />
    </SwitchPrimitive.Root>
  )
}
