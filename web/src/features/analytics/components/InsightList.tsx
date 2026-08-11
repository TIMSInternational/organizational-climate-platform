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
                'flex h-auto w-full items-stretch justify-start gap-0 overflow-hidden p-0 text-left',
                'rounded-lg border border-line-light bg-surface-icon-box',
                // The open card lifts onto the panel surface. `aria-current`
                // carries the same fact for anyone who cannot see the lift.
                selected && 'border-line-hover bg-surface-panel shadow-sm',
              )}
            >
              {/* The priority rail. Redundant with the badge below by design. */}
              <span
                aria-hidden="true"
                className={cn(
                  'w-1 shrink-0 self-stretch',
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
              <span className="flex min-w-0 flex-1 items-start gap-inline p-card">
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
