# Decision: the privacy floor is 3 respondents, not 5

> **Two later rulings moved where the floor applies, not the number.** 2026-10-15 (client): a
> single department or single demographic value is shown to administrators from **1**
> respondent. 2026-10-21 (Federico): a leader or supervisor reading their own team is held to
> **3** again. Both are recorded at the end of this file; the current map is
> [Where the floor of 3 applies today](#where-the-floor-of-3-applies-today).

Ruled by Federico 2026-10-13: *"the umbral de privacidad number is actually 3 — change it
platform-wide."* Scope confirmed the same day: segments, the dashboard, exports, microclimates
and the whole-survey minimum. Recorded with the code that implements it.

## What it is

Two constants carry it on the API side and everything else derives from them:

- `DemographicSnapshotPrivacy.MinimumGroupSize` — feeds `SurveyResponsePrivacy.MinimumCohortSize`
  (write-time cohort floor), `SurveyResultsPrivacy.MinimumSegmentRespondents` (read-time crosses
  and the complement rule) and `DashboardEndpoints.DepartmentCountFloor` (the leader's and
  supervisor's team view — see "Where the floor of 3 applies today" below; between 2026-10-15
  and 2026-10-21 it derived from the single-segment floor of 1 instead).
- `SurveyResultsPrivacy.MinimumRespondents` — the whole-survey floor.

Two on the web side: `ANONYMITY_FLOOR` (`components/charts/suppression.ts`) and
`MINIMUM_RESPONDENTS` (`features/microclimates/microclimatePrivacy.ts`).

`Microclimate.RealtimeSettings.ParticipationThreshold` was **already 3** and is unchanged.
`MinimumWordRespondents` stays 2 — one below the segment floor rather than three below it, which
`SurveyResultsPrivacyTests` still asserts, but only just.

## What it supersedes, and what it costs

`DemographicSnapshotPrivacy` carried a reasoned argument for 5 over 3, and that argument was not
wrong: a microclimate's threshold of 3 gates *aggregate sentiment* for one question across a whole
audience, where the only quasi-identifier is audience membership, whereas these are demographic
group counts and demographic quasi-identifiers **combine** — department × role × tenure narrows a
workforce far faster than any one of them, and a snapshot is designed to be cross-referenced
against the next one.

That reasoning is kept in place as the price of this ruling rather than deleted, so nobody
re-derives it as a discovery. Concretely: a cell of exactly 3 in department × tenure is now
disclosed where it used to be withheld, and on a roster like EAGLE's (12 departments × 6 tenure
bands) materially more cells become readable. That is the intended effect — the client wants the
segments visible — and it is the client's decision to take. Raising it back is a one-line change
per side.

`DemographicSnapshotPrivacyTests`' "the threshold is higher than the microclimate participation
floor" is inverted rather than removed: the two floors being EQUAL is now the decision, and a test
asserting it is what stops the next reader restoring the gap as an obvious correction.

## The decision records this supersedes on the number only

`dashboard-sharing`, `leader-supervisor-scope`, `participation-is-not-linked-to-answers`,
`public-report-share-shape`, `self-declared-demographics`, `self-signup-gate`,
`who-may-see-an-individual-answer`, `public-surface-copy`. Each now carries a pointer here. Their
reasoning stands as written; only the threshold moved. `docs/audits/` is deliberately untouched —
an audit records what the system was on its date.

## How the tests were moved, because it is not obvious

A fixture count of 4 meant "withheld" at a floor of 5 and means "disclosed" at 3. So every
boundary fixture moved **with** the number; no expectation was raised to match whatever the code
now did. Three tests were found to have stopped being boundary tests at all — two in
`EmployeeHomeView` and an `it.each` case in `ProtectedCell` that passed only because the fixture
value `74` contains no digit `3`. Those are the dangerous ones: they were green.

Three screens deliberately do **not** read the platform constant. `ClimateTrendsNextPage`,
`SurveyCrossPanel` and `LeaderDashboardView` print the floor the SERVER applied
(`minimumGroupSize`), because a company may be held to a HIGHER floor than the platform minimum.
Their tests use a server floor above the minimum, not the constant — binding them to the constant
would pass for a screen that ignored the payload entirely, deleting half the rule.

