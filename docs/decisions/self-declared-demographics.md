# Decision: a self-declared demographic is floored at READ time, and cross-tabs stay unavailable

Recorded 2026-10-07 against `c8d5cbcc`, with the code that implements it. Owner: Federico.

A respondent who opens a public survey link has no account and no user row. Igoal — a client
of Irene's — is mostly *operarios* with no email, so no invitation can reach them; the mass
link and its QR are the only door. Before this change a visitor through that door could say
nothing about themselves, so a no-accounts survey produced `breakdowns: []` by construction:
`SurveyResponseEndpoints.CaptureDemographicsAsync` returned `DemographicOutcome.Nothing` for
anyone with no `ActingUserId` and no `DepartmentId`, and the demographics it did capture came
from `db.UserDemographics` — the respondent's *profile*.

This file records the two rulings that decide the shape of the fix, and the one that decides
what is deliberately not built.

## 1. A self-declared value is stored as a demographic ANSWER, never as `responses.department_id`

`responses.department_id` flows through `SurveyResponsePrivacy.DepartmentFor`, which decides
at WRITE time against `DepartmentHeadcount.Population`. A self-declared respondent is not in
that population — the company may hold no roster at all — so the predicate cannot be
computed for them. It is also the column the leader and department dashboards key off, and a
survey answered without accounts has no leaders.

So a self-declared "área" is written to `response_demographics` like any other demographic
answer, and `department_id` stays null. Nothing is lost, and the write-time guarantee stays
exactly as strong as it was for every response that does carry a department.

Asserted by `A_self_declared_area_never_becomes_the_responses_department`.

## 2. The floor for these values moves to READ time, and the respondent's copy changed with it

`SurveyResponsePrivacy`'s own doc comment argues, at length and correctly, for suppressing
quasi-identifiers at write time: "What is never written cannot leak", because a response row
"is exported, replicated and fed to the ETL, and every one of those consumers would have to
reimplement the same threshold correctly forever."

**That argument cannot be applied here, and the reason is not a preference.** The write-time
floor needs a cohort size measured over the company's own user rows. A self-declared
respondent has no user row. There is no population, so there is no number, so there is no
threshold to apply. The choice is between a read-time floor and collecting nothing.

What makes the read-time floor sufficient *today* was measured rather than assumed. Every
consumer of `response_demographics` in `src/`:

| consumer | reads per-row demographics? |
|---|---|
| `SurveyAggregateLoader.cs:92` | yes — and it feeds `SurveyAggregation.DemographicBreakdowns`, which is read-time suppressed |
| `SurveyResponseEndpoints.cs:473` | the writer |
| `Gdpr/SubjectAccessExport.cs:132`, `Gdpr/SubjectErasure.cs:244` | keyed on a user's own responses, which an anonymous response is not one of |

The three onward consumers that doc comment names — "exports, benchmark feeds and the ETL" —
do not read these rows: the ETL project no longer exists in `src/`, and the CSV and PDF
writers in `Application/Exports/` reference `ResponseDemographic` nowhere. **This is the fact
the ruling rests on, and it is the fact that would unmake it.** A future consumer that reads
`response_demographics` row by row and publishes what it finds breaks this decision rather
than merely straining it, and must apply `SurveyResultsPrivacy.MinimumSegmentRespondents`
itself.

`SurveyResponsePrivacy.UnknownCohortSize` is `-1` rather than `0` so that routing a
self-declared candidate through the write-time `Filter` by mistake fails CLOSED — the value
is dropped, never published. Asserted by
`An_unmeasurable_cohort_is_refused_rather_than_read_as_empty`.

### The copy changed in the same commit, because it had become false

`AnonymityNotice` promised, verbatim:

> Si algún dato como su departamento dejara un grupo demasiado pequeño para seguir siendo
> anónimo, **tampoco se registra**.

That is a WRITE-time promise. Self-declaration makes it false the moment it ships. The
sentence now promises what is actually enforced — *ese grupo no se informa* — and a second
sentence went with it: "Nadie, ni siquiera los administradores, puede rastrear una respuesta
hasta usted" was a claim about capability rather than about the row, and área plus antigüedad
plus sexo on one row makes it thinner than it sounds. The two sentences that remain are each
checkable against a column or a threshold.

**These two changes ship together or not at all.** Shipping the capture path without the copy
puts a false privacy promise in front of every respondent.

## 3. Cross-tabs stay unavailable

área + sexo + antigüedad together can identify one person in a small plant even when each
breakdown is suppressed on its own. Measured 2026-10-07: no cross-tab exists anywhere in
`src/` or `web/src/`, so this costs nothing to keep.

**Rejected: offering cross-tabs with the floor applied per cell.** The marginal breakdowns
already answer the question the product is for — "Operaciones scores low on recognition" —
and a cross-tab's cells are small by construction once three fields are crossed, which is
precisely where a floor of 5 is easiest to defeat. This is recorded so that the next person
asked for a cross-tab finds the reasoning instead of re-deciding it.

## What this does NOT change

- **An authenticated respondent still snapshots from their profile**, through the write-time
  cohort floor, unchanged. `AsksSelfDeclaredDemographics` requires an unauthenticated caller,
  and the submit endpoint returns 400 to a signed-in caller who sends demographics anyway —
  refused rather than ignored, because letting anyone with an account type their own cohort
  means claiming a large one to be waved through, or someone else's to pollute it.
- **The setting is opt-in and defaults false.** Deriving it from "public + anonymous + the
  company has fields" needed no column, and was rejected because all three are already true
  of surveys collecting responses right now: deriving would have started asking live
  respondents questions nobody turned on.
- **Only `select` fields with options are offered.** A `number`, `date` or `text` answer
  produces no reportable segment — every respondent writes a slightly different string, so
  every cohort is one person and the read-time floor suppresses all of them. The TIMS import
  learned this on `edad` and `tiempo`.

## Known gap, not fixed here

`SurveyAggregation.DemographicBreakdowns` passes `null` for every segment's `label`, so a
results screen prints the stable value — `operaciones`, `menos_1` — rather than the option's
configured label. Every web consumer already falls back with `segment.label ?? segment.key`;
the server simply never supplies the label. This predates this change and affects the TIMS
survey identically today, but self-declaration makes it the main way a no-accounts client
reads their results. The labels are in `demographic_field_options`, and the same problem was
already fixed once on the confirmation screen — see `SuppressedDemographicLabels`, added
after the TIMS dry run printed `tiempo_de_laborar_en_tims_anos` at a respondent.
