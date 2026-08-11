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
 * ## Why the ink is a chip token and not the accent
 *
 * Every hued fill here is a `bg-accent-*-soft` — an 8%/10% tint, i.e. very
 * nearly the panel. The accent inks are chosen to clear 3:1 against the PANEL,
 * which is right for a border or an icon and not enough for 11px text:
 * `styles/badgeVariantContrast.test.ts` measures them at 3.49 / 2.99 / 3.41:1
 * in light. So each tone wears `text-chip-*-ink`, a token picked against the
 * fill below it in each theme. Worst measured pairing 4.64:1 against WCAG AA
 * 1.4.3's 4.5. `styles/chipVariantContrast.test.ts` re-derives all ten pairings
 * by reading THIS table and resolving the classes back through `theme.css` and
 * `tokens.css`, so re-pairing a tone here fails the build.
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
        good: 'bg-accent-green-soft text-chip-good-ink',
        warning: 'bg-accent-amber-soft text-chip-warning-ink',
        critical: 'bg-accent-red-soft text-chip-critical-ink',
        accent: 'bg-accent-blue-soft text-chip-accent-ink',
        neutral: 'border-line-light bg-surface-icon-box text-chip-neutral-ink',
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
