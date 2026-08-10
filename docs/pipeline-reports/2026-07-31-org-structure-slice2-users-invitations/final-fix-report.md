# Final whole-branch review fixes — org-structure-slice2-users-invitations

Base commit reviewed: `426e0e6da0a24acf98cc5b9fda17c953db564231`

All five findings from the final review are addressed below, in one coherent pass.

---

## Finding 1 — PRIVILEGE ESCALATION: CompanyAdmin could mint peer company_admin accounts

**Files:** `src/ClimateProject.Api/Endpoints/InvitationEndpoints.cs`

Both `CreateAsync`'s `employee_direct` branch and `CreateShareableLinkAsync` validated only
`request.Role == Roles.SuperAdmin || !Roles.All.Contains(request.Role) → 400`, which let
`role: "company_admin"` through from any CompanyAdmin — bypassing the "role changes are
SuperAdmin-only" Global Constraint via a side door, since `company_admin_setup` invitations
are the intended (and correctly SuperAdmin-gated) path to create a company_admin.

**Fix:** both validations now also reject `request.Role == Roles.CompanyAdmin`, so
`employee_direct` and shareable-link invitations can only mint `employee` / `supervisor` /
`leader` accounts. `company_admin_setup` remains the sole path to a company_admin account,
and it stays SuperAdmin-only (unchanged).

**Tests added** (`tests/.../OrgStructure/InvitationEndpointsTests.cs`):
- `Employee_direct_invitation_rejects_company_admin_role`
- `Shareable_link_rejects_company_admin_role`

---

## Finding 2 — AUTHZ: CompanyAdmin could deactivate a super_admin (or themselves)

**File:** `src/ClimateProject.Api/Endpoints/UserEndpoints.cs`

`UpdateAsync` gated only on `CanAccessCompany(currentUser, user.CompanyId)` before applying
`request.IsActive`, with no check on the *target's* role. Because signup assigns `CompanyId`
from the email domain, a super_admin can end up sharing a CompanyId with a CompanyAdmin who
has no authority over them — that CompanyAdmin could flip the super_admin's `IsActive` to
`false` and lock them out (or lock out a peer company_admin, or themselves).

**Fix:** added a guard immediately after the `CanAccessCompany` check:

```csharp
if (request.IsActive.HasValue && currentUser.Role != Roles.SuperAdmin && Roles.Admin.Contains(user.Role))
{
    return Results.Forbid();
}
```

