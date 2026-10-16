# Who may see an individual answer, and what may be crossed with what

> **Superseded on the number, 2026-10-13:** the privacy floor is **3**, not 5 — ruled by
> Federico, platform-wide. The reasoning below stands as written; only the threshold moved.
> See [`privacy-floor-is-three.md`](privacy-floor-is-three.md).

> **RULED on section 4, 2026-10-15, by Federico: Mode C is built, under the constraints in
> [§5](#5-the-ruling-on-mode-c-2026-10-15).** The recommendation in section 4 was *against*
> it. It was overridden deliberately and with the reasoning read: TIMS builds its work plan on
> a spreadsheet, the ESPH results are due 14 December, and the platform's own reporting is not
> the artefact that work happens on. §5 records what was and was not conceded — in particular
> that an anonymous survey is untouched by this, because there is nothing to concede.


**Status: section 4 RULED 2026-10-15 (see §5); sections 2 and 3 OPEN. Owner: Andrés, with
Federico.** Raised 2026-10-08 by TIMS: "it's extremely
important for us to understand and know what were the results per person, their answers, who has
completed the assessment … we should be able to cross reference and ask for specific reports, so
for example, a report of the finance department against the generals/managers", with a recorded
call describing demographic crosses ("cómo está el demográfico de gerentes … con el departamento
de finanzas") and reminders to non-responders ("envíe reenvíe la invitación a la gente que no lo
ha hecho").

This file separates that request into **four** things, because they have four different answers
and three of them are not blocked on anything.

## 1. "Who has completed" — BUILT, and switched off by a flag TIMS chooses per survey

The invitation ladder is `pending → sent → opened → started → completed`
(`SurveyInvitationStatuses.cs`), and an **identified** survey records all of it. An **anonymous**
survey stops at `opened` — `AnonymityCeiling` — and the API says so in the response body rather
than silently dropping the write.

The reason is in that file and it is not squeamishness: `started` and `completed` are per-person
timestamps written within a second of `responses.start_time` / `completion_time`. An admin
holding both tables joins them on time and re-identifies the respondent; on a small audience or
a quiet hour the join is exact, not probabilistic. **Storing `completed_at` on an anonymous
survey and still calling it anonymous is a promise the schema itself disproves.**

So: **TIMS can have per-person completion today by running identified surveys.** Nothing needs
building. `POST /surveys/{id}/invitations/reminders` already goes only to invitations still at
`sent`/`opened`/`started`, which is exactly "reenvíe a la gente que no lo ha hecho".

> **Defect found while measuring this.** Completion is recorded only by
> `web/src/features/surveys/pages/SurveyInvitationPage.tsx`, the page behind the emailed
> `/survey-invitations/:token` link — it is the only caller of `recordSurveyInvitationStep` in
> the whole web app, and `SurveyResponseEndpoints.cs` contains **zero** references to
> invitations, so submitting a response marks nothing server-side. An employee who is logged in
> and answers from "Para responder" instead of from the email therefore stays at `sent` forever:
> the completion report under-counts them and the reminder job chases people who already
> answered. Worth fixing server-side, at the point the response is completed, where it cannot be
> lost — gated on `IsRecordable(..., anonymous)` so the anonymity ceiling still holds.

## 2. Demographics — BUILT, with one sharp edge

`DemographicFieldDetail` carries `Type` + `Options`. A field with options splits results; a
**number field never does** — the product says so in its own copy. The call describes banding
años de servicio into 0-1 / 1-4 / 5-10, and today that banding has to exist **in the roster
Excel**, as the value of a select field. Import the raw number and the field can never be cut.

Worth building, and small: let a numeric field declare its bands so the platform cuts them at
read time. The Excel then keeps the true number, and a band can be re-cut without re-collecting
the roster — which is what the call actually describes ("uno categoriza: de 0 a 1 año, de 1 a 5…").

## 3. Crossing two demographics — NOT BUILT, genuinely wanted, and mostly impossible at these headcounts

`SurveyAggregation.DemographicBreakdowns` does `GroupBy(r => r.Demographics[field])` — **one
field at a time**, and `GET /surveys/{id}/results` takes no filter parameter at all. So
"gerentes × finanzas" cannot be asked for today. That is the real feature request in the call.

**Before building it, read the arithmetic.** Measured on the PROCOMER demo tenant, 43 people,
crossing puesto with departamento — the call's own example:

```
                                  company_admin  employee    leader      supervisor
(sin depto)                       1  oculto      ·           ·           ·
Inversión y Encadenamientos       ·              7  VISIBLE  1  oculto   ·
Promoción Comercial               ·              10 VISIBLE  1  oculto   1  oculto
Servicios Corporativos            ·              6  VISIBLE  1  oculto   ·
Tecnologías de Información        ·              5  VISIBLE  1  oculto   ·
Ventanilla Única de Comercio Ext. ·              8  VISIBLE  1  oculto   ·

5 of 24 cells reach the floor of 5.
All five are employee × department — exactly what the department breakdown already showed.
Every leader × department cell is ONE PERSON.
```

The same roster one dimension at a time: departamento shows 5 of 6 segments, puesto shows 2 of 4.

**"Los gerentes del departamento de finanzas" is one person at almost any company**, and it stays
one person as the company grows, because the number of heads per department does not scale with
headcount while the denominator does. No feature can show that cell without naming them. A
cross-tab is worth building for broad cuts — país × género, antigüedad × género — and it will
answer "too small to show" for most management cuts, at every size of client.

Two consequences for whoever builds it:

- **Complementary suppression has to generalise.** `WithholdComplement` already does the
  one-dimensional case: it withholds the smallest visible segment, repeatedly, until the
  invisible remainder is itself ≥ 5. A free cross-tab without the two-dimensional equivalent is
  a differencing attack with a UI — "finanzas overall" minus "finanzas × no-gerentes" is
  "finanzas × gerentes", suppressed cell or not. This is what `SurveyExport`'s own comment means
  by "a documented re-identification model, not a flag" (#122).
- **Most of the value is a comparison, not an intersection.** "A report of the finance
  department against the managers" reads two ways: *finanzas ∩ gerentes* (one person, dead) or
  *finanzas beside gerentes, side by side* (7 people beside 5, both over the floor, safe today).
  The second is a view over data the aggregate already computes, and it is probably most of what
  TIMS wants. **Build that first — it is small, and it cannot leak.**

## 4. "Results per person, their answers" — this is the ruling

There is **no surface anywhere that returns one person's answers.** `SurveyResponseEndpoints.cs`
exposes exactly one GET — `/surveys/{id}/respond`, the respondent's own form. `SurveyExport`
refuses the raw-response export by name. Verbatim open text is never returned, in any format.
The floor of 5 is applied at read time and `SurveyAggregation` / `SurveyResultsPrivacy` **never
branch on the anonymous flag** — so identified surveys are floored exactly like anonymous ones.

That is a deliberate design, and the three modes it allows are:

| | Respondent is told | TIMS can see | Cost |
|---|---|---|---|
| **A. Anonymous** (today, and what PROCOMER agreed) | "no viaja ningún nombre; la participación solo se cuenta como un total" | aggregates, floored at 5. No idea who answered | no completion tracking, reminders go to everyone, department stripped for nodos under 5, resume only per browser |
| **B. Identified** (built, truthfully worded, nobody has turned it on) | "se sabe quién participó; sus respuestas se combinan igual antes de mostrarse" — `es.json` `identifiedBody` | **who answered**, plus aggregates floored at 5 | candour: people answer a named survey differently |
| **C. Attributable** (does not exist) | would have to say so | one person's answers | the floor-of-5 argument collapses, PROCOMER's 12-Aug minuta is broken, and item VAL1 of their own instrument asks respondents whether they believe this |

**Mode B gives TIMS almost everything in the request**: who completed, reminders only to
non-responders, one response per person enforced by the server, resume across devices, and
department + demographics recorded with no write-time stripping. The only thing it withholds is
reading one person's answers.

**Recommendation.** Adopt **B as the default for TIMS's own clients**, keep **A** where the
client was promised anonymity — PROCOMER was, in writing, on 12 August — and do **not** build C.
C is not a climate instrument any more; it is a named assessment, and the moment a product can
show one person's answers, every anonymous survey it has ever run becomes a question about
whether it really was. If a client genuinely needs attributable responses, that is a different
instrument with different respondent-facing copy, not a flag on this one.

What C would actually cost, if it is ever ruled in: a respondent-facing copy change on every
screen, a new audited read surface, a re-identification model written down rather than assumed,
a retention policy, and a renegotiation with every client already running under A.

## Built on 2026-10-08

Three of the four were buildable without touching the ruling, and were.

**1. Completion is now recorded server-side.** `SurveyResponseEndpoints.AdvanceInvitationAsync`
advances the respondent's own invitation to `completed` in the same `SaveChanges` as the
response, gated on `SurveyInvitationStatuses.IsRecordable` so an anonymous survey still records
nothing. The old writer — the emailed invitation page — stays; it is no longer the only one. An
employee who answers from inside the app is now counted, and the reminder sweep stops chasing
them. Covered by `SurveyCompletionTrackingTests` (5 integration tests, including the anonymous
no-op and a revoked invitation that must not be walked back onto the ladder).

**3. The cross exists.** `GET /surveys/{id}/results|statistics|analytics` take a repeatable
`?segment=field:value` (`department:<guid>` for the department), at most three, one value per
field. `SurveyResultsFilter` parses them; `SurveyAggregation.Compute` applies them immediately
after demographics are decoded, so the survey floor, the segment floor, complement withholding
and the free-text rules all govern the narrowed cohort without knowing a filter exists.

The disclosure rule is the part worth reading: a cohort's own size is **not** a sufficient test.
With A=10, B=7, C=3 over twenty people, disclosing A and B leaves a remainder of three, which is
C — means and all. So `SurveyResultsFilter.MayDisclose` runs the same withholding
`WithholdComplement` does, per selector, against the scope the other selectors define, and a
value is disclosable only once enough siblings are disclosed that the undisclosed remainder
reaches the floor. A refused cross returns the SURVEY's participation counters and never the
cohort's: for a cross the count is itself the disclosure. 17 unit tests, including the
subtraction case and "gerencia within finanzas", which is refused because it is one person.

**The category rollup is now returned.** `SurveyAggregate.Dimensions` was computed on every
request and dropped by all three endpoints. It is what a cross reports ("la categoría
Comunicación: 4,8"), so it had to be on the wire. Note what this did **not** fix: the results
page was never missing categories, because `surveyResultsMap.ts` derives them client-side from
`SurveyQuestionResult.category`. Two implementations of one number now exist; the client-side
one should go when the page is next touched.

**Web.** `SurveyCrossPanel` on the results page: pick a department and a demographic value, read
that cohort's score per category, or read that the cross is too small. It asks the server rather
than slicing the breakdown on screen — intersecting two one-dimensional breakdowns client-side
would produce a cohort the server never measured and never agreed to disclose.

**The comparison, which this file said to build first, now exists too.** `SurveyCrossPanel`
takes up to four cohorts, each any combination of up to three selectors, and renders them beside
the whole survey with a signed difference per category. Each column is its own
`?segment=` request, so a cohort the server refuses prints "Protegido" in every cell and no
number anywhere — the intersection is never computed in the browser, where no floor applies.

**And a cohort can be acted on.** Any column, protected or not, creates an action plan: the
department goes to `departmentId`, every selector to `tags` as `field:value`, and the
description names the cohort's weakest category and its score. The tenant is read from the
SURVEY, not from the header's company scope — verified in the browser with the scope on one
company and the survey on another, which is the case that would otherwise file a plan where
nobody responsible can see it. A group under the floor still gets the button: the floor stops
you reading a group, and must not become a reason not to help it.

**Still not built: 2, the numeric bands.** A field with options splits results; a number field
never does. Años de servicio and edad therefore contribute nothing to any cut, on TIMS's own
survey included. Letting a numeric field declare its bands and cutting them at read time is the
next piece, and it is what the call actually describes.

## Decision

```
Default mode for new TIMS engagements:        ____  (A anonymous | B identified)
Build the cross-tab engine:                   ____  (yes | side-by-side comparison first | no)
Build attributable responses (mode C):        ____  (no | yes, with a separate instrument)
Decided by: ____
Date: ____
```

## Measurements behind every claim above

| Claim | Where |
|---|---|
| anonymity ceiling is `opened`, with the timestamp-join reasoning | `SurveyInvitationStatuses.cs`, `AnonymityCeiling` |
| reminders skip completed invitations | `SurveyDistributionEndpoints.SendRemindersAsync`, `outstanding` |
| only the emailed invitation page records completion | `recordSurveyInvitationStep` has 1 non-test caller; 0 invitation references in `SurveyResponseEndpoints.cs` |
| breakdowns are one-dimensional | `SurveyAggregation.DemographicBreakdowns`, `GroupBy(r => r.Demographics[field])` |
| `/results` takes no filter | `SurveyResultsEndpoints.GetResultsAsync(Guid id, string? lang, …)` |
| no per-person read surface | `SurveyResponseEndpoints.cs` has one `MapGet`, `/surveys/{id}/respond` |
| floors are 5 / 5 / 2 | `SurveyResultsPrivacy.MinimumRespondents`, `MinimumSegmentRespondents`, `MinimumWordRespondents` |
| results do not branch on anonymity | `SurveyAggregation` and `SurveyResultsPrivacy` contain no reference to `Settings.Anonymous` |
| 5 of 24 cells survive puesto × departamento | measured on `PROCOMER — Demostración`, 43 users, 2026-10-08 |

## 2026-10-12 — the access export is not a back door to one person's words

**Status: RULED by the owner.** The GDPR access export (`GET /gdpr/access`) is the one route
that returns an individual's `question_responses` rows, and until today it returned them in full
to whoever was entitled to request the export — including a company administrator exporting an
employee (`?userId=…`). That made it a per-person read surface for verbatim open text, which §4
above says does not exist.

The ruling:

- **The subject's own export keeps their words.** No `userId`, or `userId` equal to the caller,
  is self-service, and Art. 15 is a right to *one's own* data.
- **Anyone else's export withholds them.** `response_text` (the comment box, free text on every
  type) is withheld whenever it holds anything; `response_value` is withheld unless the question
  is positively known to be a closed type (`QuestionTypes.All` minus `QuestionTypes.FreeText`). A
  question the export cannot find, or a type it does not recognise, counts as open — erring
  closed is the only direction that cannot print someone's words.
- **Withheld means replaced, not removed.** Each value becomes
  `SubjectDataMap.WithheldAnswerMarker` (`[withheld: verbatim answer, returned only to its
  author]`). A missing key would read as "no answer was given", which is a false statement about
  the record. The export's `limitations` says the same in prose.

Where it lives: `GdprEndpoints.AccessAsync` passes `withholdVerbatimAnswers: subject.Id !=
caller.Id`; `SubjectAccessExport.QuestionResponsesAsync` applies it. Tests:
`GdprEndpointsTests.Own_access_export_returns_the_subjects_own_words_in_both_columns` and
`GdprEndpointsTests.An_admins_export_of_someone_else_withholds_their_typed_words_and_says_so`.

## 5. The ruling on Mode C, 2026-10-15

**Ruled by Federico, over section 4's recommendation, having read it.** TIMS does not analyse on
the platform's screens; it analyses in Excel and writes the work plan from there. ESPH's results
are due 14 December. The request was made four times across one evening and in these words: *"me
as a super admin, I need a button, where I can download an excel with all the responses of ALL
the climate evaluations."*

**Built:** `GET /admin/exports/responses` → `ResponseExportEndpoints`, one workbook, one sheet
per climate, one row per response, one column per question, with `RESUMEN`, `PREGUNTAS` and
`PENDIENTES` index sheets. Two ways in: the whole platform from the super-admin surveys header,
and one climate from its own row (`?surveyId=`); `?companyId=` narrows to one company.

`RESUMEN` carries each climate's **Abre / Cierra / Respuestas / Completas / Pendientes / Última
respuesta**, and the filename carries the climate and the day. A workbook pulled while a
measurement is still running must not be mistakable a week later for a finished one.

`PENDIENTES` is the listado the twice-daily status mail is written from: everyone invited who
has not finished, keeping the roster's own three-way distinction (`started`, `not_started`,
`not_completed`) rather than flattening it — somebody who never opened it needs their sign-in
details again, somebody who stopped half way already has them. It calls
`SurveyParticipationEndpoints.BuildRosterAsync`, the same derivation the Distribución screen
reads, made `internal` for the purpose: a status report that disagreed with the screen an
administrator is looking at would be worse than no report.

**Not built, and deliberately out of this change:** the *scheduled* twice-daily email.
`RecurrenceSchedule` has `daily`, `weekly` and `monthly` and no twice-daily, and no report type
lists pending people, so that is a cadence, a digest and a recipient list — a separate piece of
work. The sheet above makes the report sendable by hand in the meantime.

### What the ruling did NOT concede, and why each one held

- **An anonymous survey is untouched.** Not "withheld from the export" — absent.
  `SurveyResponseEndpoints.StoredUserId` returns null the moment `Settings.Anonymous` is true,
  so no row was ever written to attribute. Those sheets carry **no identity columns at all**
  rather than empty ones, and `RESUMEN` says so in words, because a blank `nombre` column reads
  as data that went missing and nothing went missing. Nothing in this ruling can reach back into
  a survey already answered anonymously, which is the practical reason the ESPH launch moved to
  **Mode B / Identificada** on the same day rather than relying on this export.
- **Verbatim answers stay withheld.** The same rule section 4's own GDPR ruling set, reused and
  not restated: `response_text` is replaced with `SubjectDataMap.WithheldAnswerMarker` whenever
  it holds anything, and `response_value` likewise unless the question is positively a closed
  type. An unrecognised type counts as open. Two surfaces that each decide what a reader may see,
  each with its own copy of the rule, are one edit away from disagreeing — and the direction they
  disagree in is somebody's words in a spreadsheet.
- **Super admin only.** A company administrator reading their own tenant's attributable answers
  is a larger change to the product's promises than TIMS's own analyst reading them, and nobody
  asked for it. `ResponseExportEndpointsTests.A_company_administrator_cannot_read_the_platform_wide_response_export`.
- **Every call is audited.** `AuditSensitiveReadAttribute(AuditVerbs.Export)`, as `GET
  /audit/export` and `GET /gdpr/access` already are. A surface that can read one person's answers
  is one whose use has to be reviewable afterwards.

### What section 4 warned about, restated so it is not lost

*"The moment a product can show one person's answers, every anonymous survey it has ever run
becomes a question about whether it really was."* That cost is now carried by the respondent-facing
copy: `AnonymityNotice` states which of the two modes a survey is in **before** the person answers,
and `surveyRespond.identifiedBody` says in as many words that administrators can see who gave each
answer. The ruling is defensible only for as long as that sentence is true and shown. Anyone
widening this surface — to company admins, to anonymous surveys, to verbatim text — is changing
what 800 people were told, not adding a column.

Tests: `ResponseWorkbookTests` (shape, and that an anonymous sheet has no identity column — proved
by mutation, the guard inverted and the test observed to fail) and `ResponseExportEndpointsTests`
(authorization, identity by mode, withheld verbatim, demographics decoded out of jsonb).
