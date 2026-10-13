# Decision: who answered is recorded apart from what they answered, and the área feeds the map

> **Superseded on the number, 2026-10-13:** the privacy floor is **3**, not 5 — ruled by
> Federico, platform-wide. The reasoning below stands as written; only the threshold moved.
> See [`privacy-floor-is-three.md`](privacy-floor-is-three.md).


Recorded 2026-10-12 with the code that implements it (branch `who-answered-and-area-map`).
Owner: Federico. Rulings by the product owner the same day, quoted rather than characterised:

1. Respondents never log in. They scan a QR or open the public link (`/s/:token`).
2. "Collect name and email because we need to know who has answered and who has not, but
   DON'T link them to their answers."
3. The department climate map (and the action plans that hang off it) must be fed by the
   respondent's self-declared ÁREA, because a respondent with no account has no
   `responses.department_id`.
4. `self-declared-demographics.md` ruling 1 stands: a self-declared value is a demographic
   ANSWER (`response_demographics`), never `responses.department_id`, floored at READ time.

## 1. The área

- The respond view offers it first, whenever the survey asks self-declared demographics and
  the company has an active department: key `department`, options = the company's ACTIVE
  departments, value = the department id, required
  (`SurveyResponseEndpoints.LoadSelfDeclaredAreaAsync`).
- The option list IS the validation: `DemographicValueValidation` refuses any value outside
  it, so another tenant's department, a retired one, or garbage is a 400 that writes nothing.
- The key is reserved (`SelfDeclaredDepartment.FieldKey`, equal to the results filter's
  department pseudo-field). `DemographicFieldEndpoints.CreateAsync` refuses it
  case-insensitively; a legacy field that already holds it is never offered on the form.
- `SurveyAggregation.Compute` lifts the declared id into `AggregationResponse.DepartmentId`
  when `department_id` is null and the id names one of the tenant's departments, and removes
  the key so it never forms a second "department" dimension. A legacy non-id value under the
  key is left alone as the demographic it always was. Every surface built on the aggregation
  — results, statistics, analytics, climate map, climate trends, reports/exports, the
  results filter, the tracking hallazgos feed and the dashboard's last-outcome panel — then
  applies the department segment floor of 5 and the complement rule unchanged.

### Readers of a response's department deliberately NOT changed

`DashboardQueries.DepartmentSummaries`, `DepartmentCompletedCountsBySurvey` and
`SurveySummariesForDepartment` (the company and department-admin dashboards' SQL counts). They
are rates whose denominators are user ROWS of a department; a respondent with no account is
not in that population, and mixing the two would print a per-person rate over people who are
not persons in the table. A survey answered without accounts reaches those dashboards as zero
per department, as it did before. `SurveyResponsePrivacy.DepartmentFor` (write time) is
untouched by design.

### Known effect

A department's `participationRate` divides respondents by its headcount of user rows. With
self-declared respondents and a thin roster it can read above 100, which the aggregation
already reports raw by decision (`Participation_above_100_is_reported_raw_not_clamped`).

## 2. Who answered

`survey_participations`: `id` (random), `survey_id`, `company_id`, `name`, `email` (nullable,
lower-cased), `participated_on` (DATE in the company's time zone). No response id, no session
id, no demographics, no IP, no user agent, no timestamp. Unique `(survey_id, email)` where email
is not null; a repeat is `ON CONFLICT DO NOTHING` and never blocks the response. RLS enabled.

Asked when `Survey.Settings.CollectParticipantIdentity` is on (the create path sets it on;
the entity default stays false so live surveys are not changed) and the respondent has no
account -- on ANY survey answered by link, anonymous or identified (second ruling the same
day: every survey has a link and QR and nobody who opens one logs in). The self-declared
demographics predicate lost its "survey is anonymous" arm for the same reason. Written only on a COMPLETE submission, in its own statement
AFTER the response transaction commits (`SurveyResponseEndpoints.RecordParticipationAsync`).

### Mitigations of the linkage, and what is left

| path | mitigation | left |
|---|---|---|
| a foreign key or shared id | none exists; the row id is random | — |
| the clock | a day, not a timestamp | on a day with ONE participant and one completed response, the day joins them |
| Postgres `xmin` (transaction id) | separate transaction, asserted by a test | the two ids are still close together and ordered |
| physical / insertion order | none | anyone with DATABASE access can match the n-th participation to the n-th response when people answer one at a time |
| request logs | nothing logs request bodies; the failure log carries survey id + SQLSTATE only, never name, email, response id or exception text | App Runner / load-balancer access logs carry the client IP and path; the IP is shared by both writes of one request |
| differencing over time | the floor of 5 per segment | an admin who reads results before and after a day on which exactly one NAMED person participated can attribute that day's change in a segment (incl. their área) to them. Not mitigated; the defence would be delayed or batched publication |

The application exposes none of the first four: the admin endpoint reads only
`survey_participations` and the user list, and no screen shows a response's time to the
second. The residual risks are against database operators and against a patient admin
(differencing), and the respondent copy promises only what is true of the storage:
"Registramos que usted respondió, nunca qué respondió".

## 3. Copy that changed because it would have become false

- `surveyRespond.answeredOnThisDeviceBody` said the platform keeps no record of who answered;
  a `...Recorded` variant is shown when the survey asks.
- `AnonymityNotice` keeps its body (still literally true of the response row) and adds
  `participationBody` when the survey asks.
- `InvitationGuaranteeCopy.Survey` ended "completion is only ever available as an aggregate
  count"; with identity on, that sentence is replaced by what is recorded.
- The leader and supervisor dashboard notes said nobody sees who answered; they now say this
  screen does not.