Only a SuperAdmin may flip `IsActive` for a target whose role is `company_admin` or
`super_admin`. This also covers self-deactivation and peer-company_admin deactivation as a
side effect of the same rule (the acting CompanyAdmin's own record has `Role ==
company_admin`, which is in `Roles.Admin`). General field edits (name, department, manager)
for admin-role users are unaffected — only the `IsActive` toggle is restricted.

**Tests added** (`tests/.../OrgStructure/UserEndpointsTests.cs`):
- `CompanyAdmin_cannot_deactivate_a_super_admin_sharing_their_company_id`
- `CompanyAdmin_cannot_deactivate_themselves_or_a_peer_company_admin`
- `CompanyAdmin_can_still_deactivate_a_regular_employee` (regression guard — the fix must not
  over-restrict)
- `SuperAdmin_can_deactivate_a_company_admin` (regression guard — SuperAdmin authority is
  unchanged)

---

## Finding 3 — SCHEMA: `persona_external_id` had no unique index despite being used as an identity key by `/auth/refresh`

**Files:**
- `src/ClimateProject.Infrastructure/Persistence/Configurations/UserConfiguration.cs`
- `src/ClimateProject.Infrastructure/Migrations/20260801012028_AddPersonaExternalIdUniqueIndex.cs` (new)

`AuthEndpoints.RefreshAsync` resolves the acting user via
`u.Id == userId || u.PersonaExternalId == sub` (or `PersonaExternalId == sub` alone when
`sub` isn't a parseable Guid), trusting `PersonaExternalId` as a unique key — but nothing in
the schema enforced that. If the future `#56` legacy backfill ever wrote a duplicate
`PersonaExternalId`, refresh would silently issue a token for whichever row Postgres
returned first.

**Fix:** added a filtered unique index (nulls allowed, matching the `Company.EmailDomain`
precedent already in this codebase):

```csharp
builder.HasIndex(u => u.PersonaExternalId).IsUnique().HasFilter("persona_external_id IS NOT NULL");
```

Generated via `dotnet ef migrations add AddPersonaExternalIdUniqueIndex` — the migration
contains exactly one change (`CreateIndex ... unique: true, filter: "persona_external_id IS
NOT NULL"`), nothing else.

**Side effect caught by this fix:** two pre-existing tests in `IdentityMappingClaimsTests.cs`
(`Login_uses_PersonaExternalId_as_sub_when_it_is_set` and
`Refresh_succeeds_when_PersonaExternalId_is_a_non_guid_string`) both hardcoded the literal
`"legacy-mongo-id-abc123"` as the `PersonaExternalId`. Since the whole integration suite runs
against a single shared Postgres testcontainer, the new unique constraint caused a real
collision between these two tests (`23505: duplicate key value violates unique constraint`).
Fixed by generating a unique value per test run (`$"legacy-mongo-id-{Guid.NewGuid():N}"`) and
asserting against that captured value instead of the shared literal.

**Tests added** (`tests/.../Auth/IdentityMappingClaimsTests.cs`):
- `PersonaExternalId_must_be_unique_at_the_database_level` — proves a duplicate value throws
  `DbUpdateException` on save.
- `Multiple_users_may_share_a_null_PersonaExternalId` — proves the filter clause keeps
  ordinary signups (which leave the column null) unaffected.

---

## Finding 4 — ACCEPT-ENDPOINT ABUSE: shareable-link email validation skippable / no format check

**File:** `src/ClimateProject.Api/Endpoints/InvitationAcceptEndpoints.cs`

The domain check was `if (company?.EmailDomain is not null && domain != company.EmailDomain)`
— for any company row with a `NULL EmailDomain`, the check was skipped entirely, and `domain`
itself was computed with no format validation
(`candidateEmail.Contains('@') ? Split('@')[1] : string.Empty`), unlike `/auth/signup`, which
regex-validates. Both gaps matter for a future null-domain company created by the `#56`
legacy import (same epic).

**Fix:**
1. Added the same email-format regex `/auth/signup` uses (`^[^\s@]+@[^\s@]+\.[^\s@]+$`,
   duplicated per-file per this codebase's established `CanAccessCompany`-style precedent —
   no shared abstraction), rejecting malformed emails with 400 before the domain is even
   extracted.
2. Changed the domain check from "skip if company has no EmailDomain" to "reject if company
   has no EmailDomain, or the domain doesn't match":
   ```csharp
   if (company?.EmailDomain is null || domain != company.EmailDomain)
   {
       return Results.Json(new { message = "Email domain does not match this company" }, statusCode: 400);
   }
   ```
   A null-domain company can no longer be used to bypass the check — every candidate email
   must now match an actual configured domain.

**Tests added** (`tests/.../OrgStructure/InvitationAcceptEndpointTests.cs`):
- `Accepting_a_shareable_link_rejects_a_malformed_email`
- `Accepting_a_shareable_link_rejects_any_email_when_the_company_has_no_email_domain_configured`

---

## Finding 5 — E2E WIRING: accept flow dead-ends for non-admin invitees

**Files:**
- `web/src/features/org-structure/pages/AcceptInvitationPage.tsx`
- `web/src/features/org-structure/pages/postAcceptRoute.ts` (new)
- `web/src/auth/jwt.ts` (new)

The page unconditionally called `navigate('/admin/companies')` on success, but
`CompanyEndpoints.ListAsync` is `Roles.SuperAdmin`-only — every employee / supervisor /
leader / company_admin created by an invitation landed on a page whose first fetch 403s.
(Login page has the same hardcoded redirect, out of scope here — but this is the first
non-admin-facing entry point in the product, so it's the first place this actually bites a
real user.)

There is currently no dashboard page for non-admin roles in this app (`web/src/app/router.tsx`
only has `/admin/companies`, `/admin/companies/:id`, `/admin/companies/:companyId/users`, all
under `RequireAuth`/`AdminLayout`). Building a full non-admin dashboard is out of scope for a
review-fix pass, so the fix is scoped to: **never navigate into a route that will 403 for the
role that was just created.**

**Fix:**
1. Added `decodeJwtPayload` (`web/src/auth/jwt.ts`) — a small, dependency-free JWT payload
   decoder (no signature verification; the token was just issued by our own API, this is only
   for reading `role`/`companyId` claims to route locally).
2. Added `resolvePostAcceptRoute(role, companyId)` (`web/src/features/org-structure/pages/postAcceptRoute.ts`),
   a pure function:
   - `super_admin` → `/admin/companies` (SuperAdmin-only, matches `CompanyEndpoints.ListAsync`)
   - `company_admin` → `/admin/companies/{companyId}/users` (matches `UserEndpoints.CanAccessCompany`,
     which does allow a company_admin to read their own company's user list)
   - anything else (`employee` / `supervisor` / `leader`) or missing `companyId` → `null`
3. `AcceptInvitationPage` now decodes the issued JWT, calls `resolvePostAcceptRoute`, and:
   - navigates if a destination exists, or
   - shows an inline "Account created" success message and does **not** navigate, if no
     destination exists for that role yet.

This directly fixes the dead-end for `employee`/`supervisor`/`leader` invitees, and also fixes
a related bug the finding didn't explicitly name: a `company_admin`-role invitee would have
hit the same 403 under the old code (`CompanyEndpoints.ListAsync` is stricter than
`UserEndpoints.CanAccessCompany` — SuperAdmin-only vs. SuperAdmin-or-own-company), so they now
correctly land on their own company's users page instead.

**Tests added:**
- `web/src/features/org-structure/pages/postAcceptRoute.test.ts` — covers all role branches,
  missing role, missing companyId.
- `web/src/auth/jwt.test.ts` — covers well-formed payload decode, base64url `-`/`_` handling,
  and malformed-token/malformed-payload → `null`.

(No React Testing Library / DOM-rendering tests exist anywhere in this codebase yet — all
existing "page" coverage is at the API-client/pure-logic layer, which is what these two new
test files follow.)

---

## Verification

### Backend — `dotnet test ClimateProject.slnx`

```
Passed!  - Failed:     0, Passed:    16, Skipped:     0, Total:    16, Duration: 3 s - ClimateProject.UnitTests.dll (net10.0)
Passed!  - Failed:     0, Passed:   158, Skipped:     0, Total:   158, Duration: 1 m 55 s - ClimateProject.IntegrationTests.dll (net10.0)
```

All 174 backend tests pass (build: 0 warnings, 0 errors).

Note: an initial full-suite run surfaced two failures — `StartupValidationTests
.Missing_TrackingJwtSecret_fails_startup_instead_of_accepting_traffic` (an `ObjectDisposedException`
from `WebApplicationFactory`'s `DeferredHostBuilder`, unrelated to any of these findings; a
`git stash` + isolated re-run against unmodified `HEAD` confirmed this test passes fine on its
own — pre-existing flake under full-suite resource contention, not caused by this fix pass)
and the `IdentityMappingClaimsTests` literal-collision described under Finding 3 (caused by
this fix pass, and fixed as described there). The re-run above is clean on both.

### Frontend — `npm test && npm run build` (from `web/`)

```
 Test Files  8 passed (8)
      Tests  32 passed (32)
```

```
✓ 1824 modules transformed.
dist/index.html                   0.45 kB │ gzip:  0.29 kB
dist/assets/index-DGNrK5qb.css    1.78 kB │ gzip:  0.81 kB
dist/assets/index-BoRXwDnR.js   306.28 kB │ gzip: 95.72 kB
✓ built in ~0.3-0.8s
```

Both green.
