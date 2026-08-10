# Task 2: Progress-update endpoint — Implementation Report

**Status:** COMPLETE

## Summary

Successfully implemented the action plan progress-update endpoint with full support for KPI and objective updates, authorization checks, and progress tracking.

## Steps Completed

### Step 1: Add the progress DTOs
- **File:** `src/ClimateProject.Application/ActionPlans/ActionPlanDtos.cs`
- **Action:** Added 4 new DTOs at the end of the file:
  - `KpiUpdateInput` - captures KPI ID, new value, and optional notes
  - `ObjectiveUpdateInput` - captures objective ID, status update, completion percentage, and optional notes
  - `RecordProgressRequest` - aggregates overall notes and lists of KPI/objective updates
  - `ProgressUpdateDetail` - response DTO containing update ID, date, notes, and updater ID
- **Status:** ✓ Complete

### Step 2: Write the failing test
- **File:** `tests/ClimateProject.IntegrationTests/ActionPlans/ActionPlanProgressEndpointTests.cs`
- **Action:** Created new integration test class with 2 test methods:
  1. `Recording_progress_updates_kpi_and_objective_current_values` - verifies that progress updates correctly persist and update KPI/objective values
  2. `Recording_progress_for_a_kpi_that_does_not_belong_to_the_plan_fails` - verifies validation that KPI/objective must belong to the plan
- **Status:** ✓ Complete

