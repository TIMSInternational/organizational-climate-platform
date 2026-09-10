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
  /**
   * The unit or denominator printed on the value's own baseline — "de 5 · meta 3,7",
   * "respuestas · 100 % completadas". Already translated. The artboards (Dashboard
   * and SurveyResults, 10 Sep) put the unit beside the number and keep `sub` for
   * the one coloured sentence under it; a caller that has only a sentence leaves
   * this off.
   */
  unit?: React.ReactNode
  /**
   * The reading as text, for a tile whose reading is a name rather than a number — the
   * per-role canvas's "Q3" under *Última encuesta cerrada*. Wins over `value` when
   * given, and is still set in the instrument face.
   */
  valueText?: string
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
  unit,
  valueText,
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
        // The canvas's `.card`: the card surface with the default hairline, 14px
        // by 16px of padding, 8px radius. It shipped first on the recessed
        // `surface-icon-box`, which read as a tinted block beside the Dashboard
        // and SurveyResults artboards' white cards (10 Sep); both screens draw
        // this one primitive, so the surface is corrected here once.
        'rounded-lg border border-line-default bg-surface-card px-4 py-3.5',
        className,
      )}
    >
      {/* The artboards' tile eyebrow (Dashboard and SurveyResults, 10 Sep): 10px, bold,
          uppercase, spaced .12em (`tracking-tile`), in the label ink `text-fg-label`.

          Never `text-fg-tertiary`, and that is a contrast rule, not a preference:
          `--admin-font-tertiary` #818181 measured 3.42:1 (light) and 3.68:1 (dark) on
          the recessed surface this tile first sat on, where WCAG AA 1.4.3 wants 4.5:1
          for a 10px line. Failing in BOTH themes is what let it survive, and two lanes
          pinned it — `features/surveys/respondContrast.test.ts` and
          `features/surveys/resultsContrast.test.ts` each ban `text-fg-tertiary` from
          this file by name. The label ink on the card is measured there too ("the KPI
          tile label"): 5.44:1 in light.

          `data-slot="kpi-label"` is how a test finds a tile by its label: "Completed"
          is also a badge and a filter option on the list pages, so text alone is not. */}
      <div data-slot="kpi-label" className="text-2xs font-bold uppercase tracking-tile text-fg-label">
        {label}
      </div>
      {/* The unit shares the value's baseline, as the artboards draw it — never a
          second line, which is what `sub` is for. */}
      <div className="mt-1.5 flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-3xl font-medium tracking-tight tabular-nums">
          {valueText ?? (value === null ? EM_DASH : formatMetric(value, format, locale))}
        </span>
        {unit && <span className="text-sm text-fg-secondary">{unit}</span>}
      </div>
      {/* Same measurement as the label above; this line is 12px, the canvas's sentence size. */}
      <div className="mt-1.5 flex items-center gap-1 text-sm text-fg-secondary">
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
