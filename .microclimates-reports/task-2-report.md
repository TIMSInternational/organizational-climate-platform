# Task 2: Live-results + response-submission endpoints — Implementation Report

**Status:** DONE
**Date:** 2026-08-01

## Overview

Implemented live-results and response-submission endpoints for the Microclimates domain. This allows anonymous users to submit responses to active microclimates (when configured) and exposes live aggregated results (word cloud, engagement level, sentiment score stub) to authenticated admins.

## Steps Completed

### Step 1: Add DTOs to MicroclimateDtos.cs

**File:** `src/ClimateProject.Application/Microclimates/MicroclimateDtos.cs`

Added three new records at the end of the file:

- `WordCloudEntry(string Text, int Value)` — represents a word and its frequency count in the word cloud
- `LiveResultsDetail(double SentimentScore, string EngagementLevel, List<WordCloudEntry> WordCloud, int ResponseCount, int TargetParticipantCount)` — the response DTO for GET /microclimates/{id}/live-results
- `SubmitResponseRequest(Dictionary<Guid, string> Answers)` — the request DTO for POST /microclimates/{id}/responses

**No deviations:** All DTOs added exactly as specified in the plan.

### Step 2: Write the failing tests

**File:** `tests/ClimateProject.IntegrationTests/Microclimates/MicroclimateLiveResultsTests.cs`

Created a new test class with 2 test facts:
- `Submitting_anonymous_responses_requires_no_auth_token_and_updates_live_results` — validates that anonymous responses work when `AnonymousResponses=true` and that the word cloud is correctly aggregated across multiple responses
- `Non_anonymous_microclimate_requires_authentication_to_submit_a_response` — validates that non-anonymous microclimates reject unauthenticated responses with 401 Unauthorized

**No deviations:** Test code matches specification exactly.

### Step 3: Run failing tests

```bash
dotnet test ClimateProject.slnx --filter "FullyQualifiedName~MicroclimateLiveResultsTests"
```

