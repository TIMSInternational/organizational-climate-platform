/**
 * The typed model behind the redesigned Clima en el tiempo (`/surveys/climate-trends`).
 *
 * Every number the page prints is derived from this shape in `derive.ts` — the wave
 * average, the deltas, "above / on / below target" — never typed as a string. The page
 * reads the model through `useClimateTrendsModel()`, the ONE place that talks to
 * `GET /surveys/climate-trends` (`api/climateTrends.ts`); the components below it never
 * fetch.
 *
 * Naming follows `features/dashboard/next/model.ts`: payload content is `name`, never
 * `title`/`label`, so `noHardcodedStrings.test.ts` does not read it as UI copy.
 */

/** One survey in the window, oldest first — the x-axis of every chart and a row of the table. */
export interface TrendWave {
  id: string
  /** The resolved survey title, or `null` when it has none; the view falls back to the date. */
  name: string | null
  /** ISO date the survey closed. */
  closedAt: string
  /** The survey's own completed count. Never a group's — see `climateTrends.ts`. */
  completedCount: number
  /** `closed` or `archived` — the server's window, not filtered here. */
  status: string
}

/** One dimension's reading per wave, aligned by index to `waves`. `null` is withheld or absent. */
export interface TrendDimension {
  key: string
  /** Resolved for display through `dimensionLabel`. */
  name: string
  values: readonly (number | null)[]
}

/** One entry of the segmented control: the whole company, then each department. */
export interface TrendGroup {
  key: string
  /** `null` for the whole company, which the view names in the reader's language. */
  name: string | null
}

export interface ClimateTrendsNextModel {
  /**
   * True while any figure on the page is the sample's. Today that is exactly the
   * target (`sampleModel.ts`): no endpoint holds a climate target yet.
   */
  isSample: boolean
  companyName: string | null
  /** The climate target on the 1–5 scale. */
  target: number
  /** The floor the server applied (`minimumGroupSize`), never a local constant. */
  floor: number
  waves: readonly TrendWave[]
  /** The dimensions of the selected group, in the server's column order. */
  dimensions: readonly TrendDimension[]
  groups: readonly TrendGroup[]
  selectedGroup: string
  /** Groups withheld in every wave — counted, not dropped. */
  suppressedGroupCount: number
}
