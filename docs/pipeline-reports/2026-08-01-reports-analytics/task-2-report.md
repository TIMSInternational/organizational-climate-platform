# Task 2 Implementation Report: Benchmark + BenchmarkMetric endpoints

## Summary
Successfully implemented Benchmark and BenchmarkMetric CRUD endpoints with full authorization checks, integration tests, and database persistence. All tests passed.

## Completed Steps

### Step 1: Write the DTOs
**File:** `src/ClimateProject.Application/Reports/BenchmarkDtos.cs`

Created five DTO records exactly as specified in the plan:
- `BenchmarkMetricDto`: Represents a metric associated with a benchmark (Id, MetricName, Value, Unit, Percentile, SampleSize)
- `BenchmarkListItem`: Summary view for benchmark listing (Id, Name, Type, Category, CompanyId, IsActive, QualityScore)
- `BenchmarkDetail`: Full detail view with all fields and nested metrics collection
- `CreateBenchmarkRequest`: Request body for creating a new benchmark with optional PriorPeriodBenchmarkId
- `AddBenchmarkMetricRequest`: Request body for adding metrics to a benchmark

**Status:** ✓ Complete

### Step 2: Write the endpoints
**File:** `src/ClimateProject.Api/Endpoints/BenchmarkEndpoints.cs`

Implemented five endpoints in the BenchmarkEndpoints class:
- `GET /admin/benchmarks` (ListAsync): Lists benchmarks with role-based filtering
  - SuperAdmin sees all benchmarks
  - CompanyAdmin sees global benchmarks (CompanyId=null) plus their own company's benchmarks
  - Non-admin users get Forbid()
- `POST /admin/benchmarks` (CreateAsync): Creates a new benchmark
  - Validates PriorPeriodBenchmarkId if provided
  - Sets initial status to "pending" with QualityScore=0
  - Resolves CreatedBy user ID from current user
- `GET /admin/benchmarks/{id}` (GetAsync): Retrieves benchmark detail with metrics
  - Returns 404 if benchmark not found
  - Enforces company access restrictions
- `PUT /admin/benchmarks/{id}` (UpdateAsync): Updates benchmark fields
  - Only updates Name, Description, Industry, CompanySize, Region
  - Respects authorization checks
- `POST /admin/benchmarks/{id}/metrics` (AddMetricAsync): Adds a metric to a benchmark
  - Creates BenchmarkMetric record
  - Returns full updated BenchmarkDetail with all metrics

Authorization pattern: `CanAccessBenchmark` helper checks SuperAdmin vs CompanyAdmin access.

**Status:** ✓ Complete

### Step 3: Register in Program.cs
**File:** `src/ClimateProject.Api/Program.cs`

Added `app.MapBenchmarkEndpoints();` after `app.MapReportEndpoints();` at line 183.

**Status:** ✓ Complete

### Step 4: Write the integration tests
**File:** `tests/ClimateProject.IntegrationTests/Reports/BenchmarkEndpointsTests.cs`

Implemented comprehensive integration test suite:

**Test 1: Create_a_benchmark_with_a_prior_period_reference_and_add_a_metric()**
- Creates a prior-period benchmark
- Creates a current benchmark with PriorPeriodBenchmarkId reference
- Verifies CreateBenchmarkRequest POST returns 201 Created
- Verifies PriorPeriodBenchmarkId is stored correctly
- Adds a metric via POST /admin/benchmarks/{id}/metrics
- Verifies metric is included in response
- Validates both assertions: Single metric, proper prior reference

**Test 2: Create_rejects_an_unknown_PriorPeriodBenchmarkId()**
- Attempts to create benchmark with non-existent PriorPeriodBenchmarkId
- Expects 400 Bad Request
- Validates foreign-key validation

Both tests use SuperAdmin role for simplicity and use the helper methods:
- `SignUpAndGetTokenAsync`: Creates test user, assigns role, and generates JWT token
- `AuthWebApplicationFactory`: Provides test HTTP client with database setup

**Issues encountered and resolved:**
1. Initial compilation error: Missing `using ClimateProject.Api.Endpoints;` - added
2. Initial compilation error: Missing `using Microsoft.EntityFrameworkCore;` for `FirstAsync` - added

**Status:** ✓ Complete

### Step 5: Run the tests
**Command:** `dotnet test tests/ClimateProject.IntegrationTests --filter FullyQualifiedName~BenchmarkEndpointsTests`

