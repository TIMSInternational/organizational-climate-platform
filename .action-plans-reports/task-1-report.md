# Task 1 Implementation Report: Action Plan CRUD Endpoints

## Summary
Successfully implemented Task 1 from the action-plans-core plan. All action plan CRUD endpoints with nested KPIs and objectives are now functional and tested.

## Commit Details
- **Commit SHA**: 8898f6f9d0f9a80320196d956985745ee4da97b4
- **Commit Message**: feat: add action plan CRUD endpoints with nested KPIs and objectives

## Implementation Steps

### Step 1: Validation Constants
**File**: `src/ClimateProject.Application/ActionPlans/ActionPlanValidation.cs`
- Created validation static class with arrays for valid status, priority, and measurement frequency values
- No deviations from spec

### Step 2: DTOs
**File**: `src/ClimateProject.Application/ActionPlans/ActionPlanDtos.cs`
- Created all required DTOs:
  - `KpiDto`: Represents individual KPI with name, target/current values, unit, measurement frequency
  - `ObjectiveDto`: Represents individual objective with description, success criteria, status, completion percentage
  - `ActionPlanListItem`: Lightweight list item representation
  - `ActionPlanListResponse`: Wrapper for list endpoint response
  - `ActionPlanDetail`: Full detail representation with nested KPIs and objectives
  - `CreateKpiInput`, `CreateObjectiveInput`: Input models for creating nested entities
  - `CreateActionPlanRequest`: Full creation request with all nested entities
  - `UpdateActionPlanRequest`: Partial update request for selective field updates
- No deviations from spec

### Step 3: Tests
**File**: `tests/ClimateProject.IntegrationTests/ActionPlans/ActionPlanEndpointsTests.cs`
- Created 4 integration tests:
  1. `CompanyAdmin_can_create_a_plan_with_kpis_and_objectives_then_read_it_back`: Verifies full CRUD flow
  2. `Create_rejects_invalid_priority`: Validates priority validation
  3. `CompanyAdmin_cannot_create_or_read_plans_in_another_company`: Verifies company-level authorization
  4. `CompanyAdmin_can_update_status_and_priority`: Verifies update functionality
- Tests follow existing integration test patterns
- No deviations from spec

### Step 4: Test Execution (Failing)
Ran `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~ActionPlanEndpointsTests"`
- Result: FAILED (all 4 tests) as expected - 404 responses because endpoints don't exist yet

### Step 5: Endpoints Implementation
**File**: `src/ClimateProject.Api/Endpoints/ActionPlanEndpoints.cs`
- Implemented `MapActionPlanEndpoints()` extension method with 4 endpoints:
  - `GET /action-plans`: List plans with optional filtering by departmentId and status
  - `POST /action-plans`: Create plan with nested KPIs and objectives
  - `GET /action-plans/{id}`: Retrieve plan with full details
  - `PUT /action-plans/{id}`: Update plan fields selectively
- Implemented `ToDetailAsync()` helper to transform entities to DTOs
- Authorization: Proper role checks (Admin only for create/update, any authenticated user can list/get)
- Company access control: Uses `CanAccessCompany()` helper - SuperAdmin can access any company, CompanyAdmin only their own
- Default values: New plans start in "not_started" status
- Validation: Priority and measurement frequency validated against defined constants
- No deviations from spec

### Step 6: Program.cs Registration
**File**: `src/ClimateProject.Api/Program.cs`
- Added `app.MapActionPlanEndpoints();` after the last existing endpoint registration
- Follows established pattern with other endpoint groups
- No deviations from spec

### Step 7: Test Execution (Passing)
Ran `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~ActionPlanEndpointsTests"`
- Result: **PASSED** - All 4 tests pass

Ran full test suite `dotnet test ClimateProject.slnx`
- **Unit Tests**: 23 passed
- **Integration Tests**: 183 passed (includes 4 new action plan tests + 179 existing)
- Total: 206 tests passing, 0 failures

### Step 8: Commit
```bash
git add src/ClimateProject.Application/ActionPlans/ActionPlanDtos.cs \
        src/ClimateProject.Application/ActionPlans/ActionPlanValidation.cs \
        src/ClimateProject.Api/Endpoints/ActionPlanEndpoints.cs \
        src/ClimateProject.Api/Program.cs \
        tests/ClimateProject.IntegrationTests/ActionPlans/ActionPlanEndpointsTests.cs
git commit -m "feat: add action plan CRUD endpoints with nested KPIs and objectives"
```

