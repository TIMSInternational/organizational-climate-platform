import { useId, useState } from 'react'
import { CalendarIcon, Clock } from 'lucide-react'
import { useTranslation } from '../../../../i18n'
import { Calendar, Input, Popover, PopoverContent, PopoverTrigger } from '../../../../components/ui'
import { cn } from '../../../../lib/cn'

/** A 24-hour `hh:mm`; a single-digit hour is read as its two-digit self. */
const HOURS_MINUTES = /^([01]?\d|2[0-3]):([0-5]\d)$/

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/

interface WallClock {
  year: number
  month: number
  day: number
  hh: string
  mm: string
}

/**
 * The value's fields, read off the string -- never through a `Date` in the browser's zone. The
 * value is the COMPANY's wall clock (G16); a `Date` would move it wherever the browser's own zone
 * has no such minute (America/Chicago at 02:30 on 8 Mar 2026), and print it one hour off.
 */
function parseWallClock(value: string): WallClock | null {
  const match = WALL_CLOCK.exec(value)
  if (!match) return null
  const [, year, month, day, hh, mm] = match
  return { year: Number(year), month: Number(month), day: Number(day), hh, mm }
}

const two = (n: number) => String(n).padStart(2, '0')

function wallClockString(year: number, month: number, day: number, hh: string | number, mm: string | number): string {
  return `${year}-${two(month)}-${two(day)}T${two(Number(hh))}:${two(Number(mm))}`
}

/**
 * "14/09/2026 · 08:00" -- the numeric day in the page's locale (day first in Spanish) and the
 * 24-hour clock, as `format.ts`'s `numericDayTime` writes them, from the wall clock's own fields:
 * the day is formatted on UTC, where the fields were put, so no zone can shift it.
 */
function numericWallClock(clock: WallClock, locale: string): string {
  const day = new Date(Date.UTC(clock.year, clock.month - 1, clock.day)).toLocaleDateString(locale, {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
  return `${day} · ${clock.hh}:${clock.mm}`
}

/**
 * Crear's Apertura and Cierre, drawn as the MicroclimateCreate board draws them: a leading
 * calendar glyph and a mono readout, "14/09/2026 · 08:00" — the day in the page's locale and a
 * 24-hour clock (`numericDayTime`). The picker sits behind the readout: a calendar for the day
 * and an `hh:mm` field for the time, neither of them the browser's.
 *
 * It replaced a native `datetime-local`, whose text is the browser's own locale format: the
 * refuter's en-US Chromium printed "09/10/2026, 10:30 PM" with a trailing calendar button on a
 * Spanish screen. The value it takes and gives back is still that input's string, a wall clock
 * on the company's zone (G16): it is edited as text, and only `buildCreateInput` turns it into
 * an instant.
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
  const clock = parseWallClock(value)
  // The calendar's day: a local midnight, used for its year, month and day and nothing else.
  const date = clock ? new Date(clock.year, clock.month - 1, clock.day) : null
  // An emptied field is not yet a wrong one: the hint waits for a time typed wrong.
  const timeInvalid = time !== '' && !HOURS_MINUTES.test(time)

  function openChange(next: boolean) {
    // The time field starts from the value each time the picker opens, so a half-typed time
    // left behind by an earlier visit never outlives it.
    if (next) setTime(clock ? `${clock.hh}:${clock.mm}` : '')
    setOpen(next)
  }

  function pickDay(day: Date | undefined) {
    if (!day) return
    const match = HOURS_MINUTES.exec(time)
    onChange(
      wallClockString(
        day.getFullYear(),
        day.getMonth() + 1,
        day.getDate(),
        match ? match[1] : (clock?.hh ?? 0),
        match ? match[2] : (clock?.mm ?? 0),
      ),
    )
  }

  function typeTime(typed: string) {
    setTime(typed)
    const match = HOURS_MINUTES.exec(typed)
    if (!match || !clock) return
    onChange(wallClockString(clock.year, clock.month, clock.day, match[1], match[2]))
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
            <span id={valueId} className={cn('truncate', clock ? 'font-mono tabular-nums' : 'text-fg-tertiary')}>
              {clock ? numericWallClock(clock, locale) : t('microclimates.next.create.pickDateTime')}
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
