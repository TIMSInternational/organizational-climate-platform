# Decision: the privacy floor is 3 respondents, not 5

Ruled by Federico 2026-10-13: *"the umbral de privacidad number is actually 3 — change it
platform-wide."* Scope confirmed the same day: segments, the dashboard, exports, microclimates
and the whole-survey minimum. Recorded with the code that implements it.

## What it is

Two constants carry it on the API side and everything else derives from them:

- `DemographicSnapshotPrivacy.MinimumGroupSize` — feeds `SurveyResponsePrivacy.MinimumCohortSize`
  (write-time cohort floor), `SurveyResultsPrivacy.MinimumSegmentRespondents` (read-time segments
  and the complement rule) and `DashboardEndpoints.DepartmentCountFloor`.
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
