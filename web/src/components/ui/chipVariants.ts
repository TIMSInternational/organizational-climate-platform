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
 * The approved canvas's `.chip` (10 Sep, `shell.py`, drawn on every artboard) is
 * `height:22px; border-radius:6px; padding:0 8px; gap:6px; font-size:11px;
 * font-weight:500` with a 1px border in the tone's own tint — `rgba(18,148,91,.2)`
 * on the green chip, `rgba(221,12,21,.2)` on the red, `#e0dbee` on the neutral.
 * Here: `h-5.5` (5.5 × the 4px `--spacing` token = 22px), `rounded-lg`
 * (`--admin-radius-lg`, 6px), `px-2` (8px), `gap-1.5` (6px), `text-xs`
 * (`--admin-text-xs`, 11px) and `font-medium` (500). The first cut followed an
 * earlier prototype (20px, 600, a hairline on `neutral` only); beside the
 * artboards it read as a heavier, borderless tag.
 *
 * The borders are the `accent-*-ring` tokens, which ARE the canvas's tints
 * (`--admin-accent-border-green` is `rgba(18,148,91,.2)`), and the neutral one is
 * the default hairline. A border is not text, so `chipVariantContrast.test.ts`,
 * which measures fill against ink, is unaffected by it.
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
    'inline-flex h-5.5 w-fit shrink-0 items-center gap-1.5 whitespace-nowrap',
    'rounded-lg border px-2 text-xs font-medium',
    '[&>svg]:pointer-events-none [&>svg]:size-3',
  ),
  {
    variants: {
      tone: {
        good: 'border-accent-green-ring bg-chip-good-fill text-chip-good-ink',
        warning: 'border-accent-amber-ring bg-chip-warning-fill text-chip-warning-ink',
        critical: 'border-accent-red-ring bg-chip-critical-fill text-chip-critical-ink',
        accent: 'border-accent-blue-ring bg-chip-accent-fill text-chip-accent-ink',
        neutral: 'border-line-default bg-chip-neutral-fill text-chip-neutral-ink',
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
