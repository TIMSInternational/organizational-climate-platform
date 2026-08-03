import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

/**
 * Ported from `climate-project/src/components/ui/textarea.tsx`.
 *
 * `h-auto` and the vertical padding are needed because the element rule in
 * index.css pins every `input`/`select`/`textarea` to the 32px control height
 * with no vertical inset — right for a single-line control, wrong for this one.
 */
export type TextareaProps = ComponentProps<'textarea'>

export function Textarea({ className, ...props }: TextareaProps) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'field-sizing-content h-auto min-h-16 w-full py-2',
        'rounded-md border border-line-default bg-surface-input text-base text-fg-primary',
        'placeholder:text-fg-light',
        'hover:not-disabled:border-line-hover',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-accent-red',
        className,
      )}
      {...props}
    />
  )
}
