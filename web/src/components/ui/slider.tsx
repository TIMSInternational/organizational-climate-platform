import * as SliderPrimitive from '@radix-ui/react-slider'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

/**
 * Ported from `climate-project/src/components/ui/slider.tsx`.
 *
 * Rebuilt on `@radix-ui/react-slider`. The legacy version was a bare
 * `<input type="range">` wrapper with no `aria-label` plumbing and no support for a
 * range (two thumbs); the M4 results screens need the range form, and Radix gives
 * keyboard support and the value semantics for free.
 *
 * Note where the label goes: Radix puts `role="slider"` on the **thumb**, not on the
 * root, so an `aria-label` left on the root names nothing. This forwards it to the
 * thumb — a test caught the first version rendering an unnamed slider. For a
 * two-thumb range pass `thumbLabels`, so each end is named separately rather than
 * both reading as the same control.
 */
export type SliderProps = ComponentProps<typeof SliderPrimitive.Root> & {
  /** One label per thumb. Falls back to the root's `aria-label`. */
  thumbLabels?: string[]
}

export function Slider({
  className,
  thumbLabels,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  ...props
}: SliderProps) {
  // One thumb per value; two values is a range.
  const values = props.value ?? props.defaultValue ?? [0]

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        'relative flex w-full touch-none select-none items-center',
        'data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative h-1 w-full grow overflow-hidden rounded-full bg-surface-icon-box"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="absolute h-full bg-accent-blue"
        />
      </SliderPrimitive.Track>
      {values.map((_, index) => (
        <SliderPrimitive.Thumb
          key={index}
          data-slot="slider-thumb"
          aria-label={thumbLabels?.[index] ?? ariaLabel}
          aria-labelledby={thumbLabels?.[index] ? undefined : ariaLabelledBy}
          className={cn(
            'block size-3.5 rounded-full border border-accent-blue bg-surface-panel shadow-sm',
            'transition-[border-color] ease-out',
            'disabled:pointer-events-none',
          )}
        />
      ))}
    </SliderPrimitive.Root>
  )
}
