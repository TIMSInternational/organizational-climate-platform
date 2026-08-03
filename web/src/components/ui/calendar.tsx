import { DayPicker } from 'react-day-picker'
import { enUS, es } from 'date-fns/locale'
import type { ComponentProps } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { cn } from '../../lib/cn'
import { useTranslation } from '../../i18n'
import type { Locale } from '../../i18n'

/**
 * Ported from `climate-project/src/components/ui/calendar.tsx`.
 *
 * #77 was initially closed with this **skipped**, on the grounds that the app's
 * native `type="date"` inputs are localised by the browser for free and a custom
 * picker is an i18n downgrade. That objection is answered here rather than ignored:
 * the calendar reads the active locale from `useTranslation()` and hands
 * react-day-picker the matching date-fns locale, so month names, weekday initials
 * and the week start follow the UI language instead of being pinned to English.
 *
 * The native inputs in `ActionPlanForm` and `MicroclimateForm` are deliberately
 * left alone — this is available for the screens that want a styled picker, not a
 * mandate to replace working controls.
 */
const DATE_FNS_LOCALES: Record<Locale, typeof enUS> = {
  en: enUS,
  es,
}

type DayPickerProps = ComponentProps<typeof DayPicker>

/**
 * `DayPickerProps` is a discriminated union on `mode` (`'single' | 'multiple' |
 * 'range'`), and a plain `Omit` collapses it into the no-mode branch — which makes
 * `<Calendar mode="range">` a type error. Distributing the omit over the union keeps
 * each branch intact.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export type CalendarProps = DistributiveOmit<DayPickerProps, 'locale'> & {
  /** Overrides the locale from `useTranslation()`. For tests, mostly. */
  localeOverride?: Locale
}

export function Calendar({ className, classNames, localeOverride, ...props }: CalendarProps) {
  const { locale } = useTranslation()
  const active = localeOverride ?? locale

  return (
    <DayPicker
      data-slot="calendar"
      locale={DATE_FNS_LOCALES[active]}
      className={cn('p-card', className)}
      classNames={{
        months: 'flex flex-col gap-panel-gap',
        month: 'flex flex-col gap-panel-gap',
        month_caption: 'flex h-control-lg items-center justify-center',
        caption_label: 'text-base font-medium text-fg-primary',
        nav: 'flex items-center justify-between absolute inset-x-0',
        button_previous: cn(
          'flex size-control-md items-center justify-center rounded-md',
          'border-transparent bg-transparent text-fg-tertiary',
          'hover:bg-state-hover hover:text-fg-primary',
          'disabled:opacity-50',
        ),
        button_next: cn(
          'flex size-control-md items-center justify-center rounded-md',
          'border-transparent bg-transparent text-fg-tertiary',
          'hover:bg-state-hover hover:text-fg-primary',
          'disabled:opacity-50',
        ),
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday: 'w-control-lg text-2xs font-medium uppercase tracking-label text-fg-label',
        week: 'flex w-full',
        day: 'p-0',
        day_button: cn(
          'flex size-control-lg items-center justify-center rounded-md',
          'border-transparent bg-transparent text-base text-fg-primary',
          'hover:bg-state-hover',
        ),
        selected: '[&>button]:bg-accent-blue [&>button]:text-fg-on-accent',
        today: '[&>button]:font-semibold [&>button]:text-accent-blue',
        outside: '[&>button]:text-fg-light',
        disabled: '[&>button]:opacity-50 [&>button]:pointer-events-none',
        range_middle: '[&>button]:bg-accent-blue-soft [&>button]:text-fg-primary',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        // The stock chevrons are inline SVG with their own sizing; swap in the
        // icon set the rest of ui/ uses so a calendar arrow matches a nav arrow.
        Chevron: ({ orientation, ...iconProps }) =>
          orientation === 'left' ? (
            <ChevronLeftIcon className="size-icon" {...iconProps} />
          ) : (
            <ChevronRightIcon className="size-icon" {...iconProps} />
          ),
      }}
      // Cast back to the union: TypeScript cannot verify that a rest element
      // spread from `DistributiveOmit<...>` still satisfies one branch of the
      // discriminated union, even though every field came from it. The alternative
      // is enumerating every DayPicker prop by hand.
      {...(props as DayPickerProps)}
    />
  )
}