## Files Created
1. `src/ClimateProject.Application/ActionPlans/ActionPlanValidation.cs` (52 lines)
2. `src/ClimateProject.Application/ActionPlans/ActionPlanDtos.cs` (50 lines)
3. `src/ClimateProject.Api/Endpoints/ActionPlanEndpoints.cs` (219 lines)
4. `tests/ClimateProject.IntegrationTests/ActionPlans/ActionPlanEndpointsTests.cs` (178 lines)

## Files Modified
1. `src/ClimateProject.Api/Program.cs` (1 line added for endpoint registration)

## Test Results Summary
- Target tests (ActionPlanEndpointsTests): 4/4 PASS
- Full suite: 206/206 PASS (23 unit + 183 integration)
- Duration: ~3 minutes (2m 48s integration tests, 6s unit tests)

## Compliance Notes
- All 9 action plan entities already existed from #49 - no schema changes needed
- Followed established authorization pattern: `.RequireAuthorization()` + manual role checks
- Status and priority values match legacy model definitions
- No hard deletes (lifecycle managed through Status)
- SourceSurveyId and SourceInsightId are write-only pass-through (accepted but not validated)
- Next tasks (2-3) can now proceed to add progress endpoints and templates

## No Concerns
All steps executed exactly as specified in the plan. All tests pass. Ready for next tasks.

## Fix round

### Finding fixed
**Finding 1**: `UpdateAsync` (PUT `/action-plans/{id}`) was missing the `Roles.Admin.Contains(currentUser.Role)` check that `CreateAsync` has. `CanAccessCompany` alone only checks company membership, not role, so any authenticated non-admin employee/leader/supervisor in the same company could PUT to `/action-plans/{id}` and change Title, Description, DueDate, Status, Priority, Tags. This bug originated verbatim in the plan's Step 5 code block and was carried through unchanged during initial implementation.

### Change made
**File**: `src/ClimateProject.Api/Endpoints/ActionPlanEndpoints.cs`

In `UpdateAsync`, changed:
```csharp
if (!CanAccessCompany(currentUser, plan.CompanyId))
{
    return Results.Forbid();
}
```
to:
```csharp
if (!Roles.Admin.Contains(currentUser.Role) || !CanAccessCompany(currentUser, plan.CompanyId))
{
    return Results.Forbid();
}
```
This mirrors the exact pattern already used in `CreateAsync` (line 72) and matches the precedent in `DemographicFieldEndpoints.cs`. `CanAccessCompany` itself was intentionally left unchanged (not narrowed to admins) because `ListAsync`/`GetAsync` rely on it to let any authenticated same-company user read plans — narrowing it there would have regressed read access for non-admin roles, which is not part of this finding.

### Test coverage added
**File**: `tests/ClimateProject.IntegrationTests/ActionPlans/ActionPlanEndpointsTests.cs`

Added two new tests to close the gap noted in the finding ("No test in Step 3 ... exercises a non-admin role attempting Create/Update"):
1. `NonAdmin_cannot_create_a_plan` — an `employee`-role user attempting `POST /action-plans` in their own company gets `403 Forbidden`.
2. `NonAdmin_cannot_update_a_plan_in_their_own_company` — a `company_admin` creates a plan, then an `employee`-role user in the *same* company attempts `PUT /action-plans/{id}` to change the title; asserts `403 Forbidden`, then re-fetches as the admin to confirm the title was not mutated (guards against the exact "broken access-control gap" described in the finding).

### Test execution

Targeted run:
```
dotnet test ClimateProject.slnx --filter "FullyQualifiedName~ActionPlanEndpointsTests"
```
Result: **Passed! - Failed: 0, Passed: 6, Skipped: 0, Total: 6** (the original 4 tests + the 2 new non-admin tests), Duration: 19s.

Full suite:
```
dotnet test ClimateProject.slnx
```
Result:
- `ClimateProject.UnitTests.dll`: Passed! - Failed: 0, Passed: 23, Skipped: 0, Total: 23, Duration: 5s
- `ClimateProject.IntegrationTests.dll`: Passed! - Failed: 0, Passed: 185, Skipped: 0, Total: 185, Duration: 2m 34s

Total: 208/208 passing, 0 failures (up from 206/206 before this fix round, reflecting the 2 new tests).

### Commit
Committed as a follow-up fix commit on top of `8898f6f9d0f9a80320196d956985745ee4da97b4`.
