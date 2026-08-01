# Task 2: Live-results + response-submission endpoints — Implementation Report

## Overview
Implemented the live-results and response-submission endpoints for the microclimates domain, including word-cloud aggregation from open-text responses and engagement-level computation. All tests pass.

## Implementation Details

### Step 1: Add DTOs to MicroclimateDtos.cs
Added three new records to support live results and response submission:
- `WordCloudEntry(string Text, int Value)` - represents a word and its frequency count
- `LiveResultsDetail` - aggregated live results with sentiment score (stubbed at 0), engagement level, word cloud, response and target participant counts
- `SubmitResponseRequest` - wrapper for submitted answers mapping question GUIDs to text responses

**Status:** ✅ Complete

### Step 2: Write Failing Tests
Created `tests/ClimateProject.IntegrationTests/Microclimates/MicroclimateLiveResultsTests.cs` with two test cases:
1. `Submitting_anonymous_responses_requires_no_auth_token_and_updates_live_results` - verifies:
   - Anonymous clients can submit responses without auth tokens
   - Multiple responses accumulate word frequencies correctly
   - "good good great" + "good stressed" results in "good" count of 3 (2+1)
   - ResponseCount increments for each submission
   
2. `Non_anonymous_microclimate_requires_authentication_to_submit_a_response` - verifies:
   - Non-anonymous microclimates return 401 Unauthorized for unauthenticated requests

