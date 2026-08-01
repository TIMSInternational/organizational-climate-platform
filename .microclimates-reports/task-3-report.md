# Task 3: Microclimate Template Endpoints — Implementation Report

## Overview
Implemented microclimate template CRUD endpoints (list/create) with full authorization checks, DTOs, integration tests, and endpoint registration. All specified tests pass.

## Steps Completed

### Step 1: Create DTOs file ✓
Created `src/ClimateProject.Application/Microclimates/MicroclimateTemplateDtos.cs` with:
- `MicroclimateTemplateDetail` record (contains template metadata: Id, Name, Description, Category, CompanyId, IsSystemTemplate, UsageCount, IsActive)
- `MicroclimateTemplateListResponse` record (wraps list of templates)
- `CreateMicroclimateTemplateRequest` record (input for template creation)

File: `/Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api/.worktrees/microclimates-core/src/ClimateProject.Application/Microclimates/MicroclimateTemplateDtos.cs`

### Step 2: Create test file ✓
Created `tests/ClimateProject.IntegrationTests/Microclimates/MicroclimateTemplateEndpointsTests.cs` with:
- Test fixture setup with PostgresContainerFixture and AuthWebApplicationFactory
- `CompanyAdmin_can_create_and_list_their_own_companys_templates` test that:
  - Creates a company and admin user
  - Signs up and gets auth token for company admin
  - Creates a template via POST `/microclimate-templates`
  - Lists templates via GET `/microclimate-templates?companyId={companyId}`
  - Asserts the created template appears in the list

File: `/Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api/.worktrees/microclimates-core/tests/ClimateProject.IntegrationTests/Microclimates/MicroclimateTemplateEndpointsTests.cs`

