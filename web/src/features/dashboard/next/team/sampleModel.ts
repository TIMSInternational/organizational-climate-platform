/**
 * The ONE region of the leader's Panel de Control that no endpoint answers for this role:
 * the organisation's side of "Tu equipo frente a la organización" — the whole company's
 * mean per dimension for the same closed survey, and how many answered it.
 *
 * ## The endpoint that will provide it
 *
 * The company-wide row of a closed survey exists — `GET /surveys/climate-trends` returns
 * it as the `__company__` group, rolled up by `SurveyAggregation` — but that route answers
 * a `leader` 403 (measured on the local stack, 11 Sep 2026, as luis.mora@meridiano.test),
 * and `GET /surveys/{id}/results` is `CanAdminister` (`SurveyResultsEndpoints.cs:199-202`).
 * The field that replaces this file is an `organization` block on
 * `GET /dashboard/department-admin` (`DashboardEndpoints.LoadDepartmentAdminAsync`), computed
 * by the same `SurveyAggregation` the team's own `climate` block already uses — the
 * company-wide mean is not a sub-floor disclosure, so nothing about it needs a new rule.
 * Until then the page says so with the "Datos de muestra" chip on the organisation's
 * legend, and nowhere else: the team's numbers beside it are live.
 *
 * ## The values
 *
 * The canvas's (LeaderDashboard.dc.html, 10 Sep), which are Grupo Meridiano's Encuesta de
 * Clima Q3 company row as `GET /surveys/climate-trends` answered its administrator on
 * 10 Sep 2026 (`scripts/shot-fixtures/redesign-meridiano.json`), unrounded, so the page
 * rounds them the way it rounds the team's. Keyed by dimension so a survey that asked about
 * other dimensions simply gets no organisation bar, never a borrowed one.
 */
export const ORGANIZATION_SAMPLE: {
  readonly respondents: number
  readonly scores: Readonly<Record<string, number>>
} = {
  respondents: 24,
  scores: {
    belonging: 4,
    growth: 3.79,
    psychological_safety: 3.75,
    recognition: 3.38,
    trust: 3.67,
    workload: 3.33,
  },
}
