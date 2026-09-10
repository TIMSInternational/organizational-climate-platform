/**
 * The typed model behind the redesigned Clima en el tiempo (`/surveys/climate-trends`).
 *
 * Every number the page prints is derived from this shape in `derive.ts` — the wave
 * average, the deltas, "above / on / below target" — never typed as a string. The page
 * reads the model through `useClimateTrendsModel()`, the ONE place that talks to
 * `GET /surveys/climate-trends` (`api/climateTrends.ts`) and `GET /surveys`; the
 * components below it never fetch.
 *
 * Nothing here is a sample. The target is the product's `CLIMATE_TARGET`
 * (`features/dashboard/next/compose.ts`), the same constant the Panel de Control reads,
 * so the two screens can never disagree about "meta 3,7"; no company setting holds a
 * target yet, and the table's footnote says so.
 *
 * Naming follows `features/dashboard/next/model.ts`: payload content is `name`, never
 * `title`/`label`, so `noHardcodedStrings.test.ts` does not read it as UI copy.
 */

/** One CLOSED survey in the window, oldest first — the x-axis of every chart and a row of the table. */
export interface TrendWave {
  id: string
  /** The short code the cycle is discussed in — "Q3" out of "Encuesta de Clima Q3" (`waveCode`). */
  code: string
  /** The resolved survey title, or `null` when it has none; the view falls back to the code. */
  name: string | null
  /** ISO date the survey closed. */
  closedAt: string
  /** The survey's own completed count. Never a group's — see `climateTrends.ts`. */
  completedCount: number
}

/** One dimension's reading per wave, aligned by index to `waves`. `null` is withheld or not asked. */
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

/** The survey open now, which joins the series when it closes. */
export interface OpenWave {
  code: string
  /** ISO date it closes. */
  closesAt: string
}

export interface ClimateTrendsNextModel {
  companyName: string | null
  /** The climate target on the 1–5 scale — `CLIMATE_TARGET`. */
  target: number
  /** The floor the server applied (`minimumGroupSize`), never a local constant. */
  floor: number
  /**
   * The closed waves. An archived survey is never one: the server's window carries
   * `closed` and `archived` alike (`SurveyClimateTrends.cs`), and the list's own
   * footnote promises that an archived survey does not count here — `withoutArchived`.
   */
  waves: readonly TrendWave[]
  /** Per wave, for the selected group: `true` when the floor withheld the whole wave. */
  withheld: readonly boolean[]
  /**
   * Per wave, for the selected group: the respondents behind its readings, and `null`
   * when the floor withheld the wave — a withheld group's count travels no further
   * than the server's own `respondentCount: 0`, and the page never prints one.
   */
  respondents: readonly (number | null)[]
  /**
   * The dimensions of the selected group, ordered by the whole company's latest reading,
   * highest first — the canvas's order, and one that stays put when a segment is chosen.
   */
  dimensions: readonly TrendDimension[]
  groups: readonly TrendGroup[]
  selectedGroup: string
  /** Departments withheld in every closed wave — counted, not dropped. */
  suppressedGroupCount: number
  /** The survey open now, or `null` when none is or `GET /surveys` could not say. */
  openWave: OpenWave | null
}
