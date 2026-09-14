import { useId, useState } from 'react'
import { CalendarIcon, Clock } from 'lucide-react'
import { useTranslation } from '../../../../i18n'
import { Calendar, Input, Popover, PopoverContent, PopoverTrigger } from '../../../../components/ui'
import { cn } from '../../../../lib/cn'
import { toLocalInput } from '../derive'
import { numericDayTime } from '../format'

/** A 24-hour `hh:mm`; a single-digit hour is read as its two-digit self. */
const HOURS_MINUTES = /^([01]?\d|2[0-3]):([0-5]\d)$/

/** The value as `windowMs` reads it — local wall clock — or `null` when unset or unparseable. */
function parseLocal(value: string): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

/**
 * Crear's Apertura and Cierre, drawn as the MicroclimateCreate board draws them: a leading
 * calendar glyph and a mono readout, "14/09/2026 · 08:00" — the day in the page's locale and a
 * 24-hour clock (`numericDayTime`). The picker sits behind the readout: a calendar for the day
 * and an `hh:mm` field for the time, neither of them the browser's.
 *
 * It replaced a native `datetime-local`, whose text is the browser's own locale format: the
 * refuter's en-US Chromium printed "09/10/2026, 10:30 PM" with a trailing calendar button on a
 * Spanish screen. The value it takes and gives back is still that input's string
 * (`toLocalInput`), so the model, `windowMs` and the submit path are unchanged.
 */
export function DateTimeField({
  id,
  label,
  value,
  disabled,
  onChange,
}: {
  id: string
  label: string
  /** A `datetime-local` string, `2026-09-14T08:00`. */
  value: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  const { t, locale } = useTranslation()
  const labelId = useId()
  const valueId = useId()
  const timeId = useId()
  const timeHintId = useId()
  const [open, setOpen] = useState(false)
  const [time, setTime] = useState('')
  const date = parseLocal(value)
  // An emptied field is not yet a wrong one: the hint waits for a time typed wrong.
  const timeInvalid = time !== '' && !HOURS_MINUTES.test(time)

  function openChange(next: boolean) {
    // The time field starts from the value each time the picker opens, so a half-typed time
    // left behind by an earlier visit never outlives it.
    if (next) setTime(date ? toLocalInput(date).slice(11) : '')
    setOpen(next)
  }

  function pickDay(day: Date | undefined) {
    if (!day) return
    const match = HOURS_MINUTES.exec(time)
    const next = new Date(day)
    next.setHours(match ? Number(match[1]) : (date?.getHours() ?? 0), match ? Number(match[2]) : (date?.getMinutes() ?? 0), 0, 0)
    onChange(toLocalInput(next))
  }

  function typeTime(typed: string) {
    setTime(typed)
    const match = HOURS_MINUTES.exec(typed)
    if (!match || !date) return
    const next = new Date(date)
    next.setHours(Number(match[1]), Number(match[2]), 0, 0)
    onChange(toLocalInput(next))
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label id={labelId} htmlFor={id} className="m-0 text-sm font-semibold leading-normal text-fg-secondary">
        {label}
      </label>
      <Popover open={open} onOpenChange={openChange}>
        <PopoverTrigger asChild>
          {/* A bare `<button>` takes index.css's carded control (centred, medium weight, the
              card's hover); every one of those is set back here to the board's field. */}
          <button
            type="button"
            id={id}
            data-slot="datetime-field"
            aria-labelledby={`${labelId} ${valueId}`}
            disabled={disabled}
            className={cn(
              'flex h-8 w-full min-w-0 items-center justify-start gap-2 px-2.5',
              'rounded-md border border-line-default bg-surface-input text-base font-normal text-fg-primary',
              'hover:not-disabled:border-line-hover',
            )}
          >
            <CalendarIcon aria-hidden="true" className="size-3.5 shrink-0 text-fg-tertiary" />
            <span id={valueId} className={cn('truncate', date ? 'font-mono tabular-nums' : 'text-fg-tertiary')}>
              {date ? numericDayTime(date, locale) : t('microclimates.next.create.pickDateTime')}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar mode="single" selected={date ?? undefined} defaultMonth={date ?? undefined} onSelect={pickDay} autoFocus />
          <div className="flex flex-col gap-1 border-t border-line-light px-4 py-3">
            <div className="flex items-center gap-2">
              <Clock aria-hidden="true" className="size-3.5 shrink-0 text-fg-tertiary" />
              <label htmlFor={timeId} className="m-0 text-sm font-semibold leading-normal text-fg-secondary">
                {t('microclimates.next.create.time')}
              </label>
              {/* No `inputMode="numeric"`: a phone's digit pad has no ":", so "08:30" could
                  not be typed on one. */}
              <Input
                id={timeId}
                value={time}
                autoComplete="off"
                maxLength={5}
                aria-invalid={timeInvalid || undefined}
                aria-describedby={timeInvalid ? timeHintId : undefined}
                className="h-8 w-20 px-2 text-center font-mono tabular-nums"
                onChange={(event) => typeTime(event.target.value)}
              />
            </div>
            {timeInvalid && (
              <span id={timeHintId} className="text-xs text-accent-red">
                {t('microclimates.next.create.timeInvalid')}
              </span>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
