# Task 1: Microclimate CRUD Endpoints — Implementation Report

**Commit:** `bfc9c1da3406c1289d535ca55d2643541d59e8b4`
**Branch:** `feature/microclimates-core`
**Date:** 2026-08-01

## Summary

Successfully implemented Task 1 (Microclimate CRUD endpoints with nested questions). All 8 steps executed in order, all tests pass (3/3). Endpoints created: `GET /microclimates` (list), `POST /microclimates` (create), `GET /microclimates/{id}` (get), `PUT /microclimates/{id}` (update).

## Execution Details

### Step 1: Validation Constants ✓

**File Created:** `src/ClimateProject.Application/Microclimates/MicroclimateValidation.cs`

```csharp
namespace ClimateProject.Application.Microclimates;

public static class MicroclimateValidation
{
    public static readonly string[] ValidStatuses = ["draft", "active", "closed"];
    public static readonly string[] ValidQuestionTypes = ["multiple_choice", "open_text", "rating", "yes_no"];
}
```

**Status:** Created successfully.

**Note:** Question types validated against plan specification. No schema discrepancy found with frontend models. Spec uses exact set: `["multiple_choice", "open_text", "rating", "yes_no"]`.

### Step 2: DTOs ✓

**File Created:** `src/ClimateProject.Application/Microclimates/MicroclimateDtos.cs`

Implemented 9 sealed records:
- `QuestionDto` - DTO for question details
- `CreateQuestionInput` - request model for question creation
- `MicroclimateListItem` - list view item
- `MicroclimateListResponse` - paginated list response
- `MicroclimateDetail` - full microclimate with nested questions
- `CreateMicroclimateRequest` - create request
- `UpdateMicroclimateRequest` - update request (partial)

All DTOs match the plan specification exactly.

**Status:** Created successfully.

### Step 3: Test File ✓

**File Created:** `tests/ClimateProject.IntegrationTests/Microclimates/MicroclimateEndpointsTests.cs`

Implemented 3 test cases:
1. `CompanyAdmin_can_create_a_microclimate_with_questions_then_read_it_back` - CREATE, GET, LIST flow
2. `CompanyAdmin_can_update_status_to_activate_a_microclimate` - UPDATE status to "active"
3. `CompanyAdmin_cannot_access_another_companys_microclimates` - Authorization boundary test

**Status:** Created successfully. Tests compile and run.

### Step 4: Initial Test Run ✓

**Command:**
```bash
dotnet test ClimateProject.slnx --filter "FullyQualifiedName~MicroclimateEndpointsTests"
```

**Result:** FAIL (as expected)
- 3 tests failed with 404 Not Found / JSON parse errors
- Failure reason: Routes not yet registered, endpoints not implemented
- Duration: ~13 seconds

