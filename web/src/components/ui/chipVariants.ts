import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/cn'

/**
 * The status-chip class table (UI-0).
 *
 * Split from `chip.tsx` for the same reason `badgeVariants.ts` is split from
 * `badge.tsx`: oxlint's `react(only-export-components)` fails a module that
 * exports a component and a plain value together, and the lint budget here is a
 * hard ceiling shared across every lane.
 *
 * ## The five tones
 *
 * One per state the design names — `.ok .wa .cr .nu .ac` in the prototype. They
 * are spelled `good | warning | critical | neutral | accent` here so that
 * `charts/participation.ts`'s `bandStatus()`, which already returns
 * `'good' | 'warning' | 'critical'`, can be handed straight to `tone` with no
 * mapping table in between.
 *
 * ## Geometry
 *
 * The prototype's `.chip` is `height:20px; border-radius:6px; font-size:11px;
 * font-weight:600; padding:0 7px; gap:5px`. Here: `h-5` (5 × the 4px
 * `--spacing` token = 20px), `rounded-lg` (`--admin-radius-lg`, 6px, which the
 * token file already labels "badges, chips"), `text-xs` (`--admin-text-xs`,
 * 11px) and `font-semibold` (600). Padding and gap round to the nearest step on
 * the 4px scale — `px-1.5` is 6px against the prototype's 7, `gap-1` is 4px
 * against its 5. Neither is worth a one-off token; the 20px height, which is
 * what makes a chip line up with a table row, is exact.
 *
 * The transparent border is load-bearing, not decoration: `neutral` is the only
 * tone with a visible hairline, and without a transparent one on the other four
 * they would be 2px shorter than it.
 *
 * ## Why both the fill and the ink are chip tokens
 *
 * Neither half of the pair can come from the accent palette.
 *
 * The **ink** cannot, because the accent inks are chosen to clear 3:1 against
 * the PANEL — right for a border or an icon, not enough for 11px text.
 * `styles/badgeVariantContrast.test.ts` measures them at 3.49 / 2.99 / 3.41:1
 * in light.
 *
 * The **fill** cannot, because every `bg-accent-*-soft` is a translucent tint
 * (`--admin-accent-bg-green` is `rgba(16,185,129,0.08)`) and a translucent fill
 * renders whatever colour the surface behind it dictates. A chip has no fixed
 * surface: `ui/table.tsx`'s `TableRow` carries `hover:bg-state-hover`, so
 * hovering a row repaints the ground under every chip in it. Measured in
 * Chromium on `/dev/chart-gallery`, that took the `good` chip to 4.28:1 and
 * `warning` to 4.32:1 — both under 4.5 — while a guard compositing only over
 * the panel read them as passing. So each tone wears an opaque
 * `bg-chip-*-fill`, which is what the prototype's `.chip` uses too, paired with
 * a `text-chip-*-ink` measured against it. Worst pairing across both themes:
 * 5.59:1. `styles/chipVariantContrast.test.ts` re-derives all ten by reading
 * THIS table and resolving the classes back through `theme.css` and
 * `tokens.css` on four different surfaces, so re-pairing a tone here — or
 * pointing one at a translucent fill again — fails the build.
 */
export const chipVariants = cva(
  cn(
    'inline-flex h-5 w-fit shrink-0 items-center gap-1 whitespace-nowrap',
    'rounded-lg border border-transparent px-1.5 text-xs font-semibold',
    '[&>svg]:pointer-events-none [&>svg]:size-3',
  ),
  {
    variants: {
      tone: {
        good: 'bg-chip-good-fill text-chip-good-ink',
        warning: 'bg-chip-warning-fill text-chip-warning-ink',
        critical: 'bg-chip-critical-fill text-chip-critical-ink',
        accent: 'bg-chip-accent-fill text-chip-accent-ink',
        neutral: 'border-line-light bg-chip-neutral-fill text-chip-neutral-ink',
      },
    },
    defaultVariants: {
      tone: 'neutral',
    },
  },
)

export type ChipVariantProps = VariantProps<typeof chipVariants>

/** The tones, spelled out — `ChipVariantProps['tone']` also admits `null`. */
export type ChipTone = 'good' | 'warning' | 'critical' | 'accent' | 'neutral'