**Result:** FAIL as expected (404 routes don't exist yet)
- 2 tests failed with "NotFound" (routes not implemented)

### Step 4: Implement the endpoints

**Files modified:**
1. `src/ClimateProject.Api/Endpoints/MicroclimateEndpoints.cs`

**Changes:**

a. Updated `MapMicroclimateEndpoints()` method to add two new routes:
   - `group.MapGet("/{id:guid}/live-results", GetLiveResultsAsync)` — authenticated route within the `/microclimates` group
   - `app.MapPost("/microclimates/{id:guid}/responses", SubmitResponseAsync)` — unauthenticated route directly on app (manual auth check per request)

b. Added three private helper methods:
   - `CountWordFrequencies(IEnumerable<string> texts)` — splits text on whitespace and punctuation, counts word frequencies, returns dictionary
   - `ComputeEngagementLevel(int responseCount, int targetParticipantCount)` — computes engagement level based on response ratio: <0.3 = "low", <0.7 = "medium", >=0.7 = "high" (or "medium" if target is 0)
   - `GetLiveResultsAsync()` — handler for retrieving current word cloud and engagement metrics
   - `SubmitResponseAsync()` — handler for submitting anonymous/authenticated responses

**Implementation details:**

- `GetLiveResultsAsync`: Deserializes JSON-serialized `WordCloudEntry[]` from the microclimate's `LiveResults.WordCloudData` field
- `SubmitResponseAsync`:
  - Checks microclimate existence (404 if not found)
  - Enforces authentication requirement if `!AnonymousResponses` (returns 401 if not authenticated)
  - Validates microclimate status is "active" (400 if not)
  - Aggregates new words into existing word cloud (accumulates counts across responses)
  - Keeps top 20 words by frequency
  - Updates microclimate: increments `ResponseCount`, serializes updated word cloud, computes engagement level, sets `SentimentScore=0` (stubbed AI), and updates `UpdatedAt`
  - Returns 201 Created

**Deviations:** None. Code matches specification exactly.

### Step 5: Run tests to verify pass + full suite

```bash
dotnet test ClimateProject.slnx --filter "FullyQualifiedName~MicroclimateLiveResultsTests"
```

**Result:** PASS
- 2/2 tests passed
- Both anonymous and non-anonymous response submission tests working correctly
- Word cloud aggregation working (verified "good" word count = 3 across two responses)

```bash
dotnet test ClimateProject.slnx
```

**Result:** ALL PASS
- 23 unit tests passed
- 202 integration tests passed (includes 2 new Task 2 tests + 3 Task 1 tests + 197 existing tests)
- 0 failures, 225 total

### Step 6: Commit

```bash
git add src/ClimateProject.Application/Microclimates/MicroclimateDtos.cs \
        src/ClimateProject.Api/Endpoints/MicroclimateEndpoints.cs \
        tests/ClimateProject.IntegrationTests/Microclimates/MicroclimateLiveResultsTests.cs
git commit -m "feat: add live-results and response-submission endpoints (stubbed sentiment/word-cloud)"
```

**Commit SHA:** 997fbd743d96db538bdb8221a0c002b4624e6b93

## Test Coverage Summary

### Task 2 New Tests (2)
1. Anonymous response submission with word cloud aggregation (201 Created)
2. Non-anonymous microclimate blocks unauthenticated response (401 Unauthorized)

### Task 1 Tests (3) — All still passing
1. CompanyAdmin can create microclimate with questions and read it back
2. CompanyAdmin can update status to activate microclimate
3. CompanyAdmin cannot access another company's microclimates

### Existing Integration Tests (197) — All still passing
- No regressions

## Verification

- Stubbed sentiment analysis: `SentimentScore` always set to 0 (as per spec)
- Word cloud: Simple word-frequency counting (lowercase, split on whitespace and punctuation, keep top 20)
- Engagement level: Derived from response ratio as specified
- Anonymous responses: When `AnonymousResponses=true`, POST /microclimates/{id}/responses works without auth
- Non-anonymous enforcement: When `AnonymousResponses=false`, POST returns 401 for unauthenticated requests
- Live results: Correctly deserialize and return word cloud + engagement metrics from DB

## Files Modified

1. `src/ClimateProject.Application/Microclimates/MicroclimateDtos.cs` — added 3 DTOs
2. `src/ClimateProject.Api/Endpoints/MicroclimateEndpoints.cs` — added 2 routes + 4 handler methods
3. `tests/ClimateProject.IntegrationTests/Microclimates/MicroclimateLiveResultsTests.cs` — created new test class with 2 tests

## Concerns

None. All tests pass, implementation matches specification exactly, no deviations encountered.

## Fix round

**Date:** 2026-08-01
**Status:** DONE

Addressed 3 open code-review findings on `SubmitResponseAsync` (all plan-inherited -- the plan's
own sample code had the same gaps).

### Finding 1: word cloud fed by all answers, not just open_text

`request.Answers.Values` (every submitted answer, including ratings and yes/no) was passed
straight into `CountWordFrequencies`, contradicting the Global Constraint that `WordCloudData`
comes from open-text responses only.

**Fix:** Before counting, load the microclimate's questions and filter `request.Answers` down to
only the keys whose `MicroclimateQuestion.Type == "open_text"`:

```csharp
var openTextQuestionIds = (await db.MicroclimateQuestions
        .Where(q => q.MicroclimateId == id && q.Type == "open_text")
        .Select(q => q.Id)
        .ToListAsync(cancellationToken))
    .ToHashSet();

var openTextAnswers = request.Answers
    .Where(kv => openTextQuestionIds.Contains(kv.Key))
    .Select(kv => kv.Value)
    .ToList();
```

New test: `Word_cloud_only_counts_open_text_answers_not_ratings_or_yes_no` -- submits a response
with an open_text, a rating ("5"), and a yes_no ("yes") answer, then asserts the rating/yes-no
values are absent from the word cloud and only the open_text words are counted.

### Finding 2: no cross-tenant check on non-anonymous submissions

`SubmitResponseAsync` only checked `Identity.IsAuthenticated`, never that the authenticated
user's company matched `microclimate.CompanyId` -- unlike every other handler in this file.

**Fix:** When `!AnonymousResponses`, after confirming the caller is authenticated, also call the
existing `CanAccessCompany(httpContext.User.GetCurrentUser(), microclimate.CompanyId)` helper and
return `Results.Forbid()` on mismatch (same pattern already used by `GetAsync`/`UpdateAsync`).
Anonymous-allowed microclimates are unaffected -- they remain intentionally open to any caller,
per the approved public-response design.

New test: `Non_anonymous_microclimate_rejects_a_response_from_a_different_companys_authenticated_user`
-- creates a second company + CompanyAdmin, asserts 403 Forbidden on cross-company submission, and
confirms `ResponseCount` stayed at 0 (the rejected attempt did not leak through).

### Finding 3: unsynchronized read-modify-write on ResponseCount / WordCloudData

No concurrency token existed on `Microclimate`, so two concurrent submissions could both read the
same `ResponseCount`/`WordCloudData`, and the second `SaveChangesAsync` would silently overwrite
the first's increment (lost update).

**Fix:**
1. `MicroclimateConfiguration.cs`: added `builder.Property<uint>("RowVersion").IsRowVersion();` --
   a shadow property that Npgsql's EF Core provider automatically maps to PostgreSQL's built-in
   `xmin` system column (confirmed via the provider's own XML docs:
   `NpgsqlPostgresModelFinalizingConvention.ProcessRowVersionProperty` "Detects properties which
   are uint, OnAddOrUpdate and configured as concurrency tokens, and maps these to the PostgreSQL
   internal 'xmin' column"). `xmin` already exists on every PostgreSQL table, so this needs no
   real schema change -- it satisfies the plan's "No schema changes" constraint.
2. Because `dotnet ef migrations add` still scaffolds an `AddColumn`/`DropColumn` pair for any new
   row-version property (it doesn't know `xmin` is already physically present), the generated
   migration `20260801131037_UseXminAsMicroclimateConcurrencyToken` was hand-edited to make both
   `Up`/`Down` no-ops (with a comment explaining why) -- applying the literal AddColumn against a
   live database would fail, since `xmin` is a reserved system column that cannot be added/dropped.
   The migration exists only to keep the model snapshot in sync with the new shadow property.
3. `SubmitResponseAsync` now retries (up to 20 attempts) on `DbUpdateConcurrencyException`: on
   conflict it calls `db.ChangeTracker.Clear()` and re-reads the current row, then reapplies the
   word-count merge and `ResponseCount` increment on top of the fresh state before saving again.

New test: `Concurrent_response_submissions_do_not_lose_updates` -- fires 8 concurrent anonymous
submissions via `Task.WhenAll` (each on its own `HttpClient`/request-scoped `DbContext`, so this is
real Postgres-level concurrency, not simulated) and asserts `ResponseCount` and the word-cloud
total both equal exactly 8 -- i.e., no submission's increment was lost to a race.

### Test output

`dotnet test ClimateProject.slnx --filter "FullyQualifiedName~MicroclimateLiveResultsTests"` (run
3 times in a row to check for flakiness in the new concurrency test):

```
Passed!  - Failed:     0, Passed:     5, Skipped:     0, Total:     5, Duration: 16 s
Passed!  - Failed:     0, Passed:     5, Skipped:     0, Total:     5, Duration: 16 s
Passed!  - Failed:     0, Passed:     5, Skipped:     0, Total:     5, Duration: 17 s
```

(5 tests = original 2 + new 3: word-cloud filtering, cross-tenant rejection, concurrency.)

Full suite, `dotnet test ClimateProject.slnx`:

```
Passed!  - Failed:     0, Passed:    23, Skipped:     0, Total:    23, Duration: 3 s   - ClimateProject.UnitTests.dll
Passed!  - Failed:     0, Passed:   205, Skipped:     0, Total:   205, Duration: 3 m 30 s - ClimateProject.IntegrationTests.dll
```

205 = 202 previous baseline + 3 new tests added in this fix round. 0 failures, no regressions.

### Files changed in this round

1. `src/ClimateProject.Api/Endpoints/MicroclimateEndpoints.cs` -- open_text filtering,
   cross-tenant check, concurrency retry loop in `SubmitResponseAsync`.
2. `src/ClimateProject.Infrastructure/Persistence/Configurations/MicroclimateConfiguration.cs` --
   added `xmin`-backed `RowVersion` concurrency token.
3. `src/ClimateProject.Infrastructure/Migrations/20260801131037_UseXminAsMicroclimateConcurrencyToken.cs`
   + `.Designer.cs` -- new no-op migration to keep the model snapshot in sync (see explanation
   above).
4. `src/ClimateProject.Infrastructure/Migrations/ClimateProjectDbContextModelSnapshot.cs` --
   regenerated by `dotnet ef migrations add` to include the new shadow property.
5. `tests/ClimateProject.IntegrationTests/Microclimates/MicroclimateLiveResultsTests.cs` -- 3 new
   tests covering the three findings; refactored `SignUpAndGetTokenAsync` to take an optional
   company/domain override for the cross-tenant test.

### Concerns

None outstanding. All three findings fixed, covering tests added and passing (including repeated
runs to rule out flakiness in the concurrency test), full suite green with no regressions.
