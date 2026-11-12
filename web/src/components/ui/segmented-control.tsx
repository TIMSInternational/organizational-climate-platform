import { useRef, type ComponentProps, type KeyboardEvent } from 'react'
import { cn } from '../../lib/cn'

/**
 * The Apple design's segmented control (`occ.css` `.seg`): two to about five closely related
 * choices — a status filter, a period, a view — drawn as one pill with the chosen segment
 * raised out of it.
 *
 * NOT `SegmentedScale`. That is the respondent's 1-5 answer: a `radiogroup` whose value is
 * submitted. This is a view control: what it changes is what the screen shows.
 *
 * ## Semantics: a group of toggle buttons
 *
 * `role="group"` named by `label`, each segment a `<button type="button">` with
 * `aria-pressed` — the canvas's own markup (`Surveys.dc.html`: `<div class="seg"
 * role="group" aria-label="Filtrar por estado"><button aria-pressed="true">`), and the WAI-ARIA
 * toggle-button pattern. Not a `tablist`: a tab owns a panel (`aria-controls`), and this
 * re-filters the panel that is already there. Use `Tabs` when each choice is its own panel.
 *
 * ## Keyboard
 *
 * Every segment is a native button, so Tab reaches each one and Enter/Space chooses it.
 * ArrowLeft/ArrowRight (and Home/End) also move focus between the segments, skipping a
 * disabled one, **without choosing** — choosing re-queries a list on most screens, and a
 * request per arrow press is not what anyone pressing an arrow meant.
 *
 * ## Drawing
 *
 * HIG `segmented-controls.md` § "Best practices": equal-weight segments, nouns for labels,
 * "no more than about five to seven segments in a wide interface". The canvas: a 2px inset
 * track, 28px segments (`h-control-md`), 13px medium labels, the chosen one raised on the card
 * ground with a shadow and set semibold.
 *
 * The track is the recessed tile (`bg-surface-icon-box`) and not the canvas's `--fill`,
 * deliberately. The chosen segment must read as RAISED in both themes — HIG `dark-mode.md`:
 * "the elevated colors are brighter, making foreground interfaces appear to advance". On
 * `--fill` the card ground is brighter than the track in light (#ffffff over #ececed) but
 * DARKER in dark (#18213a under #2d3549, 1.31:1 the wrong way), so the chosen segment would
 * sink into the track. On the recessed tile the card ground is the brighter of the two in
 * both themes (#ffffff over #f5f5f7; #18213a over #0f1626). The track's hairline
 * (`border-line-light`) and the chosen segment's (`border-line-default`) carry the shapes,
 * since neither fill differs from its neighbour by much more than 1.1:1 — the selection is
 * also told by weight (600 against 500), and to assistive technology by `aria-pressed`.
 *
 * Touch: under `pointer-coarse` each segment grows to 44px (HIG `buttons.md`: "a hit region
 * of at least 44x44 pt").
 */
export interface SegmentedOption<T extends string> {
  value: T
  /** **Already translated.** A noun or a noun phrase (HIG). */
  label: string
  disabled?: boolean
}

export type SegmentedControlProps<T extends string> = Omit<
  ComponentProps<'div'>,
  'onChange' | 'children' | 'defaultValue' | 'role'
> & {
  /** The group's accessible name. **Already translated.** */
  label: string
  value: T
  options: readonly SegmentedOption<T>[]
  onChange: (value: T) => void
  /** Stretch to the container, every segment the same width. */
  fullWidth?: boolean
  /** Disable every segment. */
  disabled?: boolean
}

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  fullWidth = false,
  disabled = false,
  className,
  ...props
}: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  function enabled(index: number): boolean {
    return !disabled && !options[index]?.disabled
  }

  function moveFocus(from: number, step: 1 | -1) {
    for (let offset = 1; offset <= options.length; offset++) {
      const index = (from + step * offset + options.length) % options.length
      if (enabled(index)) {
        refs.current[index]?.focus()
        return
      }
    }
  }

  function edge(first: boolean) {
    const order = options.map((_, index) => index)
    const index = (first ? order : order.reverse()).find(enabled)
    if (index !== undefined) refs.current[index]?.focus()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault()
        moveFocus(index, 1)
        break
      case 'ArrowLeft':
        event.preventDefault()
        moveFocus(index, -1)
        break
      case 'Home':
        event.preventDefault()
        edge(true)
        break
      case 'End':
        event.preventDefault()
        edge(false)
        break
    }
  }

  return (
    <div
      role="group"
      aria-label={label}
      data-slot="segmented-control"
      className={cn(
        'items-center gap-0.5 rounded-lg border border-line-light bg-surface-icon-box p-0.5',
        fullWidth ? 'flex w-full' : 'inline-flex',
        className,
      )}
      {...props}
    >
      {options.map((option, index) => {
        const pressed = option.value === value
        return (
          <button
            key={option.value}
            ref={(element) => {
              refs.current[index] = element
            }}
            type="button"
            data-slot="segmented-control-item"
            aria-pressed={pressed}
            disabled={!enabled(index)}
            onClick={() => {
              if (!pressed) onChange(option.value)
            }}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              // index.css cards every bare <button>: each of these declarations replaces one
              // of that rule's (height, padding, radius, border, ground, type).
              'inline-flex h-control-md items-center justify-center whitespace-nowrap rounded-md border px-3',
              'text-sm text-fg-primary',
              'transition-[background-color,border-color,box-shadow] ease-out',
              'pointer-coarse:min-h-11',
              'disabled:cursor-not-allowed disabled:opacity-45',
              fullWidth && 'flex-1',
              pressed
                ? 'border-line-default bg-surface-card font-semibold shadow-sm'
                : 'border-transparent bg-transparent font-medium hover:not-disabled:bg-state-hover',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
