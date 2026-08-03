import { useId } from 'react'
import type { ComponentProps } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { Label } from './label'
import { cn } from '../../lib/cn'
import { FormItemContext, useFormField } from './formContext'

/**
 * The composable form-row parts, ported from
 * `climate-project/src/components/ui/form.tsx`.
 *
 * **`Form` and the `FormField` `Controller` wrapper are deliberately not ported.**
 * The legacy file was shadcn's `react-hook-form` binding — `Form = FormProvider`,
 * `FormField = Controller`, and a `useFormField` that read `useFormState`. Nothing
 * in this app uses react-hook-form: all twelve pages and every existing form
 * component are plain controlled inputs (`useState` + `onChange`). Porting the
 * binding would have added a dependency and a second form paradigm to support
 * alongside the one already in use, for no current caller.
 *
 * What was worth keeping is the part that is easy to get wrong by hand: the
 * accessibility wiring. `FormItem` mints the ids, `FormControl` attaches
 * `aria-describedby` and `aria-invalid`, and `FormLabel` points at the control.
 * That works for controlled inputs, and it would still work under react-hook-form
 * later — `FormControl` takes whatever child you give it.
 *
 * See `FormField.tsx` for the pre-composed single-control fields.
 */

export type FormItemProps = ComponentProps<'div'> & {
  /** Marks the row's control invalid and reveals `FormMessage` to assistive tech. */
  invalid?: boolean
}

export function FormItem({ className, invalid = false, ...props }: FormItemProps) {
  const id = useId()

  return (
    <FormItemContext.Provider
      value={{
        id,
        descriptionId: `${id}-description`,
        messageId: `${id}-message`,
        invalid,
      }}
    >
      <div
        data-slot="form-item"
        // `group/field` is what `Label`'s `group-data-[disabled=true]/field:`
        // classes hook onto.
        className={cn('group/field grid gap-1.5', className)}
        {...props}
      />
    </FormItemContext.Provider>
  )
}

export function FormLabel({ className, ...props }: ComponentProps<typeof Label>) {
  const { id, invalid } = useFormField()

  return (
    <Label
      data-slot="form-label"
      data-error={invalid || undefined}
      htmlFor={id}
      className={cn('data-[error=true]:text-accent-red', className)}
      {...props}
    />
  )
}

/**
 * Wires its single child up to the row: id, description, and validity.
 *
 * Uses `Slot`, so the child keeps being whatever it is — an `Input`, a
 * `SelectTrigger`, a bare `<input>`.
 */
export function FormControl({ ...props }: ComponentProps<typeof Slot>) {
  const { id, descriptionId, messageId, invalid } = useFormField()

  return (
    <Slot
      data-slot="form-control"
      id={id}
      // The message id is only referenced while invalid, so a screen reader is
      // not sent to an empty element. The description id is always referenced;
      // if the row has no FormDescription the reference is simply ignored, which
      // is the same trade-off shadcn makes.
      aria-describedby={invalid ? `${descriptionId} ${messageId}` : descriptionId}
      aria-invalid={invalid || undefined}
      {...props}
    />
  )
}

export function FormDescription({ className, ...props }: ComponentProps<'p'>) {
  const { descriptionId } = useFormField()

  return (
    <p
      data-slot="form-description"
      id={descriptionId}
      className={cn('text-sm text-fg-tertiary', className)}
      {...props}
    />
  )
}

/**
 * The row's validation message. Renders nothing when there is no content, so a
 * caller can pass a possibly-undefined error straight through.
 */
export function FormMessage({ className, children, ...props }: ComponentProps<'p'>) {
  const { messageId } = useFormField()

  if (!children) return null

  return (
    <p
      data-slot="form-message"
      id={messageId}
      role="alert"
      className={cn('text-sm text-accent-red', className)}
      {...props}
    >
      {children}
    </p>
  )
}
