import { useEffect, useRef, useState } from 'react'

interface CounterProps {
  value: number
  /** Already-translated label. The counter never translates its own label. */
  label?: string
  /** Appended verbatim, e.g. "%" or " pts". */
  suffix?: string
  /** Decimal places. Defaults to whatever the value needs, capped at 1. */
  decimals?: number
  /** Count-up duration in ms. 0 renders the final value immediately. */
  durationMs?: number
  /** BCP-47 locale for number formatting. Defaults to the document's language. */
  locale?: string
}

/**
 * A hero number — the right form when the data's job is a single headline rather
 * than a comparison. Not a chart, deliberately: a one-value bar chart is a
 * decorated number.
 *
 * Replaces legacy `AnimatedCounter`, which used framer-motion. This counts up with
 * `requestAnimationFrame` instead, which is a few lines and no dependency.
 *
 * Three things the legacy version did not do:
 *
 * - **Respects `prefers-reduced-motion`.** A number ticking upward is exactly the
 *   kind of motion that setting exists to suppress, and animating through wrong
 *   values is worse than decorative when the number is a KPI.
 * - **Renders the final value in the DOM for assistive tech.** The visible text
 *   animates; an `aria-hidden` visual span plus an accessible `<output>` carrying
 *   the settled value means a screen reader announces the answer once rather than
 *   narrating a slot machine.
 * - **Formats to the active locale**, so Spanish gets `1.234,5` rather than
 *   `1,234.5`. The locale comes from the document, not from a hardcoded default.
 */
export default function Counter({
  value,
  label,
  suffix = '',
  decimals,
  durationMs = 600,
  locale,
}: CounterProps) {
  const places = decimals ?? (Number.isInteger(value) ? 0 : 1)
  const [displayed, setDisplayed] = useState(() => (durationMs > 0 ? 0 : value))
  const frame = useRef<number | undefined>(undefined)

  useEffect(() => {
    const reduceMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (durationMs <= 0 || reduceMotion || !Number.isFinite(value)) {
      setDisplayed(value)
      return
    }

    const start = performance.now()
    const from = 0

    function step(now: number) {
      const elapsed = now - start
      const progress = Math.min(1, elapsed / durationMs)
      // easeOutQuad: fast at first, settling at the end, so the final value is
      // legible for most of the animation rather than only at the last frame.
      const eased = 1 - (1 - progress) * (1 - progress)
      setDisplayed(from + (value - from) * eased)
      if (progress < 1) {
        frame.current = requestAnimationFrame(step)
      }
    }

    frame.current = requestAnimationFrame(step)
    return () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    }
  }, [value, durationMs])

  const resolvedLocale =
    locale ?? (typeof document !== 'undefined' ? document.documentElement.lang || undefined : undefined)

  const format = (n: number) =>
    new Intl.NumberFormat(resolvedLocale, {
      minimumFractionDigits: places,
      maximumFractionDigits: places,
    }).format(n)

  return (
    <div className="flex flex-col">
      {/* The settled value, for assistive tech and for find-in-page. Announced
          once because the animated span is hidden from the accessibility tree. */}
      <output className="sr-only">
        {format(value)}
        {suffix}
      </output>
      <span aria-hidden="true" className="text-3xl font-semibold text-primary">
        {format(displayed)}
        {suffix}
      </span>
      {label ? <span className="text-sm text-secondary">{label}</span> : null}
    </div>
  )
}