## 2026-10-15 — a single department or demographic value is shown from 1 respondent

**Ruled by the client** (ESPH call), in these words, quoted in code at
`SurveyResultsPrivacy.MinimumSingleSegmentRespondents`
(`src/ClimateProject.Application/Surveys/SurveyResultsPrivacy.cs`): *"siempre deberían enseñar los
resultados de los climas de los departamentos, aunque sea una persona… El demográfico en general
le tiene que entregar un resultado, así sea una persona… Esa condicionante de 3 es para los cruces
de variables de demográficos, no para los resultados individuales de los demográficos. No debería
bloquearse nunca."*

`MinimumSingleSegmentRespondents = 1` governs one dimension at a time on the administrators'
results, climate-map, trends and report surfaces. The floor of 3 stayed on crosses
(`SurveyResultsFilter.MayDisclose`), the whole survey (`MinimumRespondents`) and public links
(`PublicReportDocument`, re-floored to at least `MinimumSegmentRespondents`). The cost is
recorded beside the constant: a department where one of twenty answered prints that person's
answers, and the roster of who finished can identify them.

## 2026-10-21 — a leader's or supervisor's own team is held to 3

**Ruled by Federico. Owner: Federico.** The 2026-10-15 ruling is about **administrators** reading
results. A leader or supervisor reading their **own** team is a different reader: they know the
people on it by name, so a reading of one or two is those people's answers, and they cannot open
the results screens (`SurveyEndpoints.CanAdminister`) where the 10-15 ruling is exercised.
Recorded in full in [`who-may-see-an-individual-answer.md`](who-may-see-an-individual-answer.md) §7.

`DashboardEndpoints.DepartmentCountFloor` is `SurveyResultsPrivacy.MinimumSegmentRespondents`
again and governs, on `GET /dashboard/department-admin` and `/department-admin/export`: the team's
and the company's response count per open survey (null under 3, zero included), the running total
(sums only surveys the team answered at 3 or more), the team's climate reading (withheld under 3,
identical to a team that did not answer), the rest-of-company guard (the organisation side is
withheld when 1 or 2 people answered outside the team, so its mean cannot be differenced into
theirs), and the `minimumGroupSize` the payload reports (3; it used to say 1 while 3 withheld).
The export's own second lock, `DashboardExport.TeamCountFloor`, is raised to match. So is the
screen's, `countFloor` in `web/src/features/dashboard/next/team/compose.ts`: with no closed survey
yet (no `minimumGroupSize` on the payload — ESPH's state in October 2026) both had fallen back to 1
and printed "menos de 1 respuestas" beside a count withheld at 3.

**An administrator calling the team view gets the same floor of 3.** One floor per page, so the
screen and its export cannot differ by caller; an administrator reads a small department under the
10-15 ruling on the administrator's own screens. No web route sends an administrator to the team
view. Tests: `DepartmentDashboardFloorTests`.

## Where the floor of 3 applies today

| Surface | Floor | Constant |
|---|---|---|
| Whole survey, any reader | 3 | `SurveyResultsPrivacy.MinimumRespondents` |
| Cross of 2+ selectors, administrators | 3, with complement withholding | `MinimumSegmentRespondents`, `SurveyResultsFilter.MayDisclose` |
| Public share link | 3, with complement withholding | `PublicReportDocument` (`Math.Max(MinimumSegmentRespondents, storedFloor)`) |
| Leader / supervisor team view and export (every caller) | 3 | `DashboardEndpoints.DepartmentCountFloor` |
| Employee's last outcome | 3 | `MinimumSegmentRespondents` (`DashboardEndpoints.EmployeeLastOutcomeAsync`) |
| Single department / single demographic value, administrators | **1** | `MinimumSingleSegmentRespondents` (2026-10-15) |
| Word in a word cloud | 2 | `MinimumWordRespondents` |
