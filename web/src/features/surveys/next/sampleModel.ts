import type { ResultsSampleWave } from './model'

/**
 * SAMPLE DATA. This is not a measurement of anything.
 *
 * It stands in for the two readings the redesigned results page draws that no
 * endpoint returns today, and it is the reason the page wears a "sample data" chip
 * on those regions while `isSample` is true:
 *
 * | Region                                   | Endpoint that will provide it                       |
 * |------------------------------------------|-----------------------------------------------------|
 * | "vs Q2" deltas (average and per dimension)| `GET /surveys/climate-trends` (`climateTrends.ts`)  |
 * | rises in a row                           | `GET /surveys/climate-trends`                        |
 * | the opened group's 1–5 distribution      | none — `GET /surveys/{id}/statistics` carries a mean |
 * |                                          | per segment question, never a distribution           |
 *
 * The figures are the approved artboard's Grupo Meridiano numbers, so the screen can
 * be compared against the design. The dimension keys are the product's own slugs —
 * the keys of `surveyRespond.dimensions` in both catalogues, which `dimensionLabel.ts`
 * reads (`growth`, not `development`, is the product's word). A survey whose questions
 * carry other categories simply gets no delta on those columns, which the view prints
 * as "no Q2" rather than as 0 — so a shot fixture must carry the slugs, or the delta
 * cells are never drawn.
 */
export const sampleWave: ResultsSampleWave = {
  isSample: true,
  previousCode: 'Q2',
  averageDelta: 0.32,
  dimensionDeltas: {
    psychological_safety: 0.3,
    workload: 0.3,
    trust: 0.4,
    recognition: 0.3,
    growth: 0.3,
    belonging: 0.3,
  },
  risesInARow: 3,
  groupDistribution: [
    { position: 1, percentage: 20 },
    { position: 2, percentage: 40 },
    { position: 3, percentage: 25 },
    { position: 4, percentage: 10 },
    { position: 5, percentage: 5 },
  ],
}
