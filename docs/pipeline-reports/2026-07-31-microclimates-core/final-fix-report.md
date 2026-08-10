# Microclimates Core (#52) — Final Whole-Branch Review Fix Report

Fixes every finding from the final whole-branch review of `docs/superpowers/plans/2026-07-31-microclimates-core.md`, starting from HEAD `740c89a286da0d465108a69ff9a1f565ec9a429e`.

## 1. Privilege escalation on every microclimate write

**Fix:** Restored the dropped `Roles.CompanyAdmin` clause in `MicroclimateEndpoints.CanAccessCompany` (`src/ClimateProject.Api/Endpoints/MicroclimateEndpoints.cs`) so it now reads `SuperAdmin || (CompanyAdmin && CompanyId match)`, matching the sibling `ActionPlanEndpoints.CanAccessCompany` exactly and the plan's Global Constraint. Also added the missing `Roles.Admin.Contains(currentUser.Role)` check to `UpdateAsync` (it already existed on `CreateAsync`), matching `ActionPlanEndpoints.UpdateAsync`.

This one predicate fix closes the escalation on `ListAsync`, `UpdateAsync`, and `GetLiveResultsAsync` simultaneously, since all three gate solely on `CanAccessCompany`.

**Regression tests added** (`MicroclimateEndpointsTests.cs`) — signing up as `Employee`/`Supervisor`/`Leader` explicitly (every prior test only used `CompanyAdmin`, which is why this was invisible before):
- `Non_admin_roles_cannot_list_their_companys_microclimates`
- `Non_admin_roles_cannot_update_a_microclimate_in_their_own_company`
- `Non_admin_roles_cannot_create_a_microclimate`
- `Non_admin_roles_cannot_view_live_results_for_a_microclimate_in_their_own_company`

## 2 & 3. Unvalidated/unscoped TemplateId, and templates being effectively dead code

**Fix (backend):** `CreateAsync` now validates `TemplateId` exactly like `ActionPlanEndpoints.CreateAsync` — scoped lookup (`CompanyId == request.CompanyId || CompanyId == null`) plus `IsActive`, returning 400 if not found instead of letting an unknown/foreign GUID reach `SaveChangesAsync` as an opaque 500 or a silent cross-tenant reference. On success, `template.UsageCount` is now incremented and `UpdatedAt` refreshed — this was implemented for action plans but missing here.

**Fix (frontend):** `MicroclimatesListPage` now fetches templates via `listMicroclimateTemplates` alongside microclimates (`Promise.all`, mirroring `ActionPlansListPage`) and passes them to `MicroclimateForm`, which gained a "Start from template" picker identical in spirit to `ActionPlanForm`'s (reference-only pass-through of `templateId`, with the same explanatory comment about not auto-populating fields).

**Decision documented, not changed:** Question auto-copy from a template into a new microclimate was considered and deliberately **not** implemented, for parity with the sibling domain — `ActionPlanForm`'s own comment states template auto-population of KPIs/objectives is "explicitly out of scope for this slice," and `ActionPlanEndpoints.CreateAsync` likewise only validates the FK and bumps `UsageCount`, never copying KPI/objective content. Microclimates now have the same, consistent behavior: templates are real (validated, counted, selectable), but content copying is a separate, not-yet-scoped feature in both domains.

**Tests added:**
- `Creating_a_microclimate_with_an_unknown_template_id_returns_400_not_500`
- `Creating_a_microclimate_with_another_companys_template_id_returns_400`
- `Creating_a_microclimate_from_a_valid_template_increments_its_usage_count`

## 4. Multiple-choice questions unanswerable end to end

**Fix (backend, `CreateAsync`):** Rejects any `multiple_choice` question with fewer than 2 non-blank options at creation time (400), instead of persisting `Options = null`.

**Fix (backend, `SubmitResponseAsync`):** The `multiple_choice` validation branch no longer silently accepts any answer when `Options` is empty (the old `when question.Options is { Length: > 0 }` guard fell through to `_ => null` otherwise) — it now always requires a non-empty, matching option, with a defensive message for the shouldn't-happen-anymore case of a pre-existing options-less question.

