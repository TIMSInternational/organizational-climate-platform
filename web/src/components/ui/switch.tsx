import * as SwitchPrimitive from '@radix-ui/react-switch'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

/**
 * Ported from `climate-project/src/components/ui/switch.tsx`, sized to the canvas: an 18×32 track and a
 * 14px knob in `fg-on-accent` (#ffffff in both themes). The knob used to be `bg-surface-panel`, and
 * the 10 Sep shots showed a solid pill with no visible knob; the canvas draws a white one.
 */
export type SwitchProps = ComponentProps<typeof SwitchPrimitive.Root> & {
  /**
   * The canvas draws two switches. `default` is the 18×32 track of the Departments and
   * Notifications artboards; `sm` is the SurveyBuilder artboard's 16×28 track with a 12px knob
   * inset 2px (`SurveyBuilder.dc.html`: `width: 28px; height: 16px`, knob `left: 14px`).
   */
  size?: 'default' | 'sm'
}

export function Switch({ className, size = 'default', ...props }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        // Radix renders the track as a <button>, and index.css pads every bare button as a carded
        // control and centres its content. `p-0`: the padding squeezed the knob to nothing inside
        // the 32px track. `justify-start`: centred before its translate, an off knob sat mid-track
        // and an on knob ran past the track's right end (found on the authoring screens, #472).
        'peer inline-flex shrink-0 items-center justify-start rounded-full border border-transparent p-0',
        size === 'sm' ? 'h-4 w-7' : 'h-4.5 w-8',
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
          'pointer-events-none block shrink-0 rounded-full bg-fg-on-accent shadow-sm ring-0',
          'transition-transform ease-out',
          // Inside the 1px transparent border: `sm` puts its 12px knob 2px from either end of the
          // 28px track (1px + 1px, and 1px + 13px = the artboard's `left: 14px`).
          size === 'sm'
            ? 'size-3 translate-x-px data-[state=checked]:translate-x-3.25'
            : 'size-3.5 translate-x-0.5 data-[state=checked]:translate-x-3.5',
        )}
      />
    </SwitchPrimitive.Root>
  )
}