**Test Results (Before Implementation):** FAIL - 404 Not Found (routes don't exist)

**Status:** ✅ Complete

### Step 3: Implement Endpoints
Added to `src/ClimateProject.Api/Endpoints/MicroclimateEndpoints.cs`:

#### Route Registration
- Updated `MapMicroclimateEndpoints()` to add:
  - `GET /microclimates/{id:guid}/live-results` (authenticated)
  - `POST /microclimates/{id:guid}/responses` (unauthenticated, manual auth check)

#### Helper Functions
1. `CountWordFrequencies(IEnumerable<string> texts)` - counts word occurrences
   - Splits on whitespace and punctuation
   - Lowercases all words
   - Returns Dictionary<string, int> of word frequencies
   
2. `ComputeEngagementLevel(int responseCount, int targetParticipantCount)` - calculates engagement
   - Returns "low" if ratio < 0.3
   - Returns "medium" if 0.3 ≤ ratio < 0.7 (or if targetParticipantCount ≤ 0)
   - Returns "high" if ratio ≥ 0.7

#### Endpoint Handlers
1. `GetLiveResultsAsync()` - authenticated
   - Validates microclimate exists and user can access it
   - Deserializes WordCloudData JSON
   - Returns LiveResultsDetail with current aggregates

2. `SubmitResponseAsync()` - unauthenticated (with manual auth check)
   - Checks if microclimate exists
   - If not anonymous, validates authentication
   - Validates microclimate status is "active"
   - Aggregates word frequencies from all answer values
   - Keeps top 20 words by frequency
   - Updates ResponseCount, WordCloudData, EngagementLevel, SentimentScore (always 0)
   - Returns 201 Created

**Authorization Implementation:**
- Per global constraints: no `[Authorize(Roles=)]` used
- `GET /live-results` requires `.RequireAuthorization()` on group
- `POST /responses` manual check: if `!AnonymousResponses && !IsAuthenticated`, return 401
- Company access checked via `CanAccessCompany()` helper (inherited from Task 1)

**Status:** ✅ Complete

### Step 4: Test Results
After implementation, all tests pass:

**MicroclimateLiveResultsTests:**
```
Passed!  - Failed: 0, Passed: 2, Skipped: 0, Total: 2
```

**Full Microclimate Integration Tests:**
```
Passed!  - Failed: 0, Passed: 20, Skipped: 0, Total: 20
```

**Full Test Suite:**
```
Unit Tests:         23 passed
Integration Tests: 185 passed
Total:             208 passed, 0 failed
```

### Step 5: Commit
Files staged and committed:
- `src/ClimateProject.Application/Microclimates/MicroclimateDtos.cs` - added 3 new DTOs
- `src/ClimateProject.Api/Endpoints/MicroclimateEndpoints.cs` - added 4 handlers + 2 helpers
- `tests/ClimateProject.IntegrationTests/Microclimates/MicroclimateLiveResultsTests.cs` - new test file

**Commit Message:** `feat: add live-results and response-submission endpoints (stubbed sentiment/word-cloud)`

## Technical Notes

### Word Cloud Aggregation
- Response answers are the input (Dictionary<Guid, string>)
- All values (answers) are concatenated for word frequency counting
- Punctuation (`.`, `,`, `!`, `?`) and whitespace are delimiters
- Top 20 most-frequent words are serialized to JSON and stored in `LiveResults.WordCloudData`
- On each new response, the existing word cloud is deserialized, merged with new words, and top 20 are recomputed

### Engagement Level
- Based on response participation ratio: `responseCount / targetParticipantCount`
- Ratio ranges: low (<0.3), medium (0.3-0.7), high (≥0.7)
- Division by zero prevented by returning "medium" if target is 0 or negative

### Sentiment (Stubbed)
- `SentimentScore` is always set to 0 (no AI processing)
- Placeholder for future real sentiment analysis

### Anonymous Responses
- If `RealtimeSettings.AnonymousResponses` is true, no authentication header required
- If false and no auth, returns 401 Unauthorized
- Prevents accidental exposure of unauthenticated endpoints

## No Deviations from Plan
All steps followed exactly as specified in the plan document. No schema changes required (entities from #49). All test expectations met.

## Status
✅ **Complete** — All 2/2 new tests pass, all 208 tests pass, code committed.

## Fix round

Code review of commit `a576b5248279b8f147c28aa1f273a681b3edf991` raised three findings against
`SubmitResponseAsync` in `src/ClimateProject.Api/Endpoints/MicroclimateEndpoints.cs`. All three are
fixed in this round.

### Finding 1 — word cloud counted every answer, not just open-text ones

`request.Answers.Values` fed every answer (multiple_choice/rating/yes_no included) into
`CountWordFrequencies`, so e.g. `"yes"`/`"A"`/`"5"` polluted the word cloud. Per Global Constraints,
`WordCloudData` must come only from open-text responses.

**Fix:** query `MicroclimateQuestions` for the ids of questions with `Type == "open_text"` on this
microclimate, then filter `request.Answers` down to only the entries whose key is in that set before
counting:

```csharp
var openTextQuestionIds = await db.MicroclimateQuestions
    .Where(q => q.MicroclimateId == id && q.Type == "open_text")
    .Select(q => q.Id)
    .ToListAsync(cancellationToken);

var openTextAnswers = request.Answers
    .Where(kv => openTextQuestionIds.Contains(kv.Key))
    .Select(kv => kv.Value);
```

**Covering test (new):** `Word_cloud_only_counts_answers_to_open_text_questions` — creates a
microclimate with one `open_text` and one `yes_no` question, submits an answer to both, and asserts
the live-results word cloud contains the open-text word (`"great"`) but not the yes/no answer
(`"yes"`).

### Finding 2 — null `request.Answers` threw a 500 instead of a validation error

`request.Answers.Values` was called with no null-check; a POST with a missing/null `answers` field
(e.g. `{}`) threw an unhandled `NullReferenceException` on this intentionally-unauthenticated,
public-facing endpoint.

**Fix:** guard clause before any use of `request.Answers`, matching the existing `Title is required`
/ `?? []` validation style used elsewhere in this file:

```csharp
if (request.Answers is null || request.Answers.Count == 0)
{
    return Results.Json(new { message = "Answers is required" }, statusCode: 400);
}
```

**Covering test (new):** `Submitting_with_missing_answers_returns_bad_request_instead_of_throwing` —
POSTs a literal `{}` body (no `answers` key at all) and asserts `400 Bad Request`, not a 500.

### Finding 3 — no cross-tenant check for authenticated submitters on non-anonymous microclimates

The only gate for a non-anonymous microclimate was `IsAuthenticated`; any authenticated user from
*any* company could submit a response to *any other* company's non-anonymous microclimate, since
there was no company match check. This is a cross-tenant data-integrity gap (bumps `ResponseCount`,
pollutes `WordCloudData`/`EngagementLevel` for a company the submitter has no relationship to).

**Fix:** after confirming the user is authenticated, pull the `CurrentUser` off the principal and
require either `SuperAdmin` or a matching `CompanyId` before proceeding:

```csharp
var currentUser = httpContext.User.GetCurrentUser();
if (currentUser.Role != Roles.SuperAdmin && currentUser.CompanyId != microclimate.CompanyId.ToString())
{
    return Results.Forbid();
}
```

Deliberately **not** reusing the existing `CanAccessCompany` helper here: that helper is admin-gated
(`SuperAdmin` or `CompanyAdmin`-of-same-company only), which is correct for the CRUD/management
endpoints but would wrongly 403 an ordinary `employee`/`leader`/`supervisor` responding to their own
company's survey. The check added here is company-membership-only (any role) plus the `SuperAdmin`
bypass, which matches the intent of "any authenticated member of the microclimate's own company may
respond."

**Covering test (new):**
`Authenticated_user_from_a_different_company_cannot_submit_to_a_non_anonymous_microclimate` — an
`employee` of Company B, authenticated, POSTs to a non-anonymous microclimate owned by Company A and
asserts `403 Forbidden`.

### Test output

`dotnet test ClimateProject.slnx --filter "FullyQualifiedName~MicroclimateLiveResultsTests"`
(2 pre-existing + 3 new tests covering the three findings):

```
Passed!  - Failed:     0, Passed:     5, Skipped:     0, Total:     5, Duration: 15 s - ClimateProject.IntegrationTests.dll (net10.0)
```

Full suite, `dotnet test ClimateProject.slnx`:

```
Passed!  - Failed:     0, Passed:    23, Skipped:     0, Total:    23, Duration: 3 s - ClimateProject.UnitTests.dll (net10.0)
Passed!  - Failed:     0, Passed:   188, Skipped:     0, Total:   188, Duration: 2 m 37 s - ClimateProject.IntegrationTests.dll (net10.0)
```

(211 total vs. 208 before this round — the 3 new regression tests account for the difference; no
prior tests were removed or altered in behavior, only extended for the new company-B fixture in
`MicroclimateLiveResultsTests`.)

### Files changed in this round

- `src/ClimateProject.Api/Endpoints/MicroclimateEndpoints.cs` — the three fixes above.
- `tests/ClimateProject.IntegrationTests/Microclimates/MicroclimateLiveResultsTests.cs` — added a
  second company fixture (`_companyBDomain`/`_companyBId`) and three new tests.
- `.microclimates-reports/task-2-report.md` — this section.
