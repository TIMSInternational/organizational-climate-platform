# Decision: a microclimate seat is one completed response, taken before the write and given back if it does not stand (#496)

**Status: DECIDED and implemented. Owner: Federico** (both rulings below were his, taken
2026-09-24). Recorded against `main` at `dae45da2`. This closes the half that
[`licensed-service-is-its-own-field.md`](licensed-service-is-its-own-field.md) left open: #497
fixed metering for surveys, and microclimates stayed unmetered because the fix did not port.

## What was wrong, measured

On `dae45da2`, `TryConsumeSeatAsync` had **exactly one call site** —
`SurveyResponseEndpoints.cs:455`. Microclimates submit through
`POST /microclimates/{id}/responses` (`MicroclimateEndpoints.cs`), which never called it. So a
completed microclimate response spent no seat, and the `microclimate` licence a super admin can
grant was **sold and not enforced**: inert for the same reason the whole layer was inert before
#497, one entity later.

## Why the survey fix did not port

The survey path consumes inside the completion's own `BeginTransactionAsync`, so a refusal rolls
the seat back for free — which is what makes "spend, then maybe fail" safe there.

`MicroclimateEndpoints.SubmitResponseAsync` has no such transaction, deliberately.
`ResponseCount` and `LiveResults.WordCloudData` are a read-modify-write aggregate with **no
per-response row**, so the write runs under an optimistic-concurrency retry loop (20 attempts,
`xmin` token, `ChangeTracker.Clear()` and re-read on conflict). A live microclimate is a burst —
a room answering at once — and that loop is what the path is shaped around.

Note for anyone reading the earlier record: the lock-free mechanism on this path is that
**inline loop inside `SubmitResponseAsync`**, not the shared `WithConcurrencyRetryAsync` helper.
That helper exists too, but its three callers are all admin paths (update, transition, bulk). A
fix aimed at the helper would have changed status transitions and metered nothing.

## The two rulings

### 1. A seat is one completed response — not one invited participant

The alternative was metering `TargetParticipantCount` at activation, which sidesteps the burst
path entirely. It was rejected because it bills a different thing: a 10-person session that
three people answer would cost 10 seats, and a microclimate seat would stop meaning what a
survey seat means.

**Metering invitations rather than the target was rejected as unsound, not merely undesirable.**
`MicroclimateEndpoints.cs` never touches `MicroclimateInvitations`, and the wizard defaults
`anonymousResponses: true` — so the default microclimate collects responses with **zero**
invitation rows. Metering on them would have reproduced #496 exactly: a meter reading a field
the product usually does not write.

### 2. Out of seats is a hard ceiling — 402, even mid-session

A live microclimate that exhausts its licence refuses the next respondent with **402** and a
respondent-neutral message, exactly as the survey path does. `SeatsUsed` never exceeds
`SeatsTotal`. The cost is accepted and real: respondents in a room visibly stop being able to
answer. The alternative — let a running session overrun and refuse only the next activation —
would have made exhaustion soft and left an overage to be surfaced and settled somewhere.

## How it is implemented: consume, write, release

Three single statements, no lock held across any of them, so the burst path keeps its shape:

1. **Consume** (`TryConsumeSeatAsync`) — after all validation and the status gate, before the
   loop. `!Allows()` → 402 and nothing is written.
2. **Write** — the retry loop, exactly as before.
3. **Release** (`ReleaseSeatAsync`, new) — if the write does not stand: the session closed
   in-flight (the `#376` re-read), or anything escapes the loop.

Taking the seat **first** is what makes the refusal honest. Consuming after a successful write
would mean the response is already committed and visible in `ResponseCount` by the time the
licence says no — there would be nothing left to refuse and the ceiling would not be one. This
is why the issue's own "consume last inside a short transaction" candidate was not taken.

`ReleaseSeatAsync` is guarded on `SeatsUsed > 0`. That guard is not decoration: exhaustion is
derived from `SeatsUsed >= SeatsTotal`, so a negative count is a licence reporting free seats
nobody bought. It deliberately does **not** filter on status — a licence suspended between the
consume and the release must still give the seat back.

### What this trades, stated rather than glossed over

This is compensation, not a transaction. **If the process dies between the consume and the
release, the seat stays spent.** That window is one aggregate write wide, and it errs toward
charging for a response that was not recorded rather than recording one that was not charged —
the direction that cannot oversell a licence. A transaction would close that window and convoy
the burst; that trade was refused.

## What did NOT change

- **`Microclimate` gets no `ServiceType` field.** A microclimate is the microclimate service by
  construction, so the endpoint passes the literal. A column that can only hold one value is a
  way for it to hold the wrong one. No new entity, therefore **no migration and no
  `SubjectDataMap` entry**.
- **Grandfathering is unchanged**: no licence row for (company, `microclimate`) means unmetered,
  so this ships inert and a live microclimate cannot start refusing on deploy day.
- **`Survey.Type` still has no server-side validation.** `ServiceType` does, so the original
  defect cannot recur through the new field, but that hole is still open and is its own change.

## How it is guarded

- `Concurrent_submissions_never_oversell_the_last_seats` — 12 concurrent submissions against 3
  seats, over HTTP against real Postgres, asserting **both** that exactly three succeed and that
  `ResponseCount == SeatsUsed`. Either invariant alone is passable by broken code.
- `The_microclimate_service_is_spent_by_the_microclimate_endpoint` — the reachability guard the
  issue asked for, written against the endpoint rather than the helper, because the helper was
  always correct and always tested; what was missing was anybody calling it.
- Placement is guarded too: `A_closed_session_refuses_before_a_seat_is_taken` and
  `An_invalid_answer_costs_no_seat` both fail if the consume moves above the gates.

**Not covered by a deterministic test:** the in-flight-close branch of the release path inside
the endpoint. Reaching it needs a concurrency conflict *and* a status change between the two, and
no way to drive that reliably was found — a timing-dependent test here would pass on broken code
as readily as on correct code. `ReleaseSeatAsync` itself is covered directly (five cases,
including the below-zero guard and the suspended-licence case), and the burst test pins
`ResponseCount == SeatsUsed` end to end.

## Deploying this

**No migration.** The change is code only, so the API deploy is an ordinary manual `deploy-prod`
dispatch with no schema step. Web auto-deploys on merge. It stays inert until a super admin
grants a `microclimate` licence to a company.

A respondent-facing client change ships with it: `POST /microclimates/{id}/responses` can now
answer 402, and `MicroclimatePulseForm` would have printed the server's English body on a Spanish
page — the same defect #495 fixed on the survey path, arriving here by way of a server change.
`submitResponse` now throws a typed `MicroclimateRespondError` carrying the status, and the form
takes its sentence from the catalogue.
