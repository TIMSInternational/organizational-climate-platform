import type { SurveyListItem } from '../../api/surveys'

/**
 * The typed model behind the redesigned Todas las Encuestas (`/surveys`).
 *
 * The rows are `GET /surveys` verbatim (`SurveyListItem`, `api/surveys.ts`) — the
 * payload already carries everything the design prints but one line: the climate move
 * under a closed survey's date ("+0,29 frente a Q2"), which is read from
 * `GET /surveys/climate-trends` (`WaveReading`, `derive.ts` `waveReadings`). What the
 * design adds is *order* and *one action per row*, both derived in `derive.ts`, never
 * typed. The page reads the model through `useSurveysListModel()`, the one place that
 * fetches; nothing here is a sample, so there is no `isSample` and no chip.
 */
export type SurveyRow = SurveyListItem

/** The four blocks of the list, in the order the design stacks them. */
export type SurveySection = 'open' | 'upcoming' | 'closed' | 'archived'

/** One closed survey's climate reading, against the closed survey before it. */
export interface WaveReading {
  /** The first closed wave in the window: "primera medición", nothing to compare with. */
  first: boolean
  /** Its climate average minus the previous wave's, or `null` when either is withheld. */
  delta: number | null
  /** The previous wave's short code ("Q2"), or `null` for the first. */
  previousCode: string | null
  /** Completed responses on the wire (`ClimateTrendSurvey.completedCount`). */
  completedCount: number
}

export interface SurveysListNextModel {
  companyName: string | null
  /** Every row the server returned, in the design's order (`orderSurveys`). */
  rows: readonly SurveyRow[]
  /**
   * Keyed by survey id. Empty until the trends payload arrives, and for a viewer who
   * may not read it (a leader, a super admin with no company chosen): those rows print
   * no move at all rather than a sample one.
   */
  readings: ReadonlyMap<string, WaveReading>
}