### Step 3: Run the tests to verify they fail
- **Command:** `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~ActionPlanProgressEndpointTests"`
- **Expected:** FAIL (404 - route doesn't exist)
- **Actual Result:** FAIL - both tests failed with NotFound (404) status as expected
- **Status:** ✓ Complete

### Step 4: Implement the endpoint
- **File:** `src/ClimateProject.Api/Endpoints/ActionPlanEndpoints.cs`
- **Actions:**
  1. Added route registration: `group.MapPost("/{id:guid}/progress", RecordProgressAsync);`
  2. Implemented `RecordProgressAsync` handler with:
     - Authorization check via `CanAccessCompany`
     - Validation that KPI/objective IDs belong to the action plan
     - Creation of `ActionPlanProgressUpdate` record
     - Updates to KPI `CurrentValue` properties
     - Updates to objective `CurrentStatus` and `CompletionPercentage` properties
     - Creation of `ActionPlanKpiUpdate` and `ActionPlanObjectiveUpdate` tracking records
     - Plan's `UpdatedAt` timestamp update
- **Status:** ✓ Complete

### Step 5: Run the tests to verify they pass
- **Command:** `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~ActionPlanProgressEndpointTests"`
- **Expected:** PASS, 2/2
- **Actual Result:** ✓ PASS - Failed: 0, Passed: 2, Skipped: 0, Total: 2, Duration: 12s
- **Status:** ✓ Complete

### Verification of Task 1 Tests
- **Command:** `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~ActionPlanEndpointsTests"`
- **Result:** ✓ PASS - Failed: 0, Passed: 6, Skipped: 0, Total: 6, Duration: 17s
- **Note:** Task 1 tests (CRUD endpoints) remain passing, confirming no regressions
- **Status:** ✓ Complete

### Step 6: Commit
- **Command:** 
  ```bash
  git add src/ClimateProject.Application/ActionPlans/ActionPlanDtos.cs \
          src/ClimateProject.Api/Endpoints/ActionPlanEndpoints.cs \
          tests/ClimateProject.IntegrationTests/ActionPlans/ActionPlanProgressEndpointTests.cs
  git commit -m "feat: add action plan progress-update endpoint"
  ```
- **Commit SHA:** d171bb44b4b4a9807e8da6979fe17144426eaf3a
- **Status:** ✓ Complete

## Test Results Summary

| Test Suite | Result | Count |
|-----------|--------|-------|
| Unit Tests (full suite) | ✓ PASS | 23/23 |
| Integration Tests (full suite) | ✓ PASS | 187/187 |
| **TOTAL TESTS** | ✓ PASS | **210/210** |
| ActionPlanProgressEndpointTests | ✓ PASS | 2/2 |
| ActionPlanEndpointsTests (Task 1) | ✓ PASS | 6/6 |

**Full Test Run Command:** `dotnet test ClimateProject.slnx`
**Result:** Passed! - Failed: 0, Passed: 210, Skipped: 0, Total: 210, Duration: 3m 35s

## Implementation Details

### RecordProgressAsync Endpoint
- **Route:** `POST /action-plans/{id}/progress`
- **Authorization:** `.RequireAuthorization()` + manual role check via `CanAccessCompany`
- **Request Body:** `RecordProgressRequest` with:
  - `OverallNotes` (string, required)
  - `KpiUpdates` (list of KpiUpdateInput, optional)
  - `ObjectiveUpdates` (list of ObjectiveUpdateInput, optional)
- **Response:** `ProgressUpdateDetail` with HTTP 201 Created on success
- **Validations:**
  - Plan must exist (404 if not)
  - User must have access to plan's company (403 if denied)
  - All referenced KPI IDs must belong to the plan (400 if not)
  - All referenced objective IDs must belong to the plan (400 if not)

### Data Persistence
- Creates `ActionPlanProgressUpdate` record tracking overall progress
- Creates `ActionPlanKpiUpdate` record for each KPI update
- Creates `ActionPlanObjectiveUpdate` record for each objective update
- Updates KPI `CurrentValue` directly on the entity
- Updates objective `CurrentStatus` and `CompletionPercentage` directly on the entity
- Updates plan's `UpdatedAt` timestamp

### Backward Compatibility
- No breaking changes to Task 1 CRUD endpoints
- All Task 1 tests continue to pass
- DTOs properly scoped in Application layer

## Code Quality Notes

- All code follows established patterns from Task 1
- Authorization logic mirrors existing `CanAccessCompany` pattern
- Error responses use consistent JSON format with message field
- Proper null-coalescing and empty collection handling
- Async/await properly used throughout
- Entity change tracking and SaveChangesAsync properly utilized

## Concerns

None - all requirements met, all tests passing, properly committed.

## Fix round

**Reviewed findings (both plan-inherited, from Task 2's own Step 4 pseudocode):**

1. `RecordProgressAsync` only checked `CanAccessCompany`, not `Roles.Admin.Contains(currentUser.Role)`,
   unlike `CreateAsync`/`UpdateAsync` in the same file. Any authenticated user in the same company
   (any role) could rewrite KPI `CurrentValue` and objective `CompletionPercentage`/`CurrentStatus`.
2. `request.OverallNotes` was never null/whitespace-validated before being written to
   `progressUpdate.OverallNotes`. The `overall_notes` column is `.IsRequired()` with a DB-level
   default, but EF Core sends an explicit tracked value (including `null`) on insert, so the
   DB default never engages for an explicit null — a request with a missing/omitted
   `overallNotes` field produces an unhandled Postgres NOT-NULL violation (500) instead of a
   clean 400.

### Changes made

- `src/ClimateProject.Api/Endpoints/ActionPlanEndpoints.cs` — `RecordProgressAsync`:
  - Authorization check changed from `if (!CanAccessCompany(...))` to
    `if (!Roles.Admin.Contains(currentUser.Role) || !CanAccessCompany(...))`, matching the
    same pattern already used in `CreateAsync`/`UpdateAsync`.
  - Added `if (string.IsNullOrWhiteSpace(request.OverallNotes)) return Results.Json(new { message = "Overall notes are required" }, statusCode: 400);`
    immediately after the authorization check, before any DB reads/writes, matching the
    `Title`/`Description` validation style in `CreateAsync`.
- `tests/ClimateProject.IntegrationTests/ActionPlans/ActionPlanProgressEndpointTests.cs` — added
  3 new tests covering the fixes:
  - `Recording_progress_as_a_non_admin_role_is_forbidden` — an `employee`-role user hitting the
    endpoint now gets 403 instead of being allowed to mutate progress.
  - `Recording_progress_with_blank_overall_notes_fails_with_400` — whitespace-only
    `overallNotes` now returns 400 instead of proceeding.
  - `Recording_progress_with_missing_overall_notes_field_fails_with_400_not_500` — a raw JSON
    payload that omits `overallNotes` entirely (binds to `null`) now returns 400 instead of an
    unhandled 500 from the Postgres NOT-NULL violation.

No changes were needed to `ActionPlanProgressUpdateConfiguration.cs` — the endpoint-level guard
is sufficient since a `null`/blank request is now rejected before it ever reaches `SaveChangesAsync`.

### Test output

`dotnet test ClimateProject.slnx --filter "FullyQualifiedName~ActionPlanProgressEndpointTests"`
(now 5 tests, up from 2):

```
Passed!  - Failed:     0, Passed:     5, Skipped:     0, Total:     5, Duration: 15 s - ClimateProject.IntegrationTests.dll (net10.0)
```

`dotnet test ClimateProject.slnx --filter "FullyQualifiedName~ActionPlanEndpointsTests"` (Task 1
regression check):

```
Passed!  - Failed:     0, Passed:     6, Skipped:     0, Total:     6, Duration: 16 s - ClimateProject.IntegrationTests.dll (net10.0)
```

Full suite: `dotnet test ClimateProject.slnx`

```
Passed!  - Failed:     0, Passed:    23, Skipped:     0, Total:    23, Duration: 4 s - ClimateProject.UnitTests.dll (net10.0)
Passed!  - Failed:     0, Passed:   190, Skipped:     0, Total:   190, Duration: 2 m 38 s - ClimateProject.IntegrationTests.dll (net10.0)
```

213/213 passing (up from 210/210 pre-fix, reflecting the 3 new tests added). No regressions.

### Commit

Committed as a follow-up fix on top of `d171bb44b4b4a9807e8da6979fe17144426eaf3a` (see git log
for SHA).

### Concerns

None. Both findings fixed, covering tests added, full suite green.

