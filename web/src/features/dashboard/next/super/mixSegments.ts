import type { SurveyStatusKey } from '../../../org-structure/next/super/labels'
import type { StatusTone } from './derive'

/**
 * The status mix's bar, in the canvas's order. Blue for the live surveys and greys for the
 * rest: amber is the Oportunidad area (ruling 11 Nov). Each part carries meaning, so each
 * clears WCAG 1.4.11's 3:1 against the card in both themes, measured from `tokens.css`:
 * closed `fg-secondary` 9.09 / 10.01:1, draft `line-control` 3.62 / 3.89:1, archived an
 * OUTLINE in `line-control` (same ratio) so it reads apart from draft by shape, not by a
 * third grey too close to the other two. The legend names each one; colour is never the
 * only channel. (`line-hover` / `line-default` were 1.5 / 1.2:1 light, 1.65 / 1.3:1 dark.)
 */
export const SEGMENTS: ReadonlyArray<{ key: SurveyStatusKey; className: string }> = [
  { key: 'active', className: 'bg-accent-blue' },
  { key: 'closed', className: 'bg-fg-secondary' },
  { key: 'draft', className: 'bg-line-control' },
  { key: 'archived', className: 'border border-line-control bg-transparent' },
]

/** How loud a system's chip is, by its tone; all of it neutral ink, none of it a band colour. */
export const SYSTEM_CHIP_WEIGHT: Readonly<Record<StatusTone, string | undefined>> = {
  good: undefined,
  neutral: undefined,
  warning: 'border border-line-control bg-surface-card font-semibold text-fg-primary',
  critical: 'border border-fg-primary bg-fg-primary font-semibold text-surface-card',
}

