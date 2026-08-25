import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

/**
 * Ported from `climate-project/src/components/ui/input.tsx`.
 *
 * The bare `input` element is already styled in index.css (32px tall, 12px
 * inset, 4px radius, 13px) because the twelve existing pages render plain
 * `<input>`. This primitive therefore adds only what the element rule cannot:
 * full width, and the file-input and placeholder treatments.
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
        'w-full rounded-md border border-line-default bg-surface-input text-base text-fg-primary',
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
