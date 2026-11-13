import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { chipVariants, type ChipTone } from './chipVariants'

/**
 * A status chip: one word, in a soft tint that agrees with it.
 *
 * ## Why this is a new component and not a sixth Badge variant
 *
 * Weighed honestly, and both answers were defensible. `Badge` and `Chip` are
 * near-identical boxes. What decided it:
 *
 * 1. **The variants would have to be repainted, and Badge is load-bearing.**
 *    `Badge`'s hued variants take their ink from the accents, and
 *    `styles/badgeVariantContrast.test.ts` measures three of them failing WCAG
 *    AA in light (3.49 / 2.99 / 3.41:1) and `destructive` failing in dark
 *    (3.76:1). A chip that passes cannot reuse those pairings, so "extend
 *    Badge" really means "re-ink Badge", and Badge has 50 call sites across 34
 *    files. Repainting a primitive under 34 pages is its own change with its own
 *    review; doing it as a side effect of adding a chip is how a shared
 *    primitive drifts.
 * 2. **The contracts differ where it matters.** `Badge` takes `children` and an
 *    `asChild` escape hatch, so it can hold an icon and nothing else. A status
 *    chip must always carry a word — see below — which is expressed here by
 *    `label` being a required `string`. That is not a variant of Badge's
 *    contract, it is a narrower one.
 * 3. `Badge`'s six variants are a general vocabulary (`outline`, `secondary`,
 *    `default`); the five tones here are a closed set of *states*. Merging them
 *    would give one component eleven variants and no way to tell a caller which
 *    five mean "state".
 *
 * So: `Badge` keeps every existing call site untouched, and `Chip` is what the
 * redesign's screens compose against. If Badge's inks are ever fixed, the two
 * can merge — that is a deliberate follow-up, not a debt this hides.
 *
 * ## Colour never carries the state alone
 *
 * `label` is required and is rendered as text, always. WCAG 1.4.1 (Use of
 * Colour) is the reason, and it is also why the icon is optional and
 * `aria-hidden`: a reader who cannot separate amber from red still reads the
 * word. There is deliberately no icon-only form and no `children` — a chip with
 * a glyph and no word is exactly what this component exists to make
 * unspellable.
 *
 * ## What it does not do
 *
 * It does not translate. `label` arrives already translated, like every other
 * `ui/` primitive's copy, because these have no translation context of their own.
 */
/**
 * `live` is not a sixth colour: it is the `accent` pair (`#1d4ed8` on `#e9effd`, 5.82:1;
 * dark `#7aaeff` on `#1d3262`, 5.54:1 — both measured by `styles/chipVariantContrast.test.ts`
 * as the accent tone) with the canvas's 6px dot before the word (`.chip.live::before`). It is
 * the ONE status chip that is blue — Activa, a survey that is open now — because blue means
 * live (the user's ruling of 11 Nov); every other status is `neutral`.
 */
export type ChipStatusTone = ChipTone | 'live'

export interface ChipProps extends Omit<ComponentProps<'span'>, 'children'> {
  /**
   * The word. **Already translated**, and required: the colour is never the
   * only carrier of the state.
   */
  label: string
  /** Which state. Defaults to `neutral`. `live` is for Activa / open-now only. */
  tone?: ChipStatusTone
  /**
   * An optional glyph before the word. Rendered `aria-hidden`, because the word
   * beside it already says the same thing and a screen reader should not hear it
   * twice. Drawn 13px (3.25 x the 4px `--spacing` token).
   */
  icon?: ReactNode
}

export function Chip({ label, tone, icon, className, ...props }: ChipProps) {
  const live = tone === 'live'
  return (
    <span
      data-slot="chip"
      data-live={live || undefined}
      className={cn(
        chipVariants({ tone: live ? 'accent' : tone }),
        // The live dot: 6px, the word's own ink, decoration (the word says "Activa").
        live && "before:size-1.5 before:shrink-0 before:rounded-full before:bg-current",
        className,
      )}
      {...props}
    >
      {icon && (
        <span aria-hidden="true" className="inline-flex shrink-0 items-center [&>svg]:size-3.25">
          {icon}
        </span>
      )}
      {label}
    </span>
  )
}
