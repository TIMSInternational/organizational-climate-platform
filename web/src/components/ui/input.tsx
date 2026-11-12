import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

/**
 * Ported from `climate-project/src/components/ui/input.tsx`.
 *
 * The bare `input` element is already styled in index.css because the existing pages
 * render plain `<input>`. This primitive is the Apple design's `.in`: 36px tall (44px under
 * a finger, HIG `buttons.md`'s 44pt hit region), 12px inset, the 8px control radius, 15px
 * text, on the input ground with the 3:1 control edge (`--admin-line-control`, 3.62:1 on
 * the card in light, 3.57:1 on the dark input ground).
 *
 * `outline-none` and the rebuilt `focus-visible:ring-*` are deliberately not
 * ported — index.css applies one global `:focus-visible` outline.
 */
export type InputProps = ComponentProps<'input'>

export function Input({ className, type, ...props }: InputProps) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-9 w-full rounded-md border border-line-control bg-surface-input px-3 text-base text-fg-primary',
        'pointer-coarse:h-11',
        'placeholder:text-fg-tertiary',
        'file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-fg-primary',
        'hover:not-disabled:border-line-hover',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-accent-red',
        className,
      )}
      {...props}
    />
  )
}
