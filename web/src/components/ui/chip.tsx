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
export interface ChipProps extends Omit<ComponentProps<'span'>, 'children'> {
  /**
   * The word. **Already translated**, and required: the colour is never the
   * only carrier of the state.
   */
  label: string
  /** Which state. Defaults to `neutral`. */
  tone?: ChipTone
  /**
   * An optional glyph before the word. Rendered `aria-hidden`, because the word
   * beside it already says the same thing and a screen reader should not hear it
   * twice.
   */
  icon?: ReactNode
}

export function Chip({ label, tone, icon, className, ...props }: ChipProps) {
  return (
    <span data-slot="chip" className={cn(chipVariants({ tone }), className)} {...props}>
      {icon && (
        <span aria-hidden="true" className="inline-flex shrink-0 items-center">
          {icon}
        </span>
      )}
      {label}
    </span>
  )
}
