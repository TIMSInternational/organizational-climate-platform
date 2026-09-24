# Decision: a licensed service is its own field on a survey, not its `Type` (#496)

**Status: DECIDED and implemented for surveys. The microclimate half was left OPEN here and has
since been DECIDED and implemented — see
[`microclimate-seats-are-consumed-and-released.md`](microclimate-seats-are-consumed-and-released.md)
(#496, 2026-09-24). Owner: Federico.**
Recorded 2026-09-17 against `main` at `15c0a80c`, after the fact: #493 shipped the licensing
layer on 2026-09-16 and deployed it to production the same day, and this record exists because
that layer could not meter anything.

## What went wrong, measured

`#493` metered on `Survey.Type`, and said so in its own doc comment: *"Values match
`Survey.Type`"*. It compared a licence's service against a survey's type:

| Licence services (`ClimateServiceTypes.Metered`) | Survey types (`surveyVocabulary.ts:47-56`) |
|---|---|
| `general_climate` | `periodic` |
| `organizational_culture` | `pulse` |
| `microclimate` | `engagement` |
| | `satisfaction` |
| | `onboarding` |
| | `exit` |
| | `custom` |

**The intersection is empty.** So `IsMetered(survey.Type)` was false for every survey the
product can create, `TryConsumeSeatAsync` returned `NotMetered`, and no seat was ever spent.
A super admin could grant seats and watch `SeatsUsed` stay at 0 for ever.

Corroborated on `69193e40`: the wizard defaults to `'periodic'` (`wizardValues.ts`,
`useSurveyBuilderModel.ts`); `scripts/seed-surveys.mjs` writes `'periodic'`; and outside
`CompanyServiceLicense.cs` the strings `general_climate` and `organizational_culture` appeared
nowhere in `src/`, `scripts/` or `web/src` — **the only producer of a metered value in the whole
repository was the test suite.**

## Why the tests were green

`Survey.Type` has **no server-side validation**. `SurveyEndpoints.cs` validates *question* types
against `SurveyValidation.ValidQuestionTypes`; the survey type is a bare `required string` that
anything may write. So the licensing integration tests could pass
`Type: ClimateServiceTypes.GeneralClimate` through the **real** create endpoint, have it
accepted, and prove the mechanism end to end — for a value no wizard can produce.

The tests were correct. They were about a survey shaped like nothing the product makes.

## The decision

**A licensed service is a separate, nullable field: `Survey.ServiceType`.**

It is not a rename and not a mapping, because the two things are different axes:

- **`Type` is cadence and purpose** — periodic, pulse, exit. It answers *how and when this
  instrument runs*.
- **`ServiceType` is the product line the customer bought** — general climate, organizational
  culture, microclimate. It answers *which entitlement this consumes*.

An *Encuesta Periódica* can be the general-climate instrument or the culture one, and nothing
about its cadence says which. **No mapping from `Type` to a service can exist**, which is why
"just map the values" was rejected: it would have encoded a guess as a rule that bills a
customer.

### The rules that follow

1. **`null` means "no licensed service", and is the default.** Every survey that existed before
   the column carries it, and so does every survey created without choosing one. A seat is only
   ever spent for a survey whose author said which service it belongs to.
2. **The wizard defaults to none.** Defaulting to a service would start metering a customer's
   seats because of a form default nobody chose.
3. **`ServiceType` IS validated** on create and update, against `ClimateServiceTypes.Metered`.
   The new field cannot repeat `Type`'s trick of accepting anything.
4. **Clearing must be expressible.** On update, `null` means "leave unchanged" and `""` clears
   it — otherwise a survey mis-assigned to a service could never be taken back off it.
5. **`custom` is a survey type, never a service.** It is absent from `Metered` on purpose.

### Alternatives rejected

| Option | Why not |
|---|---|
| Map `Survey.Type` onto services | No honest mapping exists. Nothing corresponds to `organizational_culture`, and `microclimate` is not a survey type at all. |
| Drop the per-service dimension and meter per company | Simplest to make correct, but discards the per-service granularity the feature was commissioned for. |

## The guard

`Every_metered_service_can_be_assigned_through_the_create_endpoint` iterates
`ClimateServiceTypes.Metered` itself — not three literals — and asserts each can be attached to a
survey through the endpoint the product actually calls. A service added to that list with no way
to assign it now fails the suite.

On the web side, `licensedService.test.ts` asserts the two vocabularies stay **disjoint**. That
is a set assertion rather than a behaviour one, and it exists so that merging the two lists back
together fails loudly instead of silently restoring the defect.

`A_seat_is_spent_for_any_survey_type_the_wizard_can_produce` runs every one of the seven real
survey types. Metering wired back onto the cadence field fails all seven.

## What is not decided

> **Superseded 2026-09-24.** Everything in this section was true when it was written and is no
> longer: microclimates now meter, on the ruling recorded in
> [`microclimate-seats-are-consumed-and-released.md`](microclimate-seats-are-consumed-and-released.md).
> A seat is one completed response, taken before the aggregate write and released if that write
> does not stand; neither candidate below was chosen. The paragraphs are kept because the
> obstacle they describe is why the fix took the shape it did. `Survey.Type` still has no
> validation — that part remains open.

**Microclimates are still unmetered, and the fix is not obvious.** `TryConsumeSeatAsync` has one
call site, `SurveyResponseEndpoints.cs`. A microclimate is a separate entity submitting through
`POST /microclimates/{id}/responses`, and it has **no `Type` field at all** — it is the
microclimate service by construction, so it should meter unconditionally rather than carry a
field that can only hold one value.

The obstacle is that `MicroclimateEndpoints.SubmitResponseAsync` is deliberately **lock-free**:
`ResponseCount` and the word cloud are a read-modify-write aggregate with no per-response row, so
it uses an optimistic-concurrency retry loop because a live microclimate is a burst. Both obvious
placements of a seat consume cost something real:

- **Before the loop, no transaction** — a seat can be spent and the save then fail, or the loop
  can `return` on its re-read status check. A spent seat with no response is a billing error, and
  there is no release path by design.
- **Wrap the loop in a transaction** — correct, but holds the microclimate row lock from the
  first `SaveChangesAsync` to commit, serialising concurrent submissions and converting a
  lock-free design into a convoy on exactly the burst path.

Two candidates worth weighing, neither chosen: consume last inside a short transaction so the
licence row is locked for one statement; or meter microclimates on a different unit altogether —
one seat per participant invited at launch — which fits a burst and sidesteps the aggregate.

**Also open:** `Survey.Type` still has no validation. `ServiceType` does, so the defect cannot
recur through the new field, but tightening `Type` is its own change with its own blast radius
on existing rows.

## Deploying this

The migration `AddSurveyServiceType` adds one nullable column to `surveys`. It is additive — no
backfill, no rename, no destructive statement — and was proven on a scratch database up → down →
up before merge. The API deploy is a manual `deploy-prod` dispatch and applies it; the web
auto-deploys on merge. The feature stays inert until somebody both grants a licence **and**
assigns a survey to that service.