**Fix (frontend, `MicroclimateForm.tsx`):** Added a comma-separated options input, shown when a question's type is `multiple_choice`, plus client-side validation (mirroring the backend's ≥2-option rule) that blocks submission with a clear error instead of round-tripping to the server.

**Fix (frontend, `MicroclimateRespondPage.tsx`):** `QuestionInput` now renders an explicit "This question has no configured options and cannot be answered" message instead of a silent empty `radiogroup` if it ever encounters a multiple_choice question with no options (defense in depth — the backend no longer allows creating one).

**Test added:** `Creating_a_multiple_choice_question_with_fewer_than_2_options_is_rejected`.

## 5. Frontend/backend datetime contract mismatch

**Fix (backend):** Added an optional `Timezone` field to `CreateMicroclimateRequest` (trailing, defaulted, so no existing positional test call sites needed changes) and `CreateAsync` now sets `microclimate.Scheduling.Timezone` from it when provided.

**Fix (frontend, `microclimates.ts`):** `createMicroclimate` now converts the raw `datetime-local` strings (e.g. `2026-08-01T10:30`, no offset) via `new Date(local).toISOString()` before sending — this parses the string as the *browser's* local wall-clock time (the only sane interpretation of what the admin typed) and always emits an unambiguous UTC (`Z`) string, so the server's own local offset can never silently reinterpret it. It also now sends the browser's IANA timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`) so `Scheduling.Timezone` is populated with real data instead of staying at its `"UTC"` column default.

**Test added:** `Creating_a_microclimate_with_a_timezone_persists_it_on_scheduling`.

## 6. `.AllowAnonymous()` GET over-exposure

**Fix (backend, `GetAsync`):** Unauthenticated callers must now satisfy **both** `RealtimeSettings.AnonymousResponses == true` **and** `Status == "active"` (previously only the former) — draft and closed microclimates are no longer publicly readable regardless of the anonymous-responses flag. Anonymous callers are also now served a brand-new, deliberately reduced `PublicMicroclimateDetail` record (`Id`, `Title`, `Status`, `Questions` only) instead of the full `MicroclimateDetail` — `CompanyId`, `CreatedBy` (an internal user GUID), `Description`, `ResponseCount`, and `TargetParticipantCount` are no longer exposed to anonymous callers. Authenticated access (the existing `CanAccessCompany` branch) is unchanged and still returns the full detail.

**Fix (frontend):** Added a matching `PublicMicroclimateDetail` type in `microclimates.ts`; `getMicroclimatePublic` and `MicroclimateRespondPage` now use it instead of the full `MicroclimateDetail`.

**Tests:**
- Rewrote `Anonymous_visitor_can_read_details_of_a_microclimate_configured_for_anonymous_responses` → `..._can_read_reduced_details_of_an_active_microclimate_...` — it now activates the microclimate first (the old test asserted `200` on a still-`draft` microclimate, which encoded the vulnerability) and asserts, via raw JSON, that `companyId`/`createdBy`/`description`/`responseCount`/`targetParticipantCount` are absent from the response.
- Added `Anonymous_visitor_cannot_read_a_draft_microclimate_even_when_configured_for_anonymous_responses`.
- Added `Anonymous_visitor_cannot_read_a_closed_microclimate_even_when_configured_for_anonymous_responses`.

## 7. No abuse controls on the public response-submission endpoint

**Fix:** Registered ASP.NET Core's built-in rate limiter (`Microsoft.AspNetCore.RateLimiting`, no new package — ships with the framework since .NET 7) in `Program.cs`: a fixed-window limiter keyed by client IP, 30 requests/minute, `429` on rejection, applied only to `POST /microclimates/{id}/responses` via a named policy (`MicroclimateEndpoints.ResponseSubmissionRateLimiterPolicy`) so it doesn't throttle any authenticated admin traffic. This bounds (does not eliminate — see note below) the single-IP flood scenario the review flagged; it does not add dedupe or per-respondent identity, which the plan explicitly decided against persisting (no `microclimate_responses` table exists in the `#49` schema, and adding one is a schema-level change out of scope for a review-fix pass).

