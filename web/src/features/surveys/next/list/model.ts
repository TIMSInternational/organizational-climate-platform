import type { SurveyListItem } from '../../api/surveys'

/**
 * The typed model behind the redesigned Todas las Encuestas (`/surveys/next`).
 *
 * The rows are `GET /surveys` verbatim (`SurveyListItem`, `api/surveys.ts`) — the
 * payload already carries everything the design prints. What the design adds is
 * *order* and *one action per row*, and both are derived in `derive.ts`, never typed.
 * The page reads the model through `useSurveysListModel()`, the one place that
 * fetches; nothing here is a sample, so there is no `isSample` and no chip.
 */
export type SurveyRow = SurveyListItem

/** The four blocks of the list, in the order the design stacks them. */
export type SurveySection = 'open' | 'upcoming' | 'closed' | 'archived'

export interface SurveysListNextModel {
  companyName: string | null
  /** Every row the server returned, in the design's order (`orderSurveys`). */
  rows: readonly SurveyRow[]
}
