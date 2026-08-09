# Task 3: Internal Endpoint Stubs — Implementation Report

**Task:** Add stubbed `/api/internal/ciclos-encuesta`, `hallazgos`, and `send-notification` endpoints

**Status:** COMPLETE

---

## Summary

Successfully implemented all three stub endpoints for the tracking-module internal API. All required DTOs were added, all endpoint handlers were implemented, and all three integration tests pass.

---

## Step-by-Step Work

### Step 1: Add the stub DTOs

**File:** `src/ClimateProject.Application/Tracking/TrackingInternalDtos.cs`

Added four new record types to support the stub endpoints:

- `CicloInternalDto`: Represents a survey cycle (ciclo de encuesta)
- `CiclosData`: Wrapper for list of ciclos
- `HallazgoInternalDto`: Represents a finding (hallazgo) with new `CicloId` field for future use by Plan B
- `HallazgosData`: Wrapper for list of hallazgos

**Status:** ✅ Complete — DTOs added as specified in the plan with proper snake_case naming for .NET internal DTO representation.

### Step 2: Add the stub endpoints

**File:** `src/ClimateProject.Api/Endpoints/TrackingInternalEndpoints.cs`

Added three new route mappings in `MapTrackingInternalEndpoints()`:
- `GET /api/internal/ciclos-encuesta`
- `GET /api/internal/hallazgos`
- `POST /api/internal/send-notification`

Implemented three handler methods:

1. **ListCiclosAsync**: Returns empty `CiclosData` in snake_case envelope. Stub for surveys domain (#51).

2. **ListHallazgosAsync**: Accepts optional `ciclo_id` and `hallazgo_id` query parameters, returns empty `HallazgosData`. Stub for surveys domain (#51). Note: Parameter names match climate-tracking's expectations (snake_case).

3. **SendNotificationAsync**: Returns success envelope with null data. Stub for notifications domain (#55).

All endpoints use the existing `SnakeCaseOptions` for JSON serialization and inherit API-key auth from the `/api/internal` group filter.

**Status:** ✅ Complete — All stub endpoints registered and implemented as specified.

### Step 3: Write the contract tests

**File:** `tests/ClimateProject.IntegrationTests/Tracking/TrackingInternalStubEndpointsTests.cs`

Created new test class `TrackingInternalStubEndpointsTests` with three test facts:

1. **Ciclos_endpoint_returns_empty_envelope_with_correct_shape**
   - Verifies the endpoint accepts `company_id` query parameter
   - Confirms response is HTTP 200 OK
   - Validates response deserializes to correct snake_case envelope structure
   - Confirms `Ciclos` array is empty

2. **Hallazgos_endpoint_accepts_ciclo_id_and_hallazgo_id_filters_and_returns_empty**
   - Verifies the endpoint accepts both optional `ciclo_id` and `hallazgo_id` filters
   - Confirms response is HTTP 200 OK
   - Validates snake_case envelope structure
   - Confirms `Hallazgos` array is empty

3. **SendNotification_endpoint_returns_success_envelope**
   - Verifies the POST endpoint accepts a JSON body
   - Confirms response is HTTP 200 OK
   - Validates success response format

All tests use the established testing patterns from earlier tasks (AuthWebApplicationFactory, test API key authentication, snake_case JSON deserialization options).

**Status:** ✅ Complete — All three tests written per plan specification.

### Step 4: Run the tests

**Command executed:**
```bash
dotnet test tests/ClimateProject.IntegrationTests --filter FullyQualifiedName~TrackingInternalStubEndpointsTests
```

**Output:**
```
Test run for /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api/.worktrees/tracking-integration-api/tests/ClimateProject.IntegrationTests/bin/Debug/net10.0/ClimateProject.IntegrationTests.dll (.NETCoreApp,Version=v10.0)
VSTest version 18.0.1 (arm64)

Starting test execution, please wait...
A total of 1 test files matched the specified pattern.

Passed!  - Failed:     0, Passed:     3, Skipped:     0, Total:     3, Duration: 788 ms - ClimateProject.IntegrationTests.dll (net10.0)
```

**Status:** ✅ PASS — All 3 tests passed in 788 ms.

### Step 5: Commit

**Command executed:**
```bash
git add src/ClimateProject.Application/Tracking/TrackingInternalDtos.cs src/ClimateProject.Api/Endpoints/TrackingInternalEndpoints.cs tests/ClimateProject.IntegrationTests/Tracking/TrackingInternalStubEndpointsTests.cs
git commit -m "feat: add stubbed /api/internal/ciclos-encuesta,hallazgos,send-notification endpoints"
```

**Commit SHA:** `63c401f9654ea25c29319b73446d22e597b10933`

**Files changed:**
- Modified: `src/ClimateProject.Application/Tracking/TrackingInternalDtos.cs` (+17 lines for 4 new DTO records)
- Modified: `src/ClimateProject.Api/Endpoints/TrackingInternalEndpoints.cs` (+24 lines for 3 new routes + 3 handler methods)
- Created: `tests/ClimateProject.IntegrationTests/Tracking/TrackingInternalStubEndpointsTests.cs` (new test class with 3 facts)

**Status:** ✅ Complete — Commit created successfully with exact message from plan.

---

## Deviations & Notes

**None.** All steps executed exactly as specified in the plan. No deviations from the plan's requirements or code examples.

### Key Implementation Details

1. **Stub behavior confirmed:** 
   - `ciclos-encuesta` returns empty list (surveys domain not yet implemented in #51)
   - `hallazgos` accepts but ignores query filters, returns empty list (surveys domain not yet implemented in #51)
   - `send-notification` is a no-op (notifications domain not yet implemented in #55)

2. **Snake_case serialization:** All stub endpoints correctly use `SnakeCaseOptions` for JSON responses, matching climate-tracking's expected format.

3. **Query parameter naming:** `hallazgos` endpoint correctly accepts snake_case query parameters (`ciclo_id`, `hallazgo_id`) as climate-tracking's calling code expects, not camelCase.

4. **Plan B compatibility:** `HallazgoInternalDto` includes new `CicloId` field (currently unused by stubs) for future Plan B integration of on-demand hallazgo lookup.

---

## Testing Summary

- **Test Class:** `TrackingInternalStubEndpointsTests`
- **Test Count:** 3 facts
- **Status:** ✅ All passed
- **Duration:** 788 ms
- **Coverage:**
  - Contract shape validation (envelope, snake_case JSON structure)
  - Query parameter acceptance
  - API-key authentication inheritance from endpoint group
  - Empty/null response bodies for stubs

---

## Files Modified/Created

| File | Action | Details |
|------|--------|---------|
| `src/ClimateProject.Application/Tracking/TrackingInternalDtos.cs` | Modified | +4 records (CicloInternalDto, CiclosData, HallazgoInternalDto, HallazgosData) |
| `src/ClimateProject.Api/Endpoints/TrackingInternalEndpoints.cs` | Modified | +3 route registrations, +3 handler methods |
| `tests/ClimateProject.IntegrationTests/Tracking/TrackingInternalStubEndpointsTests.cs` | Created | +1 test class with 3 facts |

---

## Next Steps

Task 3 is complete. The next task in the plan (Task 4) covers frontend typed API client for direct climate-tracking calls.
