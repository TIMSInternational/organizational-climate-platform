# Task 3: Action Plan Template Endpoints - Execution Report

## Summary
Successfully implemented action plan template CRUD endpoints (list and create) with full test coverage.

## Steps Completed

### Step 1: DTOs
Created `src/ClimateProject.Application/ActionPlans/ActionPlanTemplateDtos.cs` with three record types:
- `ActionPlanTemplateDetail`: Full template detail response
- `ActionPlanTemplateListResponse`: List response wrapper
- `CreateActionPlanTemplateRequest`: Create request payload

**Status:** ✓ PASS

### Step 2: Test File Creation
Created `tests/ClimateProject.IntegrationTests/ActionPlans/ActionPlanTemplateEndpointsTests.cs` with two test cases:
1. `CompanyAdmin_can_create_and_list_their_own_companys_templates` - Tests creating and listing company-scoped templates
2. `System_templates_with_no_company_are_visible_to_everyone` - Tests system-wide (CompanyId=null) template visibility

**Status:** ✓ PASS

### Step 3: Initial Test Run (Expected Failure)
Ran initial tests to verify they fail before implementation.
```
dotnet test ClimateProject.slnx --filter "FullyQualifiedName~ActionPlanTemplateEndpointsTests"
```
**Expected Result:** FAIL (compile error)
**Actual Result:** FAIL with 404 endpoints not found

**Status:** ✓ EXPECTED BEHAVIOR

### Step 4: Endpoint Implementation
Created `src/ClimateProject.Api/Endpoints/ActionPlanTemplateEndpoints.cs` with:
- `MapActionPlanTemplateEndpoints()` extension method
- `ListAsync` handler: GET /action-plan-templates with company filtering
- `CreateAsync` handler: POST /action-plan-templates with role-based authorization
- `ToDetail` helper: Converts entity to DTO

**Authorization:** 
- List: SuperAdmin access to any company, CompanyAdmin access to own company only
- Create: Admin role required; CompanyAdmin can only create for own company

**Status:** ✓ PASS

### Step 5: Program.cs Registration
Added endpoint group registration in `src/ClimateProject.Api/Program.cs`:
```csharp
app.MapActionPlanTemplateEndpoints();
```
Registered after `app.MapActionPlanEndpoints();` as specified.

**Status:** ✓ PASS

### Step 6: Full Test Run
Ran tests after implementation:
```
dotnet test ClimateProject.slnx --filter "FullyQualifiedName~ActionPlanTemplateEndpointsTests"
```

**Result:** ✓ PASS, 2/2 tests passed

#### Test Details:
1. **CompanyAdmin_can_create_and_list_their_own_companys_templates**
   - Creates template via POST endpoint
   - Lists templates via GET endpoint with company ID filter
   - Verifies template appears in list response
   - Status: ✓ PASS

2. **System_templates_with_no_company_are_visible_to_everyone**
   - Creates system user with SuperAdmin role
   - Adds system template (CompanyId=null) to database
   - Verifies CompanyAdmin can see system template in their company's template list
   - Status: ✓ PASS

**Note on Test Implementation:**
The test for system templates required modification from the plan's original code to handle FK constraints:
- Original test used `Guid.NewGuid()` for CreatedBy, violating FK constraint
- Fixed by creating a real system user and assigning it as template creator
- Used existing company ID to satisfy User.CompanyId FK constraint

### Step 7: Commit
Staged all files and committed with message: "feat: add action plan template list/create endpoints"

```bash
git add src/ClimateProject.Application/ActionPlans/ActionPlanTemplateDtos.cs \
        src/ClimateProject.Api/Endpoints/ActionPlanTemplateEndpoints.cs \
        src/ClimateProject.Api/Program.cs \
        tests/ClimateProject.IntegrationTests/ActionPlans/ActionPlanTemplateEndpointsTests.cs
git commit -m "feat: add action plan template list/create endpoints"
```

**Commit SHA:** f8a3b88c320472ad55051796eaa71a8744ed1fa7
**Status:** ✓ PASS

## Files Modified/Created

### Created:
1. `src/ClimateProject.Application/ActionPlans/ActionPlanTemplateDtos.cs` (19 lines)
2. `src/ClimateProject.Api/Endpoints/ActionPlanTemplateEndpoints.cs` (88 lines)
3. `tests/ClimateProject.IntegrationTests/ActionPlans/ActionPlanTemplateEndpointsTests.cs` (107 lines)

