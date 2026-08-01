# Task 3 Implementation Report

## Task: Invitation creation, list, and resend endpoints

**Commit:** 74649c2c449268ed623f8094fcf4516e981cdfc0

### Overview
Task 3 implements the invitation flow endpoints for creating, listing, and resending invitations. This includes support for three invitation types: company admin setup, employee direct, and employee self-signup (shareable links).

---

## Implementation Details

### Step 1: Create InvitationValidation.cs ✓
**File:** `src/ClimateProject.Application/OrgStructure/InvitationValidation.cs`

Created with constants for:
- Invitation types: `TypeCompanyAdminSetup`, `TypeEmployeeDirect`, `TypeEmployeeSelfSignup`
- Statuses: `StatusPending`, `StatusSent`, `StatusAccepted`

**Status:** Complete - file created with all required constants.

### Step 2: Create DTOs and Email Sender Interface ✓
**Files:** 
- `src/ClimateProject.Application/OrgStructure/InvitationDtos.cs`
- `src/ClimateProject.Application/OrgStructure/IInvitationEmailSender.cs`

Created DTOs:
- `InvitationDetail` - full invitation information including token
- `InvitationListResponse` - wrapper for list responses
- `CreateInvitationRequest` - for creating direct/company-admin invitations
- `CreateShareableLinkRequest` - for shareable link creation

Created interface:
- `IInvitationEmailSender` - async email sending abstraction

**Status:** Complete - all DTOs and interface implemented as specified.

### Step 3: Create Email Sender Implementation ✓
**File:** `src/ClimateProject.Infrastructure/OrgStructure/LoggingInvitationEmailSender.cs`

Implemented `IInvitationEmailSender` with stub that logs invitation details (email, type, token, expiry) using `ILogger`. No actual email sent in this slice.

**Status:** Complete - logging implementation created.

### Step 4: Create Failing Tests ✓
**File:** `tests/ClimateProject.IntegrationTests/OrgStructure/InvitationEndpointsTests.cs`

Created 7 comprehensive tests:
1. `SuperAdmin_can_create_a_company_admin_setup_invitation` - verifies role override
2. `CompanyAdmin_cannot_create_a_company_admin_setup_invitation` - permission check
3. `CompanyAdmin_can_create_an_employee_direct_invitation_in_their_own_company_only` - scoping
4. `Employee_direct_invitation_rejects_superadmin_role` - role validation
5. `Shareable_link_creates_an_invitation_with_no_email` - nullable email
6. `Resend_regenerates_the_token_and_extends_expiry` - token regeneration
7. `List_returns_invitations_scoped_to_the_callers_company` - authorization scoping

**Status:** Complete - all tests created.

### Step 5: Run Failing Tests ✓
```bash
dotnet test ClimateProject.slnx --filter "FullyQualifiedName~InvitationEndpointsTests"
```

