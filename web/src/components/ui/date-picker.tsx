import { useState } from 'react'
import { format } from 'date-fns'
import { enUS, es } from 'date-fns/locale'
import { CalendarIcon } from 'lucide-react'
import { cn } from '../../lib/cn'
import { useTranslation } from '../../i18n'
import { Calendar } from './calendar'
import { Popover, PopoverContent, PopoverTrigger } from './popover'

/**
 * Ported from `climate-project/src/components/ui/date-picker.tsx`.
 *
 * A `Popover` + `Calendar`, over a button that shows the formatted date.
 *
 * The formatting follows the UI language, not the machine's: `date-fns` gets the
 * locale that `useTranslation()` reports, so a Spanish user sees "3 de agosto de
 * 2026" rather than "August 3rd, 2026". That was the whole objection to porting a
 * custom picker in the first place, so it is wired here rather than left to callers.
 *
 * The native `type="date"` inputs in `ActionPlanForm` and `MicroclimateForm` are
 * left as they are. This is for screens that want a styled picker; a native input
 * is still the better default when one will do.
 */
const DATE_FNS_LOCALES = { en: enUS, es }

export interface DatePickerProps {
  value?: Date
  onChange?: (date: Date | undefined) => void
  /** Shown when no date is selected. Pass a translated string. */
  placeholder: string
  /** Accessible name for the trigger. Pass a translated string. */
  label: string
  /** `date-fns` pattern. Defaults to a long, locale-aware date. */
  dateFormat?: string
  disabled?: boolean
  /** Marks the trigger invalid, matching FormControl's contract. */
  invalid?: boolean
  className?: string
}

export function DatePicker({
  value,
  onChange,
  placeholder,
  label,
  dateFormat = 'PPP',
  disabled,
  invalid,
  className,
}: DatePickerProps) {
  const { locale } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-slot="date-picker-trigger"
          aria-label={label}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          className={cn(
            'flex h-control-lg w-full items-center gap-inline px-3',
            'rounded-md border border-line-default bg-surface-input text-base',
            'hover:not-disabled:border-line-hover',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'aria-invalid:border-accent-red',
            value ? 'text-fg-primary' : 'text-fg-light',
            className,
          )}
        >
          <CalendarIcon aria-hidden="true" className="size-icon shrink-0 text-fg-tertiary" />
          <span className="truncate">
            {value ? format(value, dateFormat, { locale: DATE_FNS_LOCALES[locale] }) : placeholder}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(date) => {
            onChange?.(date)
            // Close on pick: leaving it open after a single-date selection means a
            // second click is needed for no reason.
            setOpen(false)
          }}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  )
}