### Step 3: Run tests to verify they fail ✓
Ran: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~MicroclimateTemplateEndpointsTests"`
Expected: FAIL (404 — routes don't exist)
Actual: FAIL with 404 NotFound status
- Test correctly failed because the endpoint wasn't implemented yet

### Step 4: Implement the endpoints ✓
Created `src/ClimateProject.Api/Endpoints/MicroclimateTemplateEndpoints.cs` with:
- `MapMicroclimateTemplateEndpoints` extension method that:
  - Maps GET `/microclimate-templates` → `ListAsync` (authenticated)
  - Maps POST `/microclimate-templates` → `CreateAsync` (authenticated)
- `ListAsync` handler that:
  - Validates user is SuperAdmin or owns the company
  - Queries templates where (CompanyId matches or null for system templates) AND IsActive=true
  - Returns paginated list ordered by Name
- `CreateAsync` handler that:
  - Validates user is Admin role (CompanyAdmin or SuperAdmin)
  - Validates permission to create for specified company (if not SuperAdmin, must be their own company)
  - Validates all required fields (Name, Description, Category)
  - Sets IsSystemTemplate = !request.CompanyId.HasValue
  - Initializes UsageCount=0, IsActive=true
  - Returns 201 Created with template detail
- `ToDetail` helper converts database entity to DTO

File: `/Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api/.worktrees/microclimates-core/src/ClimateProject.Api/Endpoints/MicroclimateTemplateEndpoints.cs`

### Step 5: Register endpoint group in Program.cs ✓
Modified `src/ClimateProject.Api/Program.cs`:
- Added `app.MapMicroclimateTemplateEndpoints();` after existing `app.MapMicroclimateEndpoints();` line
- Ensures endpoints are registered during app startup

File: `/Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project-api/.worktrees/microclimates-core/src/ClimateProject.Api/Program.cs`

### Step 6: Run tests to verify they pass ✓
Ran: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~MicroclimateTemplateEndpointsTests"`
Result: **Passed! 1/1** ✓

Ran: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~Microclimate"`
Result: **Passed! 24/24** ✓ (includes all microclimate-related tests: templates, endpoints, live results)

Full suite note: `dotnet test ClimateProject.slnx` shows 188 integration tests pass + 23 unit tests pass = 211 total pass, with 1 pre-existing failure in StartupValidationTests (unrelated to this task).

### Step 7: Commit ✓
Command:
```bash
git add src/ClimateProject.Application/Microclimates/MicroclimateTemplateDtos.cs \
        src/ClimateProject.Api/Endpoints/MicroclimateTemplateEndpoints.cs \
        src/ClimateProject.Api/Program.cs \
        tests/ClimateProject.IntegrationTests/Microclimates/MicroclimateTemplateEndpointsTests.cs
git commit -m "feat: add microclimate template list/create endpoints"
```

Commit SHA: `7b249063244a7a200578725d9e163c16d8441526`

## Implementation Details

### Authorization Model
- List: SuperAdmin access all companies' templates, CompanyAdmins see templates for their company only
- Create: Only Admin roles (CompanyAdmin + SuperAdmin) can create; CompanyAdmins can only create for their own company
- System templates (CompanyId=null) are shared across all companies but only SuperAdmins can create them

### DTOs Used
All DTOs use sealed records for immutability and null-safety per existing codebase conventions.

### Files Changed
- **Created**: 3 files (DTOs, Endpoints, Tests)
- **Modified**: 1 file (Program.cs for registration)
- **Total lines added**: 181 lines

## Test Results Summary
- Task 3 specific test: **1/1 PASS** ✓
- All microclimate tests: **24/24 PASS** ✓
- No regressions introduced

## Status
✅ Task 3 COMPLETE — All steps executed exactly as specified in the plan, all tests pass, code committed.

## Fix round

Addressed review findings on commit `7b249063244a7a200578725d9e163c16d8441526`:

1. **Cross-tenant data-visibility break in `CreateAsync` (Critical).** The own-company
   ownership check was guarded by `request.CompanyId.HasValue &&`, so a CompanyAdmin who
   submitted `CompanyId: null` skipped the check entirely, fell through to
   `IsSystemTemplate = !request.CompanyId.HasValue` → `true`, and could create a
   `CompanyId = null` template. `ListAsync`'s filter
   (`t.CompanyId == companyId || t.CompanyId == null`) then surfaces that template to
   every other company's template list — a real authorization defect, not just a plan
   artifact, even though the vulnerable code was copied verbatim from the plan
   (lines 951-954).

   **Fix:** in `src/ClimateProject.Api/Endpoints/MicroclimateTemplateEndpoints.cs`,
   `CreateAsync` now requires non-SuperAdmins to supply a `CompanyId` that matches their
   own company; a missing/null `CompanyId` is treated as a forbidden attempt to create a
   system template, consistent with the `CanAccessCompany` pattern used everywhere else
   in this domain (`MicroclimateEndpoints.CanAccessCompany`, `UserEndpoints`,
   `DepartmentEndpoints`, etc.):

   ```csharp
   if (currentUser.Role != Roles.SuperAdmin
       && (!request.CompanyId.HasValue || currentUser.CompanyId != request.CompanyId.Value.ToString()))
   {
       // Non-SuperAdmins must supply their own CompanyId; a null CompanyId would create
       // an IsSystemTemplate=true template visible to every company (see ListAsync's
       // `t.CompanyId == companyId || t.CompanyId == null` filter), which only SuperAdmins
       // are allowed to do.
       return Results.Forbid();
   }
   ```

   Only a SuperAdmin can now create `IsSystemTemplate=true` / `CompanyId=null` templates.

2. **Report misstated the authorization model (finding #2).** The original "Implementation
   Details" section (line 87) claimed "only SuperAdmins can create [system templates]"
   while the shipped code let any CompanyAdmin do so via `CompanyId: null`. That line is
   now accurate as of the fix above — SuperAdmin-only creation of system templates is
   enforced in code, not just claimed in prose.

### Regression tests added

Added two tests to
`tests/ClimateProject.IntegrationTests/Microclimates/MicroclimateTemplateEndpointsTests.cs`:

- `CompanyAdmin_cannot_create_system_template_by_omitting_CompanyId` — asserts a
  CompanyAdmin POSTing with `CompanyId: null` gets `403 Forbidden`, and that no template
  with that name exists in the database afterward (closes the cross-tenant leak path).
- `CompanyAdmin_cannot_create_template_for_another_company` — asserts a CompanyAdmin
  POSTing with someone else's `CompanyId` gets `403 Forbidden` (pre-existing behavior,
  now covered explicitly).

### Test output

Ran: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~MicroclimateTemplateEndpointsTests"`

```
Passed!  - Failed:     0, Passed:     3, Skipped:     0, Total:     3, Duration: 10 s - ClimateProject.IntegrationTests.dll (net10.0)
```

Ran: `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~Microclimate"` (full domain regression check)

```
Passed!  - Failed:     0, Passed:    26, Skipped:     0, Total:    26, Duration: 27 s - ClimateProject.IntegrationTests.dll (net10.0)
```

(26 = previous 24 + the 2 new regression tests added above; no regressions.)

### Fix commit

Commit SHA: see repo HEAD after this fix round.