Expected: FAIL (compile error - InvitationEndpoints doesn't exist yet)

Before implementation, confirmed tests would not compile due to missing endpoint class.

**Status:** Verified.

### Step 6: Implement Endpoints ✓
**File:** `src/ClimateProject.Api/Endpoints/InvitationEndpoints.cs`

Implemented static class with:
- `MapInvitationEndpoints()` - route registration
- `CreateAsync()` - POST /admin/invitations
  - Validates invitation type (company_admin_setup or employee_direct)
  - Enforces role restrictions (SuperAdmin only for company admin setup)
  - Validates company access (CompanyAdmin can only create in own company)
  - Rejects SuperAdmin role in employee invitations
  - Validates department exists in same company
  - Generates 7-day expiry and token
  - Calls email sender, marks as sent
- `CreateShareableLinkAsync()` - POST /admin/invitations/shareable-link
  - Creates employee_self_signup invitation with null email
  - No email sending for shareable links (sent directly to DB)
- `ResendAsync()` - POST /admin/invitations/{id}/resend
  - Regenerates token and expiry
  - Increments reminder count
  - Re-sends email
  - Validates invitation not already accepted
- `ListAsync()` - GET /admin/invitations?companyId=X
  - Returns invitations filtered by company
  - Ordered by sent timestamp (descending)
  - Scoped to caller's company (SuperAdmin bypass)

Helper methods:
- `CanAccessCompany()` - authorization check
- `ToDetail()` - entity to DTO conversion
- `ResolveActingUserIdAsync()` - resolves user ID from email (accounts for PersonaExternalId in JWT sub claim)

**Status:** Complete - all endpoints implemented with full authorization and validation.

### Step 7: Register DI Service and Endpoints ✓
**File:** `src/ClimateProject.Api/Program.cs`

Changes:
1. Added `using ClimateProject.Infrastructure.OrgStructure;`
2. Registered `IInvitationEmailSender` with `LoggingInvitationEmailSender` implementation
3. Added `app.MapInvitationEndpoints();` to endpoint registration chain

**Status:** Complete - service and endpoint registration added.

### Step 8: Run Tests ✓
```bash
dotnet test ClimateProject.slnx --filter "FullyQualifiedName~InvitationEndpointsTests"
```

**Result:** PASS, 7/7 tests passing

```
Passed!  - Failed:     0, Passed:     7, Skipped:     0, Total:     7, Duration: 17 s
```

All test scenarios pass:
- SuperAdmin privileges verified
- CompanyAdmin scoping verified
- Role validation working correctly
- Shareable link creation with null email working
- Token regeneration and reminder count increment working
- Authorization scoping on list endpoint working

**Status:** Complete - all tests passing.

### Step 9: Full Test Suite ✓
```bash
dotnet test ClimateProject.slnx
```

**Result:** All tests pass

```
Passed!  - Failed:     0, Passed:    16, Skipped:     0, Total:    16, Duration: 6 s - ClimateProject.UnitTests.dll (net10.0)
Passed!  - Failed:     0, Passed:   141, Skipped:     0, Total:   141, Duration: 1 m 36 s - ClimateProject.IntegrationTests.dll (net10.0)
```

Total: 157 tests passing (16 unit + 141 integration)

No test regressions detected.

**Status:** Complete - full suite clean.

### Step 10: Commit ✓
```bash
git add src/ClimateProject.Application/OrgStructure/InvitationDtos.cs \
        src/ClimateProject.Application/OrgStructure/InvitationValidation.cs \
        src/ClimateProject.Application/OrgStructure/IInvitationEmailSender.cs \
        src/ClimateProject.Infrastructure/OrgStructure/LoggingInvitationEmailSender.cs \
        src/ClimateProject.Api/Endpoints/InvitationEndpoints.cs \
        src/ClimateProject.Api/Program.cs \
        tests/ClimateProject.IntegrationTests/OrgStructure/InvitationEndpointsTests.cs

git commit -m "feat: add invitation create/shareable-link/resend/list endpoints with stubbed email"
```

**Commit Hash:** 74649c2c449268ed623f8094fcf4516e981cdfc0

**Status:** Complete - all changes committed.

---

## Key Implementation Notes

### Authorization Pattern
- Follows established precedent from Tasks 1-2
- `.RequireAuthorization()` on route group + manual role check in handler
- `Results.Forbid()` on permission denial
- `CanAccessCompany()` helper duplicated per endpoint file (established codebase pattern)

### Email Stub Behavior
- `LoggingInvitationEmailSender` logs to `ILogger` with full invitation details
- Frontend receives raw `Token` in response to build accept URL itself
- No real Brevo integration in this slice

### Token Generation
- Uses `Guid.NewGuid().ToString("N")` format
- 7-day expiry from creation/resend
- Each resend generates new token (accept-once per token)

### Company Scoping
- SuperAdmin can create invitations for any company
- CompanyAdmin limited to own company only
- CompanyAdmin cannot create company_admin_setup invitations (SuperAdmin only)
- List endpoint returns 403 Forbidden if caller tries to access another company

### Shareable Links
- Email is nullable - shareable links have `Email: null` in DB
- Domain validation on accept (Task 4 concern, not here)
- No email sent by invitation creation (no email to send to)
- Self-signup type, employee role, sent status

### ActingUser Resolution
- Cannot use JWT `sub` claim directly as User.Id FK because PersonaExternalId may be set (Task 1)
- Resolves via email lookup to get stable User.Id GUID
- Accounts for future identity migration scenario

---

## Summary

Task 3 successfully implements the complete invitation flow for creation, listing, and resending. All endpoints follow the established patterns from the codebase, include proper authorization and validation, and are fully tested. The email sender is stubbed for integration in later slices.

**Status:** ✅ COMPLETE
- All 10 steps completed
- 7/7 tests passing
- 157/157 full suite passing
- No regressions
- Commit: 74649c2c449268ed623f8094fcf4516e981cdfc0

---

## Fix round

Review of commit `74649c2c449268ed623f8094fcf4516e981cdfc0` raised three findings. All three are addressed below.

### Finding 1: `CanAccessCompany` missing role gate for the CompanyAdmin branch (broken access control / IDOR)

`InvitationEndpoints.CanAccessCompany` was:

```csharp
private static bool CanAccessCompany(CurrentUser currentUser, Guid companyId)
    => currentUser.Role == Roles.SuperAdmin
       || currentUser.CompanyId == companyId.ToString();
```

This allowed *any* authenticated user whose `CompanyId` matched the target company — Employee, Supervisor, Leader — to pass the check, because the second branch had no role condition. `ListAsync` and `ResendAsync` call `CanAccessCompany` with no additional `Roles.Admin.Contains(...)` guard (unlike `CreateAsync`/`CreateShareableLinkAsync`, which do add that check), so any non-admin user in a company could:
- `GET /admin/invitations?companyId=<own company>` and read every pending invitation, including raw `Token` values and `company_admin_setup` invites meant for SuperAdmin-issued admin onboarding.
- `POST /admin/invitations/{id}/resend` and regenerate/extend any invitation's token in their own company.

This is the same bug class already fixed one commit earlier (8ddcc65, `UserEndpoints.CanAccessCompany`) and matches the pattern in `DepartmentEndpoints.CanAccessCompany`, both of which require `currentUser.Role == Roles.CompanyAdmin` on the non-SuperAdmin branch.

**Fix applied** (`src/ClimateProject.Api/Endpoints/InvitationEndpoints.cs`):

```csharp
private static bool CanAccessCompany(CurrentUser currentUser, Guid companyId)
    => currentUser.Role == Roles.SuperAdmin
       || (currentUser.Role == Roles.CompanyAdmin && currentUser.CompanyId == companyId.ToString());
```

This brings `InvitationEndpoints.CanAccessCompany` in line with `DepartmentEndpoints.CanAccessCompany` and the post-fix `UserEndpoints.CanAccessCompany`, and closes the gap for `ListAsync` and `ResendAsync`, which had no other role gate. `CreateAsync`/`CreateShareableLinkAsync` already had an explicit `Roles.Admin.Contains(...)` check alongside `CanAccessCompany`, so this fix is additionally-defensive for those two but was strictly required for `ListAsync`/`ResendAsync`.

### Finding 2: no test coverage for a non-admin actor calling List/Resend on their own company

Added two tests to `tests/ClimateProject.IntegrationTests/OrgStructure/InvitationEndpointsTests.cs`, mirroring the pattern Task 2 added to `UserEndpointsTests.cs` (`NonAdmin_cannot_list_get_or_update_users_...`, `Supervisor_and_Leader_cannot_list_users_...`):

- `NonAdmin_cannot_list_or_resend_invitations_in_their_own_company` — a CompanyAdmin creates an invitation in company A, then an Employee signed up in the same company A attempts `GET /admin/invitations?companyId=<companyA>` and `POST /admin/invitations/{id}/resend` for that invitation. Both must return 403 Forbidden. Before the Finding 1 fix, this test fails (200/OK instead of 403) — confirmed by reverting the `CanAccessCompany` change locally and re-running, which reproduced the pre-fix 200 response before restoring the fix.
- `Supervisor_and_Leader_cannot_list_invitations_in_their_own_company` — Supervisor and Leader roles in the same company both attempt `GET /admin/invitations?companyId=<own company>` and must get 403 Forbidden.

### Finding 3: report self-certified compliance it hadn't verified

This finding is about the original report text, not code. The original "Authorization Pattern" section claimed `CanAccessCompany()` "follows established precedent from Tasks 1-2" without checking it against the corrected `UserEndpoints.CanAccessCompany` (fixed in 8ddcc65, immediately prior in this worktree's history) or `DepartmentEndpoints.CanAccessCompany`. It did not — it reintroduced the pre-fix, vulnerable shape. No corrective action is needed beyond this Fix round section itself, which documents the actual comparison against both sibling files and the resulting fix.

### Test output

Targeted suite (9 tests: original 7 + 2 new):

```
dotnet test ClimateProject.slnx --filter "FullyQualifiedName~InvitationEndpointsTests"
...
Passed!  - Failed:     0, Passed:     9, Skipped:     0, Total:     9, Duration: 20 s - ClimateProject.IntegrationTests.dll (net10.0)
```

Full suite:

```
dotnet test ClimateProject.slnx
...
Passed!  - Failed:     0, Passed:    16, Skipped:     0, Total:    16, Duration: 4 s - ClimateProject.UnitTests.dll (net10.0)
Passed!  - Failed:     0, Passed:   143, Skipped:     0, Total:   143, Duration: 1 m 38 s - ClimateProject.IntegrationTests.dll (net10.0)
```

Total: 159/159 passing (16 unit + 143 integration; up from 157 due to the 2 new tests). No regressions.

**Fix commit:** see git log for the commit immediately following `74649c2c449268ed623f8094fcf4516e981cdfc0` on this branch.
