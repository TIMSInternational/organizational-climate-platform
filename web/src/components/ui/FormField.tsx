import type { ReactNode } from 'react'
import { FormControl, FormDescription, FormItem, FormLabel, FormMessage } from './form'
import { Input } from './input'
import { Textarea } from './textarea'
import { Checkbox } from './checkbox'
import { RadioGroup, RadioGroupItem } from './radio-group'
import { Switch } from './switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select'
import { Label } from './label'
import { cn } from '../../lib/cn'

/**
 * Pre-composed single-control form rows, ported from
 * `climate-project/src/components/ui/FormField.tsx`.
 *
 * Each takes `label`, optional `description` and `error`, and a controlled
 * `value`/`onChange` pair — the shape the forms in this app already use by hand.
 *
 * **framer-motion is not ported.** The legacy file imported it to fade the error
 * message in. index.css already ships an `--animate-fade-in` keyframe (and honours
 * `prefers-reduced-motion`), so `animate-fade-in` gets the same effect with no
 * dependency. A 40 kB animation library for one opacity transition is not a trade
 * worth making, and the token version stays consistent with the rest of the app.
 *
 * The legacy `AlertCircle` / `Info` icons are also dropped: the message is already
 * `role="alert"` in red, and an icon next to 12px text is noise.
 */

interface BaseFieldProps {
  label: string
  description?: string
  error?: string
  required?: boolean
  disabled?: boolean
  className?: string
}

/** The label, description and message scaffold every field shares. */
function Field({
  label,
  description,
  error,
  required,
  className,
  children,
  labelAfterControl = false,
}: BaseFieldProps & { children: ReactNode; labelAfterControl?: boolean }) {
  const labelNode = (
    <FormLabel>
      {label}
      {required && (
        <span aria-hidden="true" className="text-accent-red">
          *
        </span>
      )}
    </FormLabel>
  )

  return (
    // `max-w-field` here, on the scaffold every field shares, rather than on the
    // control alone. `index.css` caps `label > input`, which reaches a bare control
    // written as a direct child of its label — but this primitive renders the label
    // and the control as *siblings* inside `FormItem`, so that rule never applied to
    // anything built from `TextField`/`SelectField`/`TextareaField`. Measured on the
    // survey wizard at 2560: every field was 2256px wide, which is precisely the
    // defect the token was introduced to fix, still present one layer up.
    //
    // The cap is on the wrapper so the label, the control, the description and the
    // error message all share one measure and stay left-aligned with each other.
    <FormItem invalid={Boolean(error)} className={cn('max-w-field', className)}>
      {labelAfterControl ? (
        // Checkbox and switch read as "[control] Label", not stacked.
        <div className="flex items-center gap-inline">
          {children}
          {labelNode}
        </div>
      ) : (
        <>
          {labelNode}
          {children}
        </>
      )}
      {description && <FormDescription>{description}</FormDescription>}
      <FormMessage className="animate-fade-in">{error}</FormMessage>
    </FormItem>
  )
}

export type TextFieldProps = BaseFieldProps & {
  // `date`/`datetime-local` added for the survey wizard's schedule step. The
  // browser supplies the picker; nothing else about the field differs, which is
  // why this is a widened union rather than a second component.
  type?: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url' | 'date' | 'datetime-local'
  placeholder?: string
  value?: string
  onChange?: (value: string) => void
  maxLength?: number
}

export function TextField({
  type = 'text',
  placeholder,
  value,
  onChange,
  maxLength,
  ...base
}: TextFieldProps) {
  return (
    <Field {...base}>
      <FormControl>
        <Input
          type={type}
          placeholder={placeholder}
          value={value}
          maxLength={maxLength}
          required={base.required}
          disabled={base.disabled}
          onChange={(event) => onChange?.(event.target.value)}
        />
      </FormControl>
    </Field>
  )
}

export type TextareaFieldProps = BaseFieldProps & {
  placeholder?: string
  value?: string
  onChange?: (value: string) => void
  rows?: number
  maxLength?: number
}

export function TextareaField({
  placeholder,
  value,
  onChange,
  rows,
  maxLength,
  ...base
}: TextareaFieldProps) {
  return (
    <Field {...base}>
      <FormControl>
        <Textarea
          placeholder={placeholder}
          value={value}
          rows={rows}
          maxLength={maxLength}
          required={base.required}
          disabled={base.disabled}
          onChange={(event) => onChange?.(event.target.value)}
        />
      </FormControl>
    </Field>
  )
}

export interface FieldOption {
  value: string
  label: string
  disabled?: boolean
}

export type SelectFieldProps = BaseFieldProps & {
  placeholder?: string
  value?: string
  onChange?: (value: string) => void
  options: FieldOption[]
}

export function SelectField({
  placeholder,
  value,
  onChange,
  options,
  ...base
}: SelectFieldProps) {
  return (
    <Field {...base}>
      <Select value={value} onValueChange={onChange} disabled={base.disabled}>
        <FormControl>
          <SelectTrigger>
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
        </FormControl>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

export type CheckboxFieldProps = BaseFieldProps & {
  checked?: boolean
  onChange?: (checked: boolean) => void
}

export function CheckboxField({ checked, onChange, ...base }: CheckboxFieldProps) {
  return (
    <Field {...base} labelAfterControl>
      <FormControl>
        <Checkbox
          checked={checked}
          disabled={base.disabled}
          onCheckedChange={(next) => onChange?.(next === true)}
        />
      </FormControl>
    </Field>
  )
}

export type SwitchFieldProps = BaseFieldProps & {
  checked?: boolean
  onChange?: (checked: boolean) => void
}

export function SwitchField({ checked, onChange, ...base }: SwitchFieldProps) {
  return (
    <Field {...base} labelAfterControl>
      <FormControl>
        <Switch checked={checked} disabled={base.disabled} onCheckedChange={onChange} />
      </FormControl>
    </Field>
  )
}

export type RadioFieldProps = BaseFieldProps & {
  value?: string
  onChange?: (value: string) => void
  options: FieldOption[]
}

export function RadioField({ value, onChange, options, ...base }: RadioFieldProps) {
  return (
    <Field {...base}>
      <FormControl>
        <RadioGroup value={value} onValueChange={onChange} disabled={base.disabled}>
          {options.map((option) => (
            // Each option needs its own label/control pair, so it does not use
            // FormControl — that id belongs to the group.
            <div key={option.value} className={cn('flex items-center gap-inline')}>
              <RadioGroupItem
                id={`${option.value}-option`}
                value={option.value}
                disabled={option.disabled}
              />
              <Label htmlFor={`${option.value}-option`}>{option.label}</Label>
            </div>
          ))}
        </RadioGroup>
      </FormControl>
    </Field>
  )
}
