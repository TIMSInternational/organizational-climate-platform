# Task 2 Implementation Report

## Overview
Successfully implemented the internal API-key authentication filter and real `/api/internal/nodos,personas` endpoints for the tracking-module integration.

## Files Created/Modified

### Created Files:
1. `src/ClimateProject.Api/Infrastructure/InternalApiKeyFilter.cs` - Endpoint filter for internal API-key authentication
2. `src/ClimateProject.Application/Tracking/TrackingInternalDtos.cs` - DTOs for internal endpoints (Envelope, NodoInternalDto, PersonasData, etc.)
3. `src/ClimateProject.Api/Endpoints/TrackingInternalEndpoints.cs` - Internal endpoints implementation
4. `tests/ClimateProject.IntegrationTests/Tracking/TrackingInternalEndpointsTests.cs` - Integration tests

### Modified Files:
1. `src/ClimateProject.Api/appsettings.json` - Added `"InternalApiKey": ""` config key
2. `src/ClimateProject.Api/Program.cs` - Added `app.MapTrackingInternalEndpoints();` registration
3. `tests/ClimateProject.IntegrationTests/Support/AuthWebApplicationFactory.cs` - Added `TestInternalApiKey` constant and wired it into test configuration

## Implementation Details

### Step 1: Added InternalApiKey config
- Added `"InternalApiKey": ""` to `appsettings.json` alongside existing TrackingJwtSecret

### Step 2: Implemented InternalApiKeyFilter
- Created a sealed class implementing `IEndpointFilter`
- Validates Authorization header with "Bearer {key}" format
- Returns 401 Unauthorized for missing/wrong keys
- Returns 500 Internal Server Error if API key is not configured

### Step 3: Created Internal DTOs
- `Envelope<TData>` - Generic wrapper for all internal endpoint responses
- `NodoInternalDto` - DTO for department/nodo data with fields: NodoId, Nombre, NodoPadreId, LiderId, CantidadColaboradores, Activo, CompanyId
- `NodosData` - Wrapper containing list of NodoInternalDto
- `PersonaInternalDto` - DTO for user/persona data with fields: PersonaId, NombreCompleto, Correo, NodoId, ManagerId, Rol, Activo, CompanyId
- `PersonasData` - Wrapper containing list of PersonaInternalDto

### Step 4: Implemented Internal Endpoints
Two endpoints under `/api/internal` group with internal API-key filter:
- `GET /api/internal/nodos?company_id={id}` - Lists all departments for a company
- `GET /api/internal/personas?company_id={id}` - Lists all users for a company
- Both use snake_case JSON serialization via explicit JsonSerializerOptions

### Step 5: Registered Endpoints and Updated Factory
- Registered `app.MapTrackingInternalEndpoints();` in Program.cs after tracking picker endpoints
- Added `TestInternalApiKey = "integration-test-internal-api-key"` constant to AuthWebApplicationFactory
- Added InternalApiKey to test configuration in-memory collection

### Step 6: Wrote Integration Tests
Three test cases validating:
1. **Returns_nodos_with_snake_case_envelope_shape** - Verifies nodos endpoint returns correct snake_case format
2. **Returns_personas_with_persona_external_id** - Verifies personas endpoint returns correct data with external ID fallback
3. **Rejects_request_with_missing_or_wrong_api_key** - Verifies authentication is enforced

### Test Data Generation
Tests use unique identifiers per test run to avoid unique constraint violations:
- Company domain: `internal-{Guid}.test`
- User email: `persona@{companyDomain}`
- Department legacy ID: `legacy-nodo-{Guid}`
- User persona ID: `legacy-persona-{Guid}`

## Test Results
```
Test run for ClimateProject.IntegrationTests.dll (.NETCoreApp,Version=v10.0)
VSTest version 18.0.1 (arm64)

Passed!  - Failed: 0, Passed: 3, Skipped: 0, Total: 3, Duration: 4 s
```

All three integration tests pass successfully.

