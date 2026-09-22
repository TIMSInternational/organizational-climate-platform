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
        //
        // The track IS this control's boundary, and OFF it is painted `--admin-border-default` —
        // 1.27:1 on `--admin-bg-outer`, 1.35:1 on a panel. WCAG 1.4.11 wants 3:1, so an off
        // switch was a control you could not find, on 17 admin screens. It takes the same
        // `line-control` edge every other control got on 2026-09-22.
        //
        // OFF ONLY, and that is not a shortcut. A checked track is a saturated fill that clears
        // the floor on its own (`accent-blue` is 4.17:1 on the outer ground), so an edge there
        // buys no contrast — and it costs: callers RE-COLOUR the checked fill
        // (`NotificationPreferencesNextPage` passes `data-[state=checked]:bg-accent-green`), and
        // a blue-grey ring around a green pill is a seam the screenshot shows plainly. What is
        // NOT the fix is recolouring the off FILL to `line-control`: it clears the boundary but
        // collapses the on/off pair from 3.28:1 to 1.37:1, trading a control you cannot find for
        // a state you cannot read.
        //
        // The border is 1px in both states — transparent when checked, not absent — so nothing
        // reflows and no knob translate moves. Guarded in `styles/controlBoundaryContrast.test.ts`.
        'peer inline-flex shrink-0 items-center justify-start rounded-full p-0',
        'border border-line-control data-[state=checked]:border-transparent',
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