### Modified:
1. `src/ClimateProject.Api/Program.cs` (added 1 line for endpoint registration)

## Deviations from Plan

### Test Implementation Deviation (Minor)
The second test in the plan had a latent FK constraint bug that would prevent the test from running:
- **Issue:** The test attempted to create an ActionPlanTemplate with `CreatedBy = Guid.NewGuid()` which doesn't reference a real user
- **Solution:** Modified the test to create a system user before adding the template to the database
- **Reason:** This aligns with the pattern already used in the endpoint implementation where CreatedBy references actual users from the database
- **Result:** Both tests now pass successfully

## Test Results Summary
- **ActionPlanTemplateEndpointsTests.CompanyAdmin_can_create_and_list_their_own_companys_templates:** PASS
- **ActionPlanTemplateEndpointsTests.System_templates_with_no_company_are_visible_to_everyone:** PASS

## Architecture Compliance
- Follows established pattern from prior domain implementations
- Uses minimal-API endpoints with `RequireAuthorization()` + manual role checks
- Role validation: `Roles.Admin.Contains()` for admin requirements
- Company access check: `CanAccessCompany()` pattern for CompanyAdmin restrictions
- No `[Authorize(Roles=)]` attributes used (as per constraint)
- Status/priority/frequency validation uses constants from validation class (inherited from Task 1)

## Final Status
✓ **COMPLETE** - All steps executed successfully. Task 3 is ready for integration with subsequent tasks.

## Fix round

### Finding addressed
`ActionPlanTemplateEndpoints.cs:57` (`CreateAsync`) — the cross-company check
`request.CompanyId.HasValue && ...` was skipped entirely when `CompanyId` was
`null`. Because the `List` query (`t.CompanyId == companyId || t.CompanyId ==
null`) surfaces every `CompanyId == null` template to every company, any
`company_admin` (not just `super_admin`) could POST a template with
`CompanyId: null` and have it show up in every other tenant's template list —
a cross-tenant privilege-escalation / content-injection gap. This was copied
verbatim from the plan's Step 4 code block, so it was a plan-authored defect
that shipped without a covering test.

### Fix
Changed the authorization check in `CreateAsync` so that any user who is not
`Roles.SuperAdmin` must supply a `CompanyId` equal to their own company —
`CompanyId == null` (a system-wide template) is now only reachable by
`super_admin`:

```csharp
if (currentUser.Role != Roles.SuperAdmin
    && (!request.CompanyId.HasValue || currentUser.CompanyId != request.CompanyId.Value.ToString()))
{
    // Non-super-admins must scope the template to their own company; only a
    // super_admin may create a system-wide template (CompanyId == null), which
    // would otherwise be visible to every tenant via the List query.
    return Results.Forbid();
}
```

Previously the condition only ran when `request.CompanyId.HasValue` was
`true`, so a `null` `CompanyId` bypassed the check entirely regardless of
role. Now a non-super-admin request with `CompanyId: null` (or a
`CompanyId` belonging to a different company) is rejected with 403.

### Test added
Added a regression test to
`tests/ClimateProject.IntegrationTests/ActionPlans/ActionPlanTemplateEndpointsTests.cs`:

- `CompanyAdmin_cannot_create_a_system_wide_template_with_null_company_id` —
  a `company_admin` POSTs a template with `CompanyId: null`, asserts the
  response is `403 Forbidden`, and asserts no row with that template's name
  was persisted (belt-and-suspenders against a partial-write regression).

### Test output

Targeted run:
```
dotnet test ClimateProject.slnx --filter "FullyQualifiedName~ActionPlanTemplateEndpointsTests"
...
Passed!  - Failed:     0, Passed:     3, Skipped:     0, Total:     3, Duration: 13 s - ClimateProject.IntegrationTests.dll (net10.0)
```
(3/3: the two pre-existing tests plus the new regression test, all passing.)

Full suite run:
```
dotnet test ClimateProject.slnx
...
Passed!  - Failed:     0, Passed:    23, Skipped:     0, Total:    23, Duration: 5 s - ClimateProject.UnitTests.dll (net10.0)
Passed!  - Failed:     0, Passed:   193, Skipped:     0, Total:   193, Duration: 2 m 59 s - ClimateProject.IntegrationTests.dll (net10.0)
```
No regressions in the rest of the suite.

### Status
✓ **FIXED** — finding resolved, regression test added and passing, full suite green.
