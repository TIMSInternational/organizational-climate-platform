import { Sparkles } from 'lucide-react'
import type { AIInsightListItem } from '../api/insights'
import { useTranslation } from '../../../i18n'
import { Badge } from '../../../components/ui'
import { cn } from '../../../lib/cn'
import {
  CRITICAL_PRIORITY,
  HIGH_PRIORITY,
  insightPriorityLabel,
  insightTypeLabel,
} from '../insightVocabulary'

export interface InsightListProps {
  insights: AIInsightListItem[]
  selectedId: string | null
  onSelect: (id: string) => void
}

/**
 * The insights, as a column of cards.
 *
 * ## Why cards and not the table this replaced
 *
 * A table gives every column the same weight, and on this screen they are not
 * equal: the *title* is the finding and everything else qualifies it. The card
 * puts the title on its own line under a row of chips, which is what the redesign
 * asks for and what makes a column of nine findings scannable.
 *
 * The card is the whole control. There is no separate "view details" button, so
 * the target is the size of the card rather than of two words, and the accessible
 * name of that control is the finding itself — a screen-reader user hears
 * "Critical, Risk, Open, Psychological safety in Support is falling fast" rather
 * than the ninth "View Details" on the page.
 *
 * ## What a card can and cannot say
 *
 * `AIInsightListItem` carries seven fields and none of them is the description,
 * the confidence, or the recommended actions — those exist only on
 * `AIInsightDetail`. So the evidence and the actions live in the panel beside this
 * list, which the page fetches for the selected row. That is the same reason the
 * table before it opened a detail rather than expanding in place; it has not
 * changed, and the card does not pretend otherwise by inventing a body line.
 *
 * ## Priority: a word first, colour only as reinforcement
 *
 * `priority` and `type` both go through `insightVocabulary.ts` (#282), so a value
 * reads "Crítica" in Spanish and an unrecognised one shows through verbatim rather
 * than as a raw key path.
 *
 * The badge itself is `outline` or `secondary` — the only two variants measured to
 * clear WCAG AA in *both* themes (`styles/badgeVariantContrast.test.ts`), and badge
 * text is 11px, so 4.5:1 is the bar. Priority is instead carried visually by the
 * rail down the card's left edge, which is a graphical object and owes 3:1:
 * `--admin-accent-red` on `--admin-bg-icon-box` measures **4.24:1 light, 3.81:1
 * dark** (and 4.83:1 / 4.76:1 on `--admin-bg-panel`, which is what the open card
 * sits on). Amber was tried there first and rejected — `--admin-accent-amber` on
 * the icon-box surface is **2.80:1** in light, below the graphical floor — so
 * `high` steps down through `--admin-font-tertiary` rather than through a second
 * hue. Colour never carries the priority on its own: the word is always in the
 * badge beside it.
 *
 * ## The open card is marked with the accent border, not with a surface lift
 *
 * The first attempt lifted the open card from `bg-surface-icon-box` onto
 * `bg-surface-panel` and gave it `border-line-hover` and `shadow-sm`. Measured on
 * the rendered page in dark, all three of those cues fail:
 *
 * - the two surfaces are `#2a2a2a` and `#171717`, **1.25:1** apart;
 * - `--admin-border-hover` `#444444` against the neighbouring cards' `#2a2a2a` is
 *   **1.47:1**, where WCAG 1.4.11 asks 3:1 of a state indicator;
 * - `shadow-sm` is `rgba(0,0,0,.4)`, which is invisible on a near-black ground.
 *
 * So the open card is bordered in `--admin-accent-blue` instead, which is the same
 * ink the shell already spends on "you are here": `--admin-focus-ring` is defined
 * as it, and index.css fills `.nav-row[data-nav-state='selected']` with it.
 * Measured against the three surfaces it actually touches — the page ground behind
 * the column was read off the rendered page, `#ffffff` light and `#171717` dark:
 *
 * | | its own fill | the ground | the closed cards |
 * |---|---|---|---|
 * | light `#0d9488` | 3.74:1 | 3.74:1 | 3.29:1 |
 * | dark `#14b8a6` | 7.20:1 | 7.20:1 | 5.77:1 |
 *
 * All six clear 3:1. The border is 2px on *every* card — `border-line-light` when
 * closed — so opening one cannot move the column by a pixel. The surface lift and
 * `aria-current` stay as the redundant cues they should always have been;
 * `shadow-sm` is gone, since a cue that only exists in one theme is not a cue.
 *
 * ## Hover
 *
 * The card is the only control on this screen and the only way into an insight, so
 * it has to answer the pointer. It could not: the plain `<button>` this replaced
 * inherited index.css's `button:hover:not(:disabled)` rule, but that lives in
 * `@layer base` and `bg-surface-icon-box` lives in `@layer utilities`, which wins
 * on layer order whatever the specificity — so the rewrite silently dropped the
 * hover it used to get for free.
 *
 * `--admin-bg-hover` is the token for this and it is *translucent* —
 * `rgba(0,0,0,.04)` light, `rgba(255,255,255,.06)` dark — so it darkens in light
 * and lightens in dark, always toward the reader. As a `hover:bg-state-hover`
 * background it would REPLACE the card's opaque fill and composite over the page
 * instead, which in light mode comes out *lighter* than the resting card. So it is
 * painted by an inset overlay layered over the card's own fill, which is what
 * `table.tsx`'s rows and `QuickActions` get for free by being transparent to begin
 * with. The overlay is `aria-hidden`, `pointer-events-none`, and its siblings are
 * `relative` so the content paints above it.
 */