## Commit
```
Commit: 1a5b475736b65ccb3534f8b006f0e61fcf5caf8b
Message: feat: add internal API-key auth and real /api/internal/nodos,personas endpoints
```

## Key Implementation Notes

1. **Separate Auth Mechanism**: Internal endpoints use a completely separate authentication mechanism (static API key via IEndpointFilter) rather than JWT, as they are called by climate-tracking itself, not user browser sessions.

2. **Snake Case JSON**: Only internal endpoints use snake_case JSON serialization via explicit JsonSerializerOptions. All other endpoints maintain default camelCase.

3. **External ID Fallbacks**: Both nodos and personas use the fallback pattern:
   - Nodo ID: `department.LegacyExternalId ?? department.Id.ToString()`
   - Persona ID: `user.PersonaExternalId ?? user.Id.ToString()`

4. **Relationship Mapping**: Endpoints properly load and map manager relationships for both departments and users.

5. **No Schema Changes**: Implementation uses existing `Department.LegacyExternalId`, `User.PersonaExternalId`, and `User.NodoId` fields from prior slices.

## Deviations from Plan

One necessary change from the plan:
- Test data now generates unique IDs per test run to prevent unique constraint violations in repeated test execution
- The plan used hardcoded legacy IDs (`legacy-nodo-42`, `legacy-persona-7`) which caused database constraint violations
- Changed assertions to validate prefix matching instead of exact hardcoded values
- This maintains the intent of testing external ID fallback while ensuring test repeatability

## Fix round

### Finding addressed
`src/ClimateProject.Api/Infrastructure/InternalApiKeyFilter.cs:15` — the API key comparison used plain string `!=`, which is not constant-time and creates a timing side-channel on the internal auth boundary. This was copied verbatim from the plan's own code block (a plan-authored defect), but still needed fixing before this key protects an internet-reachable endpoint.

### Change made
Replaced the `!=` string comparison with a constant-time comparison:
- Added a private `ConstantTimeEquals(string actual, string expected)` helper that compares UTF-8 byte spans using `System.Security.Cryptography.CryptographicOperations.FixedTimeEquals`.
- `FixedTimeEquals` requires equal-length inputs to run in constant time; when the candidate key and the configured key differ in length, the helper instead hashes both with SHA-256 (fixed 32-byte output) and runs `FixedTimeEquals` on the hashes purely to avoid a length-dependent branch cost, then returns `false` — this means a mismatched length never short-circuits on the raw key length and always pays the same comparison cost as a same-length attempt.
- `InvokeAsync` now calls `ConstantTimeEquals(authHeader[prefix.Length..], expectedKey)` instead of `authHeader[prefix.Length..] != expectedKey`.
- No public API, DTO, or endpoint route shape changed; the fix is confined to `InternalApiKeyFilter.cs`.

### Tests run (covering tests for the amended code)
Ran the full `TrackingInternalEndpointsTests` suite (all three tests exercise the filter: two happy-path tests present a correct key end-to-end through `InvokeAsync`, and `Rejects_request_with_missing_or_wrong_api_key` directly exercises the mismatch/failure path that was changed):

```
$ dotnet test tests/ClimateProject.IntegrationTests/ClimateProject.IntegrationTests.csproj --filter "FullyQualifiedName~TrackingInternalEndpointsTests"

Test run for /Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api/.worktrees/tracking-integration-api/tests/ClimateProject.IntegrationTests/bin/Debug/net10.0/ClimateProject.IntegrationTests.dll (.NETCoreApp,Version=v10.0)
VSTest version 18.0.1 (arm64)

Starting test execution, please wait...
A total of 1 test files matched the specified pattern.

Passed!  - Failed:     0, Passed:     3, Skipped:     0, Total:     3, Duration: 5 s - ClimateProject.IntegrationTests.dll (net10.0)
```

Also verified `dotnet build src/ClimateProject.Api/ClimateProject.Api.csproj` succeeds with 0 warnings, 0 errors.

### Commit
```
Commit: (see StructuredOutput / git log for SHA)
Message: fix: use constant-time comparison for internal API key check
```
