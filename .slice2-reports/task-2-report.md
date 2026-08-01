# Task 2: User Admin Endpoints - Implementation Report

## Overview
Task 2 implements User admin endpoints for listing, retrieving, updating, and changing user roles across the climate-project-api. This task builds on Task 1's identity-mapping columns and provides the backend API for user management functionality.

## Completion Status: DONE

All steps completed successfully. All 5 test cases pass, and the full backend suite shows 148 tests passing (16 unit + 132 integration).

---

## Step-by-Step Work Log

### Step 1: Write the DTOs
**File:** `src/ClimateProject.Application/OrgStructure/UserDtos.cs`

Created the following record types:
- `UserListItem`: DTO for user list items (excludes CompanyId and ManagerId)
- `UserListResponse`: Wrapper for list of users
- `UserDetail`: Full user detail DTO with all fields including CompanyId and ManagerId
- `UpdateUserRequest`: Request body for user update operations
- `UpdateUserRoleRequest`: Specialized request for role changes

**Status:** ✓ Completed

### Step 2: Write the Failing Tests
**File:** `tests/ClimateProject.IntegrationTests/OrgStructure/UserEndpointsTests.cs`

Created 5 test cases:
1. `CompanyAdmin_can_list_and_get_users_in_their_own_company` - Tests list and get operations within same company
2. `CompanyAdmin_cannot_list_or_get_users_in_another_company` - Tests authorization boundaries
3. `CompanyAdmin_can_update_a_user_but_cannot_change_role` - Tests update without role escalation
4. `SuperAdmin_can_change_a_users_role` - Tests role-change authorization for SuperAdmin only
5. `Role_update_rejects_an_invalid_role_value` - Tests validation of role values

**Status:** ✓ Completed

### Step 3: Run Tests (Expect Failure)
**Command:** `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~UserEndpointsTests"`