export default function InsightList({ insights, selectedId, onSelect }: InsightListProps) {
  const { t } = useTranslation()

  return (
    <ul className="m-0 flex list-none flex-col gap-inline p-0">
      {insights.map((insight) => {
        const selected = insight.id === selectedId
        return (
          <li key={insight.id} className="mb-0">
            <button
              type="button"
              onClick={() => onSelect(insight.id)}
              aria-current={selected ? 'true' : undefined}
              className={cn(
                // `h-auto`, `justify-start`, `text-left`: index.css gives every
                // bare `button` a 32px centred row, which would crush the card.
                'group relative flex h-auto w-full items-stretch justify-start gap-0 overflow-hidden p-0 text-left',
                // `border-2` on both states so opening a card cannot shift the
                // column by the pixel a 1px→2px swap would cost.
                'rounded-lg border-2 border-line-light bg-surface-icon-box',
                // The open card. `aria-current` carries the same fact for anyone
                // who cannot see it.
                selected && 'border-accent-blue bg-surface-panel',
              )}
            >
              {/* The hover tint, over the card's OWN fill rather than over the
                  page — see the header. `transition-colors` is stopped by
                  index.css's prefers-reduced-motion block. */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 transition-colors group-hover:bg-state-hover"
              />
              {/* The priority rail. Redundant with the badge below by design. */}
              <span
                aria-hidden="true"
                className={cn(
                  'relative w-1 shrink-0 self-stretch',
                  // Compared against the shared wire values, not against a
                  // literal: the headline count on the page matches the same
                  // constant, and a rail painted from `'Critical'` would silently
                  // disagree with a tile counting `'critical'`.
                  insight.priority === CRITICAL_PRIORITY
                    ? 'bg-accent-red'
                    : insight.priority === HIGH_PRIORITY
                      ? 'bg-fg-tertiary'
                      : 'bg-line-default',
                )}
              />
              <span className="relative flex min-w-0 flex-1 items-start gap-inline p-card">
                <span className="flex size-icon-box shrink-0 items-center justify-center rounded-md border border-line-light bg-surface-panel text-fg-tertiary">
                  <Sparkles aria-hidden="true" className="size-icon" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-1">
                    <Badge variant="outline">{insightPriorityLabel(t, insight.priority)}</Badge>
                    <Badge variant="secondary">{insightTypeLabel(t, insight.type)}</Badge>
                    <Badge variant="secondary">
                      {insight.isAcknowledged ? t('insights.acknowledged') : t('insights.open')}
                    </Badge>
                  </span>
                  <span className="text-base font-semibold text-fg-primary">{insight.title}</span>
                  <span className="text-xs text-fg-tertiary">{insight.category}</span>
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