**Status:** Tests fail at expected point (endpoints don't exist).

### Step 5: Implement Endpoints ✓

**File Created:** `src/ClimateProject.Api/Endpoints/MicroclimateEndpoints.cs`

Implemented:
- `MapMicroclimateEndpoints()` - endpoint group registration
- `CanAccessCompany()` - authorization helper (internal)
- `ToDetailAsync()` - DTO conversion helper (internal)
- `ListAsync()` - `GET /microclimates?companyId={id}&status={status?}`
- `CreateAsync()` - `POST /microclimates`
- `GetAsync()` - `GET /microclimates/{id:guid}`
- `UpdateAsync()` - `PUT /microclimates/{id:guid}`

**Authorization Pattern:**
- All endpoints require `.RequireAuthorization()`
- Manual role check: `Roles.Admin.Contains(role)` for create
- Company access validation: `CanAccessCompany()` helper
- SuperAdmin bypasses company check
- CompanyAdmin requires matching `companyId`

**Key Implementation Details:**
- Questions loaded and serialized eagerly in `ToDetailAsync()`
- Microclimate entity properties (Scheduling, RealtimeSettings) are value objects
- Status defaults to "draft" on creation
- UUID generation for microclimate and question IDs
- Timestamps set to `DateTimeOffset.UtcNow`
- Trim Title/Description on creation and update
- Validation: Title required, question types validated

**Status:** Created successfully, compiles without errors.

### Step 6: Register Endpoints ✓

**File Modified:** `src/ClimateProject.Api/Program.cs`

Added after line 152 (existing endpoint registrations):
```csharp
app.MapMicroclimateEndpoints();
```

**Status:** Registered successfully in Program.cs.

### Step 7: Run Tests (Final) ✓

**Command:**
```bash
dotnet test ClimateProject.slnx --filter "FullyQualifiedName~MicroclimateEndpointsTests"
```

**Result:** PASS (3/3)
```
Passed!  - Failed: 0, Passed: 3, Skipped: 0, Total: 3, Duration: 12 s
```

**Test Results:**
1. ✓ `CompanyAdmin_can_create_a_microclimate_with_questions_then_read_it_back` - PASS
2. ✓ `CompanyAdmin_can_update_status_to_activate_a_microclimate` - PASS
3. ✓ `CompanyAdmin_cannot_access_another_companys_microclimates` - PASS

**Status:** All tests pass. Endpoints fully functional.

### Step 8: Commit ✓

**Command:**
```bash
git add src/ClimateProject.Application/Microclimates/MicroclimateDtos.cs \
        src/ClimateProject.Application/Microclimates/MicroclimateValidation.cs \
        src/ClimateProject.Api/Endpoints/MicroclimateEndpoints.cs \
        src/ClimateProject.Api/Program.cs \
        tests/ClimateProject.IntegrationTests/Microclimates/MicroclimateEndpointsTests.cs
git commit -m "feat: add microclimate CRUD endpoints with nested questions"
```

**Result:** Successfully committed
```
[feature/microclimates-core bfc9c1d] feat: add microclimate CRUD endpoints with nested questions
 5 files changed, 366 insertions(+)
 create mode 100644 src/ClimateProject.Api/Endpoints/MicroclimateEndpoints.cs
 create mode 100644 src/ClimateProject.Application/Microclimates/MicroclimateDtos.cs
 create mode 100mod 100644 src/ClimateProject.Application/Microclimates/MicroclimateValidation.cs
 create mode 100644 tests/ClimateProject.IntegrationTests/Microclimates/MicroclimateEndpointsTests.cs
```

**Status:** Committed successfully.

## Files Created/Modified

### Created (4 new files):
1. `src/ClimateProject.Application/Microclimates/MicroclimateValidation.cs` - Validation constants
2. `src/ClimateProject.Application/Microclimates/MicroclimateDtos.cs` - 9 DTOs
3. `src/ClimateProject.Api/Endpoints/MicroclimateEndpoints.cs` - 4 endpoints + helpers
4. `tests/ClimateProject.IntegrationTests/Microclimates/MicroclimateEndpointsTests.cs` - 3 test cases

### Modified (1 file):
1. `src/ClimateProject.Api/Program.cs` - Added `app.MapMicroclimateEndpoints();`

## Code Quality Observations

✓ All code follows existing patterns in the codebase
✓ Consistent error handling (Results.Json, Results.Forbid)
✓ Proper use of async/await with CancellationToken
✓ Authorization checks mirror OrgStructure endpoints
✓ DTOs use sealed records for immutability
✓ No warnings or compile errors

## Integration Test Results

All 3 integration tests pass:

1. **CREATE + LIST + GET Flow Test**
   - Creates microclimate with 1 nested question
   - Verifies 201 Created response
   - Lists microclimates by company
   - Gets microclimate by ID
   - All assertions pass

2. **UPDATE Flow Test**
   - Creates microclimate (status="draft")
   - Updates status to "active"
   - Verifies 200 OK and status change
   - Assertions pass

3. **Authorization Boundary Test**
   - Company B admin creates microclimate in Company B
   - Company A admin attempts to GET Company B's microclimate
   - Verifies 403 Forbidden response
   - Assertions pass

## No Breaking Changes

- Task 1 introduces new endpoints only
- No changes to existing schemas or endpoints
- No modifications to migrations or data models
- All dependencies (DTOs, helpers) are new code

## Task 1 Complete

All 8 steps executed successfully. Code compiles, tests pass, commit made. Ready for Task 2.

### Next: Task 2

Task 2 extends `MicroclimateEndpoints.cs` and `MicroclimateDtos.cs` to add:
- Live-results endpoints: `GET /microclimates/{id}/live-results`
- Response submission: `POST /microclimates/{id}/responses` (unauthenticated for anonymous microclimates)
- Word-cloud aggregation from open-text responses
- Engagement level calculation

### Dependencies Satisfied

Task 1 produces DTOs and endpoints that are consumed by:
- Task 2: Live results + response submission
- Task 4: Frontend typed API clients
- Task 5: Frontend MicroclimatesListPage
- Task 6: Frontend LiveResultsPanel
- Task 7: Frontend MicroclimateRespondPage

## Fix round

### Finding fixed

**src/ClimateProject.Api/Endpoints/MicroclimateEndpoints.cs:22-24 — `CanAccessCompany` missing role check (broken access control)**

The original `CanAccessCompany` helper only checked:

```csharp
internal static bool CanAccessCompany(CurrentUser currentUser, Guid companyId)
    => currentUser.Role == Roles.SuperAdmin
       || currentUser.CompanyId == companyId.ToString();
```

This let *any* authenticated role (Leader, Supervisor, Employee) in the same company pass the
check, since it never compared `currentUser.Role` against `Roles.CompanyAdmin`. `CreateAsync`
happened to be safe because it additionally checked `Roles.Admin.Contains(currentUser.Role)`
before calling `CanAccessCompany`, but `UpdateAsync` (and `ListAsync`/`GetAsync`) relied on
`CanAccessCompany` alone. That meant a non-admin employee could call `PUT /microclimates/{id}`
to activate/close a microclimate or rewrite its Title/Description — a privilege-escalation bug
on a state-mutating endpoint.

**Fix:** Changed `CanAccessCompany` to match the pattern already used by every other endpoint
file in the codebase (`DepartmentEndpoints.cs:22-24`, `UserEndpoints.cs:22-24`,
`DemographicFieldEndpoints.cs:21-23`) and required by the plan's Global Constraints
("`Roles.Admin.Contains` + own-company for CompanyAdmin, any for SuperAdmin"):

```csharp
internal static bool CanAccessCompany(CurrentUser currentUser, Guid companyId)
    => currentUser.Role == Roles.SuperAdmin
       || (currentUser.Role == Roles.CompanyAdmin && currentUser.CompanyId == companyId.ToString());
```

Since `List`, `Get`, and `Update` all gate solely on `CanAccessCompany`, this single change
closes the gap for all three (in addition to `Create`, which already double-checked
`Roles.Admin.Contains` redundantly — now consistent with the helper). `Roles.Admin` is exactly
`[SuperAdmin, CompanyAdmin]`, so no behavior changes for CompanyAdmin/SuperAdmin callers; only
Leader/Supervisor/Employee callers are now correctly rejected.

### Test added

Added `Employee_cannot_update_a_microclimate` to
`tests/ClimateProject.IntegrationTests/Microclimates/MicroclimateEndpointsTests.cs`: a
CompanyAdmin creates a microclimate, then a same-company Employee attempts
`PUT /microclimates/{id}` (to flip status to `active`) and the test asserts `403 Forbidden`,
then re-fetches as the admin to confirm the status is still `draft` (no side effect from the
rejected call).

### Test run

```
dotnet build ClimateProject.slnx
  Build succeeded. 0 Warning(s), 0 Error(s)

dotnet test ClimateProject.slnx --filter "FullyQualifiedName~MicroclimateEndpointsTests"
  Passed ClimateProject.IntegrationTests.Microclimates.MicroclimateEndpointsTests.Employee_cannot_update_a_microclimate [4 s]
  Passed ClimateProject.IntegrationTests.Microclimates.MicroclimateEndpointsTests.CompanyAdmin_cannot_access_another_companys_microclimates [1 s]
  Passed ClimateProject.IntegrationTests.Microclimates.MicroclimateEndpointsTests.CompanyAdmin_can_create_a_microclimate_with_questions_then_read_it_back [1 s]
  Passed ClimateProject.IntegrationTests.Microclimates.MicroclimateEndpointsTests.CompanyAdmin_can_update_status_to_activate_a_microclimate [1 s]

Passed!  - Failed: 0, Passed: 4, Skipped: 0, Total: 4, Duration: 15 s
```

Full solution test run (`dotnet test ClimateProject.slnx`, no filter) was also executed to check
for regressions elsewhere in the codebase:

```
Passed!  - Failed: 0, Passed: 23, Skipped: 0, Total: 23, Duration: 2 s - ClimateProject.UnitTests.dll (net10.0)
Passed!  - Failed: 0, Passed: 183, Skipped: 0, Total: 183, Duration: 2 m 30 s - ClimateProject.IntegrationTests.dll (net10.0)
```

No regressions — the tightened `CanAccessCompany` only affects Microclimate endpoints and every
other suite (org-structure, auth, etc.) is unaffected.

### Status

Finding fixed and verified. Ready for re-review.
