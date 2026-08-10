# Task 3: Remove `HallazgoCache`, fix the on-demand hallazgo lookup

**Commit SHA:** `84183d6aa3c0ec0e8513dbaca838128938935433`

## Summary

Task 3 was fully completed. The dead `HallazgoCache` entity and its infrastructure were removed, and the `PlanesAccionEndpoints.CreateAsync` method was updated to perform on-demand hallazgo lookups via `IClimateProjectClient.GetHallazgoByIdAsync` instead of querying a cached table that was never populated.

## Changes Made

### 1. Deleted Entity and Configuration Files
- Deleted: `services/tracking-api/src/ClimateTracking.Domain/Entities/HallazgoCache.cs`
- Deleted: `services/tracking-api/src/ClimateTracking.Infrastructure/Persistence/Configurations/HallazgoCacheConfiguration.cs`

### 2. Updated DbContext
- Modified: `services/tracking-api/src/ClimateTracking.Infrastructure/Persistence/ClimateTrackingDbContext.cs`
  - Removed the `DbSet<HallazgoCache> Hallazgos` property

### 3. Generated EF Migration
- Created: `services/tracking-api/src/ClimateTracking.Infrastructure/Migrations/20260801125946_DropHallazgosCache.cs`
  - Generates `migrationBuilder.DropTable(name: "hallazgos_cache");`
  - Includes rollback to recreate the table with its index

### 4. Fixed Hallazgo Lookup Logic
- Modified: `services/tracking-api/src/ClimateTracking.Api/Endpoints/PlanesAccionEndpoints.cs`
  - Added `using ClimateTracking.Application.ExternalApi;`
  - Added `IClimateProjectClient climateProjectClient` parameter to `CreateAsync` method
  - Replaced database query with on-demand client lookup:
    ```csharp
    var hallazgo = await climateProjectClient.GetHallazgoByIdAsync(request.HallazgoExternalId, cancellationToken);
    cicloExternalId = hallazgo?.CicloId;
    ```

### 5. Updated Documentation
- Modified: `services/tracking-api/src/ClimateTracking.Workers/CacheSyncWorker.cs`
  - Replaced stale doc comment explaining the gap
  - New comment clarifies that hallazgos are deliberately looked up on-demand rather than cached

### 6. Removed Obsolete Test
- Modified: `services/tracking-api/tests/ClimateTracking.UnitTests/Entities/CacheEntitiesTests.cs`
  - Deleted `HallazgoCache_holds_benchmark_and_prior_year_percentages()` test method

### 7. Created Integration Test
- Created: `services/tracking-api/tests/ClimateTracking.IntegrationTests/Endpoints/PlanesAccionHallazgoLookupTests.cs`
  - Test class: `PlanesAccionHallazgoLookupTests`
  - Includes `FakeClimateProjectClient` for test isolation
  - Tests:
    1. `CreatingAPlanWithAHallazgo_setsCicloEncuestaExternalId_fromTheClientLookup()` - verifies successful hallazgo lookup
    2. `CreatingAPlanWithAHallazgoTheClientCannotFind_leavesCicloEncuestaExternalIdNull()` - verifies graceful handling when hallazgo not found

## Test Results

All tests pass:
- **Unit Tests:** 40 passed, 0 failed (350 ms)
- **Integration Tests:** 36 passed, 0 failed (6 s)

Total test coverage confirms:
- Deleted `HallazgoCache` type and its test reference are no longer referenced
- New migration is properly integrated
- New client method (`GetHallazgoByIdAsync`) is properly consumed
- On-demand hallazgo lookup works correctly at the endpoint level

## Design Rationale

The change implements the approved design from issue #56:
- Hallazgos are only needed once at plan-creation time for a single hallazgo lookup
- Caching was unnecessary overhead since they're not queried in bulk like nodos/personas/ciclos
- On-demand lookup via `IClimateProjectClient.GetHallazgoByIdAsync` (implemented in Task 2) is the efficient solution
- The `HallazgoCache` table was never populated by any worker, making it dead code that could never work

## Dependencies Met

Task 3 depends on Task 2 (`GetHallazgoByIdAsync` client method + `HallazgoDto.CicloId`), which must be completed and merged before this task.

## Build Status

- Build: ✓ Successful (0 errors, 0 warnings)
- Unit tests: ✓ All passed
- Integration tests: ✓ All passed
- Full suite: ✓ All passed (76 tests total)

## Fix round

### Finding fixed

