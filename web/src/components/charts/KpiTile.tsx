import { cn } from '../../lib/cn'
import { changeDirection, formatMetric, type MetricFormat } from './formatMetric'

/** Stands in for a reading that does not exist. Punctuation, so it needs no locale. */
const EM_DASH = '—'

/**
 * One reading in the KPI row that sits under every page header.
 *
 * ## Why this exists beside `KPIDisplay`
 *
 * They are not duplicates and neither should be deleted. `KPIDisplay` is a
 * *card grid*: it owns targets, progress bars, animated counters and an optional
 * way out of the card, and it is what a page uses when the KPI is the content.
 * `KpiTile` is the *strip* form from the redesign — a flat tile in a four-across
 * row between the page header and the work, where the number is context for what
 * is below rather than the subject.
 *
 * The distinction is deliberate because this project has previously shipped two
 * components for one job from two parallel lanes. So: the measurement semantics
 * are NOT re-derived here. Formatting and direction both come from
 * `formatMetric.ts`, the same module `KPIDisplay` uses, which is where
 * `higherIsBetter` is honoured — the legacy bug that painted rising attrition
 * green lives in exactly this decision and it is fixed in one place only.
 *
 * ## The typographic rule
 *
 * The value is set in `--admin-font-mono` with tabular figures; the label and the
 * sub-line stay in the sans face. That single rule is what makes the product read
 * as an instrument rather than a dashboard, so the value carries `font-mono
 * tabular-nums` explicitly rather than inheriting the tile's font. The delta does
 * too — a number that shifts width as it changes is the thing tabular figures
 * exist to prevent, and the delta is the number most likely to change in place.
 *
 * ## Colour never carries the change alone
 *
 * A rise renders green and a fall red, but always with an arrow glyph and the
 * magnitude beside it (WCAG 1.4.1). A reader who cannot separate the two hues
 * still gets the direction from the caret and the number.
 */
export interface KpiTileProps {
  /** Already-translated. This component never translates its own copy. */
  label: string
  /**
   * The reading.
   *
   * `null` when there is nothing to read, and it renders an em dash rather than a
   * zero. The two are different statements — "we measured, and it is none" against
   * "we could not measure" — and a tile that prints `0` for the second is asserting
   * a fact nobody established. `DashboardSurveyTable` reaches for the same em dash
   * for the same reason.
   */
  value: number | null
  /** How the number reads. Defaults to a plain localised number. */
  format?: MetricFormat
  /**
   * The previous period's value. When given, the tile renders a change indicator.
   * Omit it rather than passing the same number twice — "no change" and "no
   * comparison available" are different statements and should not look alike.
   */
  previousValue?: number
  /**
   * Whether a rise is good news. Defaults to true. Set false for attrition,
   * absenteeism, time-to-hire — anything where up is bad.
   */
  higherIsBetter?: boolean
  /**
   * The line under the value. Already-translated, and free-form because it is
   * doing different work per tile: a denominator ("175 of 208"), a due count, or
   * the name of the thing that is below target.
   *
   * Supply `changeLabel` instead when the sub-line is purely the period-on-period
   * change — that path gets the arrow and the colour.
   */
  sub?: React.ReactNode
  /** Already-translated period name for the change indicator, e.g. "since Q1". */
  changeLabel?: string
  /** BCP-47 locale. Defaults to the document's language. */
  locale?: string
  className?: string
}

export default function KpiTile({
  label,
  value,
  format = { kind: 'number' },
  previousValue,
  higherIsBetter = true,
  sub,
  changeLabel,
  locale,
  className,
}: KpiTileProps) {
  // A tile with no reading has no change either: there is no number to have moved.
  const direction =
    previousValue === undefined || value === null ? 'flat' : changeDirection(value, previousValue)
  const hasChange = previousValue !== undefined && direction !== 'flat'
  // `higherIsBetter` is what decides the tone, not the direction: a fall in
  // attrition is good news and must not render red.
  const isGoodNews = direction === 'up' ? higherIsBetter : !higherIsBetter
  const delta =
    previousValue === undefined || value === null ? 0 : Math.abs(value - previousValue)

  return (
    <div
      // Same `data-slot` convention the `ui/` primitives use (`badge`,
      // `page-top-bar`). A KPI strip is a row of near-identical tiles whose
      // labels — "Open", "Critical" — also appear as badges on the same screen,
      // so a test asserting the strip needs a handle that is not the label text.
      data-slot="kpi-tile"
      className={cn(
        // `surface-icon-box` is this project's existing recessed surface (the
        // badge `secondary` variant sits on it too), which is the role the
        // design's `--panel-2` plays. Reused rather than adding a near-duplicate
        // token for a shade nobody could tell apart.
        'rounded-lg border border-line-light bg-surface-icon-box p-3',
        className,
      )}
    >
      {/* `text-fg-secondary`, not `text-fg-tertiary`, and it is a contrast fix rather
          than a preference. Measured against `styles/tokens.css` on this tile's own
          recessed surface: `--admin-font-tertiary` is **3.42:1** in light (#818181 on
          #f0f0f0) and **3.68:1** in dark (#818181 on #2a2a2a). This line is 10px, so
          WCAG AA 1.4.3 wants 4.5:1 in both. `--admin-font-secondary` is 8.15:1 and
          6.85:1. The same swap `features/surveys/respondContrast.test.ts` made for the
          same reason — it bans `text-fg-tertiary` from that feature by name, and this
          component's first caller is a page inside it. */}
      <div className="text-2xs font-semibold uppercase tracking-label text-fg-secondary">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-3xl font-semibold tracking-tight tabular-nums">
        {value === null ? EM_DASH : formatMetric(value, format, locale)}
      </div>
      {/* Same measurement as the label above; this line is 11px. */}
      <div className="mt-px flex items-center gap-1 text-xs text-fg-secondary">
        {hasChange && (
          <span
            className={cn(
              'font-semibold',
              isGoodNews ? 'text-accent-green' : 'text-accent-red',
            )}
          >
            {/* The glyph, not the colour, is what carries the direction. */}
            <span aria-hidden="true">{direction === 'up' ? '▲' : '▼'}</span>{' '}
            <span className="font-mono tabular-nums">
              {formatMetric(delta, format, locale)}
            </span>
          </span>
        )}
        {changeLabel && <span>{changeLabel}</span>}
        {sub}
      </div>
    </div>
  )
}