**Verification:** Confirmed the existing `Concurrent_response_submissions_do_not_lose_updates` test (8 concurrent submissions from one in-memory `TestServer` instance) still passes comfortably under the new 30/minute limit.

## 8. Question-type literal drift vs. the "real" frontend model — investigated, no code change

The review noted the referenced `src/models/Microclimate.ts` "doesn't exist in this worktree" and asked that the literals be verified before merge. I located that file in the **separate, sibling `climate-project` repository** (`/Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project/src/models/Microclimate.ts`) and confirmed the literals genuinely differ:

- Real (legacy Node/Mongoose) model: `'likert' | 'multiple_choice' | 'open_ended' | 'emoji_rating'` (question types) and `scheduled | active | paused | completed | ...` (status, more granular than climate-project-api's three values).
- climate-project-api (this repo): `multiple_choice | open_text | rating | yes_no` (question types), `draft | active | closed` (status).

**No code change made**, for these reasons:
- climate-project-api is the intentional .NET rewrite/successor of the Node service, per the monorepo consolidation decision (memory: `project_monorepo_consolidation_decision.md`) — a fresh domain model is expected to diverge from the legacy one it's replacing, not mirror it byte-for-byte.
- There is no runtime coupling between the two repos today (no shared frontend, no data migration path currently wired) that would make the literal spellings a live compatibility bug.
- Within *this* codebase the four question-type literals are fully self-consistent and enforced end-to-end: `MicroclimateValidation.ValidQuestionTypes` (backend, enforced at creation — any other spelling is rejected with 400), `QUESTION_TYPES` in `MicroclimateForm.tsx`, the `SubmitResponseAsync` switch, and `MicroclimateRespondPage`'s `QuestionInput` switch all agree exactly. The finding's hypothetical failure mode (an unrecognized type silently falling through to a freeform text box with no validation) cannot occur today because `CreateAsync` rejects any type outside the four literals before a row is ever persisted.
- Rewriting the enum vocabulary now to match the legacy Node model would be a large, high-blast-radius, low-certainty change (migrations, every test, both frontend forms) for a system the legacy model isn't authoritative over. **Flagging this as a decision for a human if/when climate-project-api and climate-project are ever meant to interoperate or share a migration path** — until then, no action needed.

## Verification

- `dotnet test` (full suite, from the worktree root): **all green**
  ```
  Passed!  - Failed:     0, Passed:    23, Skipped:     0, Total:    23, Duration: 2 s - ClimateProject.UnitTests.dll (net10.0)
  Passed!  - Failed:     0, Passed:   230, Skipped:     0, Total:   230, Duration: 3 m 41 s - ClimateProject.IntegrationTests.dll (net10.0)
  ```
  (Includes 47/47 in `Microclimates/` alone when run filtered, plus 12 new tests added by this fix pass.)
- `cd web && npm test -- --run`: **all green**
  ```
  Test Files  17 passed (17)
       Tests  72 passed (72)
  ```
- `cd web && npm run build`: **succeeded**
  ```
  > tsc -b && vite build
  ✓ 1853 modules transformed.
  dist/index.html                   0.45 kB
  dist/assets/index-DGNrK5qb.css    1.78 kB
  dist/assets/index-DtOQXYh6.js   339.36 kB
  ✓ built in 237ms
  ```

## Files changed

- `src/ClimateProject.Application/Microclimates/MicroclimateDtos.cs`
- `src/ClimateProject.Api/Endpoints/MicroclimateEndpoints.cs`
- `src/ClimateProject.Api/Program.cs`
- `tests/ClimateProject.IntegrationTests/Microclimates/MicroclimateEndpointsTests.cs`
- `web/src/features/microclimates/api/microclimates.ts`
- `web/src/features/microclimates/components/MicroclimateForm.tsx`
- `web/src/features/microclimates/pages/MicroclimatesListPage.tsx`
- `web/src/features/microclimates/pages/MicroclimateRespondPage.tsx`
