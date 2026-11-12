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
 * ## Geometry (the Apple design, 11 Nov)
 *
 * `occ.css` `.chip`: `height: 22px; padding: 0 8px; border-radius: 11px; font-size: 12px;
 * font-weight: 600` on the tone's own fill, **with no border**. Here: `h-5.5` (22px on the
 * 4px `--spacing` unit), `px-2`, `rounded-lg` (`--admin-radius-lg`, 10px — the chip radius
 * the token layer names), `text-xs` (12px) and `font-semibold`.
 *
 * The 10 Sep canvas drew a 1px tinted border and 11px at 500; the Apple design drops the
 * border — a chip is a word on a tint, not a control — and sets the word at 600 so 12px
 * holds up on the tint. A chip that needs a border (a selectable pill) adds one at its call
 * site.
 *
 * ## Which tone is which colour
 *
 * One colour, one meaning (the user's ruling of 11 Nov):
 *
 * - `good` / `warning` / `critical` are the three RESULT AREAS — Fortaleza, Oportunidad,
 *   Crítica — and nothing else. Their chip tokens carry the band values (`--admin-chip-bg-good`
 *   is `--admin-band-str-bg`'s `#e6f4ea`, its ink `#156b32`; dark `#1c3b3f` / `#6bd68f`), so a
 *   band chip and a band cell are the same green. A result area is never colour alone: the
 *   band chip with its glyph and name lives in `charts/` (`BandChip`).
 * - `accent` is the blue tint; `Chip`'s `tone="live"` draws it with the live dot, for Activa.
 * - `neutral` is every other status: Borrador, Programada, Cerrada.

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
    'rounded-lg px-2 text-xs font-semibold',
    '[&>svg]:pointer-events-none [&>svg]:size-3',
  ),
  {
    variants: {
      tone: {
        good: 'bg-chip-good-fill text-chip-good-ink',
        warning: 'bg-chip-warning-fill text-chip-warning-ink',
        critical: 'bg-chip-critical-fill text-chip-critical-ink',
        accent: 'bg-chip-accent-fill text-chip-accent-ink',
        neutral: 'bg-chip-neutral-fill text-chip-neutral-ink',
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
