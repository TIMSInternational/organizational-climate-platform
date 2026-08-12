import type { TranslateFn, TranslateParams } from '../../../i18n'

/**
 * The layout grammar every dashboard shares.
 *
 * The redesign gives all four role dashboards the same shape — `PageTopBar` (eyebrow /
 * title / one line / actions), then a four-across row of `KpiTile` in mono, then the
 * work — and these are the pieces of that shape which are not already components.
 *
 * They live here rather than in `CompanyAdminDashboardView` because they were private to
 * it while three of the four views rendered the *old* `KPIDisplay` card grid, so the
 * grammar existed once and applied to one screen. Sharing it is what stops this becoming
 * four divergent copies of a section heading, which is exactly what happened to
 * `PageTopBar` when twelve lanes each wrote their own (five byte-identical, two divergent,
 * and those two were the only merge conflicts of the wave).
 */

/**
 * A section heading inside a dashboard.
 *
 * `text-base` — this theme's 13px shell default — rather than the bare `h2` rule's 20px,
 * because the redesign's section headings are deliberately quieter than its readings. A
 * heading that competes with the number beside it is the thing that made the old screens
 * read as a page of boxes rather than an instrument.
 */
export function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-inline text-base">{children}</h2>
}

/**
 * The four-across KPI row.
 *
 * One breakpoint ladder, in one place: a single column on a phone, two on a small tablet,
 * four from `xl`. The old `KPIDisplay` took a `columns` prop, which is how the department
 * view ended up with five cards wrapping 3-then-2 — a ragged second row directly under a
 * heading. Four-across is the design's row, so the count is not a caller's choice.
 */
export function KpiRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-panel-gap sm:grid-cols-2 xl:grid-cols-4">{children}</div>
  )
}

/**
 * The substitution marker. U+241F is the *printable symbol for* the unit separator, a
 * character no sentence in either catalogue contains — checked against both files — and
 * one no author would reach for, which is why it is safe to split on.
 */
const READING_MARK = '␟'

/**
 * A translated sentence whose interpolated numbers are set in mono, and its prose is not.
 *
 * The thesis of the redesign is that every *reading* is `font-mono tabular-nums` and every
 * piece of prose stays in the sans face — that one rule is what makes the product read as
 * a measuring device. `KpiTile` and `ClimateMap` honour it because they are handed a
 * number and render it themselves. A sentence like "{completed} completed responses from
 * {people} people" does not: `t` returns one flat string, so the readings inside it come
 * out in the sans face.
 *
 * Splitting on the placeholders in the *English* would not survive translation — the
 * Spanish puts them in a different order and a different sentence. So each numeric value
 * is substituted as a marker, the catalogue does the ordering, and the markers are swapped
 * back for mono spans afterwards. String params (a department name) are prose and pass
 * straight through.
 *
 * ## Why the numbers are localised here and were not before
 *
 * This used to stringify with `String`, on the reasoning that it should change the typeface
 * and nothing else about what `t` would have printed. That held while every caller passed a
 * count in the hundreds. It stops holding at platform scale: the SuperAdmin row renders
 * `COMPLETED RESPONSES 1,102` from `KpiTile` — which formats through the locale — directly
 * above a sub-line reading `of 1284 started`. One tile, two number formats, which is the
 * opposite of what tabular figures are for.
 *
 * So numbers are formatted the way the tile above them formats theirs. `locale` is optional
 * and `toLocaleString` falls back to the runtime default without it, which is what the
 * existing sub-hundred callers were already getting from `String`.
 */
export function MonoReadings({
  t,
  messageKey,
  params,
  locale,
}: {
  t: TranslateFn
  messageKey: string
  params: TranslateParams
  locale?: string
}) {
  const readings: string[] = []
  const marked: TranslateParams = {}
  for (const [name, value] of Object.entries(params)) {
    if (typeof value === 'number') {
      marked[name] = `${READING_MARK}${readings.length}${READING_MARK}`
      readings.push(value.toLocaleString(locale))
    } else {
      marked[name] = value
    }
  }

  // One `<span>` and not a fragment. `KpiTile` lays its sub-line out as a flex row, so a
  // fragment put every prose piece and every reading in as its OWN flex item: measured in
  // Spanish at 1280, "262 respuestas completadas de 208 personas" broke into two columns
  // with the sentence wrapping inside the first. Wrapped, it is one inline run that simply
  // wraps as text.
  //
  // Every marker contributes exactly two elements to the split, so the readings are always
  // at the odd indices however many there are and wherever the catalogue put them —
  // including two of them side by side, which yields an empty prose piece between rather
  // than breaking the alternation.
  return (
    <span>
      {t(messageKey, marked)
        .split(READING_MARK)
        .map((piece, index) =>
          index % 2 === 1 ? (
            <span key={index} className="font-mono tabular-nums">
              {readings[Number(piece)]}
            </span>
          ) : (
            piece
          ),
        )}
    </span>
  )
}
