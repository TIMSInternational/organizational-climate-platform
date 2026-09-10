import type { ResultsSampleWave } from './model'

/**
 * SAMPLE DATA. This is not a measurement of anything.
 *
 * It stands in for the ONE reading the redesigned results page draws that no endpoint
 * returns today, and it is the reason the page wears a "sample data" chip on that
 * region — and on no other — while `isSample` is true:
 *
 * | Region                              | Endpoint that will provide it                          |
 * |-------------------------------------|--------------------------------------------------------|
 * | the opened group's 1–5 distribution | none — `GET /surveys/{id}/analytics` carries one mean  |
 * |                                     | per segment question (`SurveySegmentQuestionResult`),  |
 * |                                     | never a distribution                                   |
 *
 * The wave-over-wave readings this file used to stand in for — the change since the
 * previous wave per dimension, per group and for the whole company, and the rises in a
 * row — are measured now: `GET /surveys/climate-trends` names the previous wave and
 * carries the company's series, and that wave's own `GET /surveys/{id}/analytics`
 * gives its dimension and group means (`compose.ts` `composePrevious`). They are the
 * readings the Panel de Control prints for the same survey, from the same endpoint,
 * so the two screens cannot disagree about how much the climate moved.
 *
 * The distribution is the approved artboard's (Operaciones · Carga de trabajo), so the
 * screen can be compared against the design.
 */
export const sampleWave: ResultsSampleWave = {
  isSample: true,
  groupDistribution: [
    { position: 1, percentage: 20 },
    { position: 2, percentage: 40 },
    { position: 3, percentage: 25 },
    { position: 4, percentage: 10 },
    { position: 5, percentage: 5 },
  ],
}