**Output:**
```
Test run for /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api/.worktrees/reports-analytics/tests/ClimateProject.IntegrationTests/bin/Debug/net10.0/ClimateProject.IntegrationTests.dll (.NETCoreApp,Version=v10.0)
VSTest version 18.0.1 (arm64)

Starting test execution, please wait...
A total of 1 test files matched the specified pattern.

Passed!  - Failed:     0, Passed:     2, Skipped:     0, Total:     2, Duration: 9 s - ClimateProject.IntegrationTests.dll (net10.0)
```

**Status:** ✓ Both tests passed successfully

### Step 6: Commit
**Command:**
```bash
git add src/ClimateProject.Application/Reports/BenchmarkDtos.cs src/ClimateProject.Api/Endpoints/BenchmarkEndpoints.cs src/ClimateProject.Api/Program.cs tests/ClimateProject.IntegrationTests/Reports/BenchmarkEndpointsTests.cs
git commit -m "feat: add Benchmark and BenchmarkMetric endpoints"
```

**Commit SHA:** `e8da34741f48c051eced573352b8aa7f3e468fdf`

**Files changed:** 4
- `src/ClimateProject.Api/Endpoints/BenchmarkEndpoints.cs` (created, 167 lines)
- `src/ClimateProject.Application/Reports/BenchmarkDtos.cs` (created, 17 lines)
- `tests/ClimateProject.IntegrationTests/Reports/BenchmarkEndpointsTests.cs` (created, 89 lines)
- `src/ClimateProject.Api/Program.cs` (modified, added 1 line)

**Status:** ✓ Complete

## Implementation Details

### Key Design Decisions
1. **Authorization Pattern**: Used the same `CanAccessBenchmark` pattern as ReportEndpoints, matching the global constraint that requires manual role checking instead of `[Authorize(Roles=)]`
2. **Benchmark Lifecycle**: Benchmarks have explicit `IsActive` boolean field for soft-delete (no hard delete per global constraints)
3. **Prior Period Support**: Implemented PriorPeriodBenchmarkId validation against actual Benchmark rows (not just null-checking)
4. **Detail Loading**: Created `LoadDetailAsync` helper to load BenchmarkDetail with nested metrics, matching the pattern from BenchmarkEndpoints

