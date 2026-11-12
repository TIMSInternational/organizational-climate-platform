import * as SwitchPrimitive from '@radix-ui/react-switch'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

/**
 * Ported from `climate-project/src/components/ui/switch.tsx`, drawn to the Apple design's
 * toggle (`occ.css` `.tg`): a 26×42 track and a 22px white knob inset 2px, blue when on.
 *
 * ## Blue, and which blue
 *
 * Toggles are blue, not green (the user's ruling of 11 Nov). The checked track is
 * `bg-accent-blue` — the IDENTITY blue (#3a7af0 light, #60a5fa dark), not the fill blue
 * (#2563eb) the canvas's `.tg:checked` names. Measured, not chosen by eye: the track is a
 * graphic with no word on it, and its on and off fills must stay 3:1 apart to be told apart
 * (`styles/controlBoundaryContrast.test.ts`). In dark the fill blue sits **2.36:1** from the
 * off track (#2d354c); the identity blue sits 4.79:1 (light: 4.17:1 and 3.25:1, both over).
 * `tokens.css` names the identity blue for exactly this — "a selected border, a radio dot, a
 * chart mark" — and keeps the fill blue for surfaces that carry a white WORD.
 *
 * ## The off edge
 *
 * OFF the track is `--admin-border-default`, 1.27:1 on `--admin-bg-outer` — a control you
 * could not find — so it takes the `line-control` edge every control got on 2026-09-22
 * (WCAG 1.4.11). Checked, the saturated fill is its own boundary and the edge goes
 * transparent (1px in both states, so nothing reflows). Recolouring the off FILL instead was
 * measured and rejected: it collapses the on/off pair from 3.28:1 to 1.37:1.
 */
export type SwitchProps = ComponentProps<typeof SwitchPrimitive.Root> & {
  /**
   * `default` is the Apple design's `.tg`: 26×42, a 22px knob 2px from either end
   * (`left: 2px` off, `left: 18px` on). `sm` is the 10 Sep SurveyBuilder artboard's 16×28 track
   * with a 12px knob, kept for the dense builder rows that were measured against it.
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
        // control and centres its content. `p-0`: the padding squeezed the knob to nothing.
        // `justify-start`: centred before its translate, an off knob sat mid-track (#472).
        'peer relative inline-flex shrink-0 items-center justify-start rounded-full p-0',
        // Under a finger the hit region grows past the 44px HIG asks for (`buttons.md`), by an
        // invisible 10px ring around the track, so the drawing itself does not change.
        'pointer-coarse:after:absolute pointer-coarse:after:-inset-2.5',
        'border border-line-control data-[state=checked]:border-transparent',
        size === 'sm' ? 'h-4 w-7' : 'h-6.5 w-10.5',
        'transition-colors ease-out',
        'bg-line-default',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
        // AFTER `className`, so a caller cannot repaint the on state: eight screens passed
        // `data-[state=checked]:bg-accent-green` (and one `bg-chip-good-ink`), and green is a
        // result area — Fortaleza — never a toggle. `cn` keeps the last of two checked fills.
        'data-[state=checked]:bg-accent-blue',
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'pointer-events-none block shrink-0 rounded-full bg-fg-on-accent shadow-sm ring-0',
          'transition-transform ease-out',
          // Inside the 1px border, so each translate is 1px short of the drawing's offset:
          // default 1px (+1 = `left: 2px`) and 17px (+1 = `left: 18px`); `sm` 1px and 13px
          // (+1 = the artboard's `left: 14px`).
          size === 'sm'
            ? 'size-3 translate-x-px data-[state=checked]:translate-x-3.25'
            : 'size-5.5 translate-x-px data-[state=checked]:translate-x-4.25',
        )}
      />
    </SwitchPrimitive.Root>
  )
}