1. **Unguarded `GetHallazgoByIdAsync` call could turn a briefly-unreachable
   climate-project-api into a 500 on plan creation.** `PlanesAccionEndpoints.CreateAsync`
   called `climateProjectClient.GetHallazgoByIdAsync` with no try/catch. Since
   `ClimateProjectClient.GetAsync` calls `response.EnsureSuccessStatusCode()` and the Polly
   retry/circuit-breaker policy in `ServiceCollectionExtensions.AddClimateProjectClient`
   retries and eventually opens the circuit but does not swallow the exception, any
   non-2xx/network failure (or an open circuit) propagated straight out of the endpoint as an
   unhandled exception — contradicting the documented resilience goal ("a briefly-unreachable
   Node app degrades gracefully instead of taking down every caller") and regressing behavior
   versus the old (always-empty) `HallazgoCache` lookup, which always silently returned null.

### Change made

`services/tracking-api/src/ClimateTracking.Api/Endpoints/PlanesAccionEndpoints.cs`:

- Added an `ILogger<Program>` parameter to `CreateAsync` (minimal-API DI parameter, resolved
  from the container like the existing `ClimateTrackingDbContext`/`IClimateProjectClient`
  parameters).
- Wrapped the `GetHallazgoByIdAsync` call in a try/catch:
  ```csharp
  try
  {
      var hallazgo = await climateProjectClient.GetHallazgoByIdAsync(request.HallazgoExternalId, cancellationToken);
      cicloExternalId = hallazgo?.CicloId;
  }
  catch (Exception ex) when (
      (ex is HttpRequestException or Polly.CircuitBreaker.BrokenCircuitException or TaskCanceledException)
      && !cancellationToken.IsCancellationRequested)
  {
      logger.LogError(
          ex, "Hallazgo lookup failed for {HallazgoExternalId}; creating plan without cicloExternalId",
          request.HallazgoExternalId);
  }
  ```
  - `HttpRequestException` covers `EnsureSuccessStatusCode()` failures and network errors
    after Polly's retries are exhausted.
  - `Polly.CircuitBreaker.BrokenCircuitException` covers the circuit-breaker-open case (this
    type does not derive from `HttpRequestException`, so it needed its own arm — a plain
    `catch (HttpRequestException)` would have missed exactly the failure mode the finding
    called out, an open circuit after 5 failures).
  - `TaskCanceledException` covers `HttpClient`'s own request-timeout path (which surfaces as
    `TaskCanceledException`, not a distinct timeout type).
  - The `!cancellationToken.IsCancellationRequested` guard keeps genuine caller-initiated
    cancellation (client disconnect) propagating normally instead of being swallowed and
    silently turned into "plan created without cicloExternalId".
  - On any of these, the lookup is logged and `cicloExternalId` stays `null` — plan creation
    still succeeds, matching the old (always-null) `HallazgoCache` behavior and the documented
    resilience goal on `AddClimateProjectClient`.
  - This follows the same "log and degrade, don't fail the caller" convention already used
    elsewhere in this codebase for the same client (`CacheSyncWorker.SyncEntityTypeAsync`,
    `DailySemaforoWorker`'s notification-dispatch catch block), so it isn't a new pattern.

### Test coverage added

`services/tracking-api/tests/ClimateTracking.IntegrationTests/Endpoints/PlanesAccionHallazgoLookupTests.cs`:

- Extended `FakeClimateProjectClient` with an `ExceptionToThrowOnHallazgoLookup` property so
  `GetHallazgoByIdAsync` can be made to throw on demand.
- Added a new theory test,
  `CreatingAPlanWhenTheHallazgoLookupThrows_stillCreatesThePlan_withNullCicloEncuestaExternalId`,
  covering all three caught exception types:
  - `HttpRequestException`
  - `Polly.CircuitBreaker.BrokenCircuitException`
  - `TaskCanceledException`

  Each case asserts the request still returns `201 Created` with
  `cicloEncuestaExternalId: null`, i.e. the enrichment failure does not fail plan creation.

### Tests run and real output

Covering tests (the hallazgo-lookup integration tests, including the 3 new cases):

```
$ dotnet test --filter "FullyQualifiedName~PlanesAccionHallazgoLookupTests" tests/ClimateTracking.IntegrationTests
...
Passed!  - Failed:     0, Passed:     5, Skipped:     0, Total:     5, Duration: 3 s - ClimateTracking.IntegrationTests.dll (net10.0)
```

Full suite (unit + integration):

```
$ dotnet test
...
Passed!  - Failed:     0, Passed:    40, Skipped:     0, Total:    40, Duration: 655 ms - ClimateTracking.UnitTests.dll (net10.0)
Passed!  - Failed:     0, Passed:    39, Skipped:     0, Total:    39, Duration: 5 s - ClimateTracking.IntegrationTests.dll (net10.0)
```

Total: 79 tests passed, 0 failed (up from 76 previously, due to the 3 new theory cases
replacing what would otherwise have been a single new fact test).

Build: `dotnet build` — 0 errors, 0 warnings.