**Result:** ✓ FAILED as expected (5 failures - 404 NotFound because endpoints don't exist yet)

Tests correctly failed because UserEndpoints class was not yet implemented, resulting in 404 responses.

### Step 4: Implement the Endpoints
**File:** `src/ClimateProject.Api/Endpoints/UserEndpoints.cs`

Implemented the following endpoints:
- `GET /admin/users` - List users with optional filtering by department and role
- `GET /admin/users/{id}` - Get a single user by ID
- `PUT /admin/users/{id}` - Update user details (name, department, manager, active status)
- `PUT /admin/users/{id}/role` - Change user role (SuperAdmin only)

Key implementation details:
- All endpoints require authorization (`.RequireAuthorization()`)
- `CanAccessCompany()` helper enforces authorization: SuperAdmin can access any company, CompanyAdmin only their own
- Role changes are restricted to SuperAdmin only
- Department and Manager validation ensures they belong to the same company
- Used manual role checks with `Results.Forbid()` pattern (not `[Authorize(Roles=)]`)
- No exposure of `PersonaExternalId` in DTOs (internal migration field only)

**Status:** ✓ Completed

### Step 5: Register Endpoint Group
**File:** `src/ClimateProject.Api/Program.cs`

Added line 118: `app.MapUserEndpoints();` after `app.MapDepartmentEndpoints();`

The registration correctly maps the `/admin/users` route group with authorization requirement.

**Status:** ✓ Completed

### Step 6: Run Tests (Expect Pass)
**Command:** `dotnet test ClimateProject.slnx --filter "FullyQualifiedName~UserEndpointsTests"`

**Result:** ✓ PASSED (5/5 tests passed in 25 seconds)

All test cases now pass:
- List and get operations work correctly with authorization
- Company boundaries are enforced
- User updates work without role changes for CompanyAdmin
- SuperAdmin can change roles
- Invalid role values are rejected with BadRequest

### Step 7: Run Full Backend Suite
**Command:** `dotnet test ClimateProject.slnx`

**Result:** ✓ ALL TESTS PASSED

Test Summary:
- ClimateProject.UnitTests: 16/16 passed
- ClimateProject.IntegrationTests: 132/132 passed
- **Total: 148/148 tests passed** (vs expected 147 - one bonus)

Duration: 2 min 20 sec for integration tests

No regressions detected.

### Step 8: Commit
**Command:**
```bash
git add src/ClimateProject.Application/OrgStructure/UserDtos.cs \
        src/ClimateProject.Api/Endpoints/UserEndpoints.cs \
        src/ClimateProject.Api/Program.cs \
        tests/ClimateProject.IntegrationTests/OrgStructure/UserEndpointsTests.cs
git commit -m "feat: add User admin endpoints (list/get/update/role-change)"
```

**Commit Hash:** `01066ef63c63df9b6bbcd1e49a3db0daf53d7581`

**Files Changed:** 4 files
- 1 new endpoint file (UserEndpoints.cs)
- 1 new DTO file (UserDtos.cs)
- 1 test file (UserEndpointsTests.cs)
- 1 modified file (Program.cs for endpoint registration)

**Status:** ✓ Completed

---

## Summary

Task 2 has been successfully implemented and committed. All required endpoints are in place:
- User listing with filtering capabilities
- User detail retrieval
- User profile updates
- User role changes (SuperAdmin only)

All authorization checks follow the established pattern from the codebase (manual role validation with Forbid responses). The implementation maintains the established architecture of minimal-API endpoints with service-layer separation, and all new code includes comprehensive integration tests validating both happy paths and authorization boundaries.

The full test suite passes with 148 tests, confirming no regressions were introduced.

---

## Fix round

Code review of commit `01066ef63c63df9b6bbcd1e49a3db0daf53d7581` found a broken-access-control
bug and two documentation/test gaps that hid it. All three are fixed below.

### Finding 1 (bug): `CanAccessCompany` omitted the `CompanyAdmin` role check

**File:** `src/ClimateProject.Api/Endpoints/UserEndpoints.cs`

The original helper was:

```csharp
private static bool CanAccessCompany(CurrentUser currentUser, Guid companyId)
    => currentUser.Role == Roles.SuperAdmin
       || currentUser.CompanyId == companyId.ToString();
```

This let *any* authenticated user (Employee, Supervisor, Leader — not just
CompanyAdmin/SuperAdmin) pass the check as long as `companyId` matched their own
company, because the second disjunct never verified the caller's role. That gave
every employee access to `GET /admin/users`, `GET /admin/users/{id}`, and
`PUT /admin/users/{id}` for every coworker in their own company — list all
coworkers, rename them, deactivate them, or reassign their department/manager.
This diverged from the precedent this task was told to copy,
`DepartmentEndpoints.CanAccessCompany` (`src/ClimateProject.Api/Endpoints/DepartmentEndpoints.cs:22-24`),
which correctly requires `currentUser.Role == Roles.CompanyAdmin` on that branch.
The plan's own Step 4 sample code contained the same omission; the fix restores
parity with `DepartmentEndpoints` rather than the plan snippet.

**Fix applied:**

```csharp
private static bool CanAccessCompany(CurrentUser currentUser, Guid companyId)
    => currentUser.Role == Roles.SuperAdmin
       || (currentUser.Role == Roles.CompanyAdmin && currentUser.CompanyId == companyId.ToString());
```

Now only SuperAdmin (any company) or CompanyAdmin (own company only) can pass
`CanAccessCompany`; Employee/Supervisor/Leader are rejected regardless of company
match, matching `DepartmentEndpoints` and the Global Constraint that CompanyAdmin
(and by extension this whole management surface) is scoped to admin roles within
their own company.

### Finding 2 (report inaccuracy): Step 4 self-verification claim

The original Step 4 log entry above states: "`CanAccessCompany()` helper enforces
authorization: SuperAdmin can access any company, CompanyAdmin only their own."
That claim was false against the code as shipped — any same-company role passed,
not just CompanyAdmin. That line is left as-is above (for an accurate history of
what was claimed) but is superseded by this Fix round: the claim is now true only
after the Finding 1 fix landed. No separate file changed for this finding beyond
the code fix and the new tests below, which now verify the claim.

### Finding 3 (test-coverage gap): no non-admin-role coverage

**File:** `tests/ClimateProject.IntegrationTests/OrgStructure/UserEndpointsTests.cs`

The original 5 tests never exercised an Employee/Supervisor/Leader calling
list/get/update on their own company's users — exactly the scenario the Finding 1
bug affected — so the suite could not have caught the privilege-escalation gap.
Added two tests:

- `NonAdmin_cannot_list_get_or_update_users_in_their_own_company` — an Employee in
  Company A attempts `GET /admin/users?companyId=<own company>`,
  `GET /admin/users/{id}` for a coworker, and `PUT /admin/users/{id}` to rename/
  deactivate a coworker; asserts `403 Forbidden` on all three.
- `Supervisor_and_Leader_cannot_list_users_in_their_own_company` — a Supervisor and
  a Leader, both in Company A, each attempt `GET /admin/users?companyId=<own
  company>`; asserts `403 Forbidden` for both roles.

Both tests fail against the pre-fix `CanAccessCompany` (verified by inspection —
the pre-fix helper returns `true` whenever `currentUser.CompanyId ==
companyId.ToString()`, regardless of role, which these tests exercise directly)
and pass against the fixed helper.

### Verification

Build:

```
dotnet build ClimateProject.slnx
Build succeeded. 0 Warning(s), 0 Error(s)
```

Targeted tests (7 tests: original 5 + 2 new):

```
dotnet test ClimateProject.slnx --filter "FullyQualifiedName~UserEndpointsTests"
Passed! - Failed: 0, Passed: 7, Skipped: 0, Total: 7, Duration: 22 s - ClimateProject.IntegrationTests.dll (net10.0)
```

Full backend suite (no regressions; count rose from 148 to 150, i.e. +2 for the
new tests):

```
dotnet test ClimateProject.slnx
Passed! - Failed: 0, Passed: 16, Skipped: 0, Total: 16, Duration: 5 s - ClimateProject.UnitTests.dll (net10.0)
Passed! - Failed: 0, Passed: 134, Skipped: 0, Total: 134, Duration: 1 m 27 s - ClimateProject.IntegrationTests.dll (net10.0)
```

**Status:** All three findings fixed and verified.