### Database Schema Compliance
- All entities (`Benchmark`, `BenchmarkMetric`) already exist from schema (#49)
- Fields like `IsActive`, `ValidationStatus`, `QualityScore`, `PriorPeriodBenchmarkId` already present in schema
- No migrations required (as per global constraints)

### Test Coverage
- ✓ Happy path: Create benchmark with prior-period reference and add metric
- ✓ Validation: Rejects unknown PriorPeriodBenchmarkId with 400 Bad Request
- ✓ Authorization: Uses SuperAdmin role for basic coverage
- ✓ Metrics relationship: Validates nested metrics in response

## No Deviations from Plan
All steps executed exactly as specified in the plan file. The only minor adjustments were fixing missing using directives in the test file (which are standard C# practices, not plan deviations).

## Test Evidence
- 2/2 tests passed in 9 seconds
- No compilation errors after fix
- Database integration verified via Testcontainers Postgres fixture
- Real Entity Framework Core queries executed against test database

## Fix round

A review of commit `e8da34741f48c051eced573352b8aa7f3e468fdf` raised 5 findings. All 5 are fixed
in a follow-up commit.

### Finding 1 (cross-tenant write vulnerability) — fixed

`CanAccessBenchmark` conflated read and write authorization: for a `null` (global)
`benchmarkCompanyId` it returned `true` for *any* `CompanyAdmin`, regardless of their own
company. Since `ListAsync` shows global benchmarks to every tenant (`b.CompanyId == null ||
b.CompanyId == ownCompanyId`), this let any `CompanyAdmin` create global benchmarks, and
update/add-metrics to a global benchmark created by another tenant (or by SuperAdmin) — a
cross-tenant tamper vector on data every other tenant sees.

Fix: split the single helper into two:
- `CanReadBenchmark` — SuperAdmin always; CompanyAdmin for `null` (global) or own-company
  benchmarks. Used by `GetAsync` (matches `ListAsync`'s existing filter).
- `CanWriteBenchmark` — SuperAdmin always; CompanyAdmin **only** when `benchmarkCompanyId` is
  their own company (global/`null` is explicitly excluded). Used by `CreateAsync` (against
  `request.CompanyId`), `UpdateAsync`, and `AddMetricAsync`.

A CompanyAdmin can now read global benchmarks (as intended — for comparison) but cannot create
one, and cannot write to any benchmark outside their own company, global or otherwise.

### Finding 2 (zero CompanyAdmin coverage) — fixed

Added CompanyAdmin-role tests exercising the fixed authorization boundary directly:
- `CompanyAdmin_can_create_read_and_update_a_benchmark_scoped_to_their_own_company`
- `CompanyAdmin_cannot_create_a_global_benchmark`
- `CompanyAdmin_cannot_create_a_benchmark_for_another_company`
- `CompanyAdmin_can_read_a_global_benchmark_but_cannot_write_to_it` (regression test for the
  exact vulnerability in Finding 1 — asserts 200 on GET, 403 on PUT and POST /metrics)
- `CompanyAdmin_cannot_read_or_write_another_companys_benchmark`

### Finding 3 (no coverage for List/Get/Update) — fixed

The tests above exercise `ListAsync`, `GetAsync`, and `UpdateAsync` directly (list-contains
assertions, 200/403/404 status assertions, and a full update round-trip verifying persisted
field values). Added `Get_and_update_return_404_for_an_unknown_benchmark` for the not-found path
on both endpoints.

### Finding 4 (PUT reusing the create DTO) — fixed

Added a dedicated `UpdateBenchmarkRequest(string Name, string Description, string? Industry,
string? CompanySize, string? Region)` record in `BenchmarkDtos.cs` with a comment explaining
why `Type`, `Category`, `Source`, `CompanyId`, and `PriorPeriodBenchmarkId` are excluded (they
define what the benchmark IS and who owns it — immutable after creation). `UpdateAsync` now
binds this narrower type instead of `CreateBenchmarkRequest`, so the mutable-field contract is
enforced by the compiler/API surface rather than left as an unstated convention. Test
`CompanyAdmin_can_create_read_and_update_a_benchmark_scoped_to_their_own_company` asserts the
excluded fields (`Type`, `Category`, `Source`, `CompanyId`) are unchanged after a PUT.

### Finding 5 (no required-field validation) — fixed

`CreateAsync` now trims and rejects blank `Name`, `Description`, `Type`, `Category`, `Source`
with a 400, matching the `ReportEndpoints.CreateAsync` pattern (trim-then-check-whitespace).
`UpdateAsync` does the same for its two required fields, `Name` and `Description`. Covered by
new theory test `Create_rejects_blank_required_fields` (empty/whitespace-only for each of the
five fields) and `Update_rejects_blank_required_fields`.

### Files changed in the fix

- `src/ClimateProject.Application/Reports/BenchmarkDtos.cs` — added `UpdateBenchmarkRequest`.
- `src/ClimateProject.Api/Endpoints/BenchmarkEndpoints.cs` — split `CanAccessBenchmark` into
  `CanReadBenchmark`/`CanWriteBenchmark`; added field validation to `CreateAsync`/`UpdateAsync`;
  `UpdateAsync` now takes `UpdateBenchmarkRequest`.
- `tests/ClimateProject.IntegrationTests/Reports/BenchmarkEndpointsTests.cs` — rewritten with a
  two-company (`_companyAId`/`_companyBId`) fixture (matching the established pattern in e.g.
  `DepartmentEndpointsTests.cs`) and 12 new tests covering CompanyAdmin authorization, List/Get/
  Update, and required-field validation, alongside the original 2 tests (updated to use the new
  `ValidCreateRequest` helper, behavior unchanged).

### Test run

Command: `dotnet build` (full solution) — succeeded, 0 warnings, 0 errors.

Command: `dotnet test tests/ClimateProject.IntegrationTests --filter FullyQualifiedName~BenchmarkEndpointsTests`

```
Passed!  - Failed:     0, Passed:    14, Skipped:     0, Total:    14, Duration: 27 s - ClimateProject.IntegrationTests.dll (net10.0)
```

Command: `dotnet test tests/ClimateProject.IntegrationTests --filter "FullyQualifiedName~Reports"` (Benchmark + Report suites together, to check for cross-contamination)

```
Passed!  - Failed:     0, Passed:    18, Skipped:     0, Total:    18, Duration: 32 s - ClimateProject.IntegrationTests.dll (net10.0)
```

**Status:** All 5 findings fixed, 14/14 Benchmark tests pass (12 new + 2 original), full solution builds clean.
