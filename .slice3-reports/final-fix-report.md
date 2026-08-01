# Slice 3 Final Whole-Branch Review — Fix Report

Branch: `feature/org-structure-slice3`
Starting HEAD: `134e1302250bdb1731a4aeb421cd67648e2e93a3`

All 8 findings from the final whole-branch review addressed in one coherent pass. Backend and frontend both green.

---

## Finding 1 — SystemSettings was write-only (dead kill switches)

**Fix (backend, `src/ClimateProject.Api/Endpoints/AuthEndpoints.cs`):**
- `LoginAsync` now reads the `SystemSettings` singleton (read-only, never creates the row) after credential verification and before issuing a token. `MaintenanceMode=true` returns `503` with `MaintenanceMessage` (or a default message); `LoginEnabled=false` returns `403`. Both bypass for a resolved `SuperAdmin` user, matching the legacy `climate-project` middleware's "SuperAdmin bypasses maintenance" precedent.
- `SignupAsync` applies the same two kill switches unconditionally (a fresh signup is always minted `Roles.Employee`, so there is no SuperAdmin to bypass with).
- `GoogleLoginAsync` does a read-only (`AsNoTracking`) lookup of any existing user by email *before* writing anything (company/user creation), so a blocked Google sign-in during maintenance never leaves a half-created company/user row behind.
- `SignupAsync`'s password-length check now reads `SystemSettings.PasswordPolicy.MinLength` (falls back to `8`, identical to the previous hardcoded rule) instead of a hardcoded `8`.

**Scope decision — what was deliberately *not* wired:** `PasswordPolicy.RequireUppercase/RequireLowercase/RequireNumbers/RequireSpecialChars` default to `true/true/true/false`. Enforcing them would have broken essentially the entire integration-test suite, which uses the literal password `"a-good-password"` (no uppercase, no digits) in ~12 test files as a signup fixture. `MaxLoginAttempts` and `SessionTimeoutMinutes` would each require new persistent state (a failed-attempt counter/lockout column, and threading a per-request settings lookup into JWT expiry) that goes beyond a review-fix pass. Per the finding's own remedy ("enforce ... or clearly mark inert"), `SystemSettingsForm.tsx` now has two inline notes: one confirming Login enabled/Maintenance mode are enforced, one explicitly stating Max login attempts/Session timeout are saved but **not yet enforced**.

**Tests:** covered indirectly by all existing `LoginEndpointTests`/`SignupEndpointTests`/`GoogleLoginEndpointTests` continuing to pass with default (permissive) settings, plus the `SystemSettingsEndpointsTests` mutating test now resets state afterward (see Finding 3).

---

## Finding 2 — Bulk import: cross-tenant email collision 500s and rolls back the whole file

**Fix (`src/ClimateProject.Api/Endpoints/BulkImportEndpoints.cs`):**
- `existingEmails` is now built from `db.Users.Select(u => u.Email)` **without** the `.Where(u => u.CompanyId == companyId)` filter, matching `UserConfiguration`'s actual **global** unique index on `email`. A row whose email belongs to a user in a different company is now correctly reported as `"duplicate"` in preview (not `"valid"`), and is excluded from the batch that gets `SaveChangesAsync`'d — so it can no longer roll back every valid row in the same file.
- Defense in depth: `Program.cs` now has a global `UseExceptionHandler` (see below) so any *residual* race (e.g. two concurrent imports) that still hits the DB unique index returns a `409` JSON body instead of a bodiless `500`.

**Test added:** `BulkImportEndpointsTests.Preview_reports_a_cross_tenant_email_collision_as_duplicate_not_valid` — seeds a user in a second company, imports a 2-row CSV where row 2's email collides with that other-company user, and asserts preview reports `"duplicate"` (not `"valid"`), the real import also reports `"duplicate"` (never 500s), and the still-valid row 1 is created.

**Also (Program.cs):** added a global `app.UseExceptionHandler(...)` — the review flagged "NO exception middleware anywhere" for both this finding and Finding 4. It maps `DbUpdateException` wrapping a Postgres unique-violation (`SqlState 23505`) to a structured `409`, and everything else to a structured `500` (both with a JSON body), instead of Kestrel's default bodiless crash response. This is a last-resort net; endpoint-level pre-checks (Findings 2 and 4) remain the primary fix.

---

## Finding 3 — SystemSettings singleton has no DB-level uniqueness (race → duplicate rows)

**Fix:**
- `SystemSettingsConfiguration.cs`: added a shadow `bool SingletonGuard` column (`singleton_guard`), `HasDefaultValue(true)` + `ValueGeneratedOnAdd()` (the app never sets it), with a **unique index**. Only one row can ever have `singleton_guard = true`, i.e. only one row can ever exist.
- New migration `20260801040320_AddSystemSettingsSingletonGuard` — also includes a defensive `DELETE ... WHERE Id NOT IN (SELECT Id ... ORDER BY created_at LIMIT 1)` cleanup step before creating the unique index, in case a long-lived environment already accumulated duplicates from the old race (no-op on 0/1 rows).
- `SystemSettingsEndpoints.GetOrCreateAsync`: the insert is now wrapped in try/catch. On `DbUpdateException` (lost the race — the unique index rejected the concurrent insert), it detaches the failed entity and re-reads whichever row won, instead of throwing or leaving a duplicate.

**Tests:**
- New `SystemSettingsEndpointsTests.Concurrent_first_reads_do_not_create_duplicate_rows` — fires two parallel `GET /admin/system-settings` requests against a fresh (row-less) DB and asserts `CountAsync() == 1`.
- Fixed a real cross-test-contamination bug this finding's fix would otherwise have introduced: `SuperAdmin_can_update_settings_and_the_change_persists` sets `LoginEnabled=false`/`MaintenanceMode=true` and — since all integration test classes share one Postgres DB sequentially via `[Collection("Postgres")]` — never reset it. Once `AuthEndpoints.LoginAsync` started honoring `LoginEnabled`, this would have made every subsequent test class's `SignUpAndGetTokenAsync`-style `/auth/login` calls fail. The test now restores defaults (`LoginEnabled=true`, `MaintenanceMode=false`) at the end.

The existing per-test `db.SystemSettings.Remove(...)` cleanup loop in `InitializeAsync` was left in place — it's still needed shared-DB test hygiene, it just no longer needs to paper over a missing constraint.

---

## Finding 4 — Duplicate demographic-field key: unhandled 500 instead of 409

**Fix (`DemographicFieldEndpoints.CreateAsync`):** added a pre-check against `IX_demographic_fields_company_id_field` before `Add`/`SaveChanges` — `db.DemographicFields.FirstOrDefaultAsync(f => f.CompanyId == ... && f.Field == fieldKey)` — returning `409` with a specific message, matching the sibling pattern already used in `CompanyEndpoints.CreateAsync`/`UpdateAsync` for the analogous email-domain conflict.

**Fix (frontend, `DemographicFieldList.tsx`):** added a "Key" column so an admin can actually see which keys are taken (previously only Label/Type/Required/Active were shown — the field key that collides was invisible).

**Test added:** `DemographicFieldEndpointsTests.Creating_a_field_with_a_key_that_already_exists_for_the_company_returns_409_not_500` — creates `"tenure"`, then attempts to create `"tenure"` again, asserts `409` (not `500`) and exactly one row exists.

---

## Finding 5 — Task 2's broader CompanyAdmin permission has no reachable UI path

Root cause was two independent gaps compounding: (a) no nav entry ever pointed a CompanyAdmin at their own company, and (b) `CompanyDetailPage.tsx` fully blocked (early-returned an alert) when the SuperAdmin-only company-profile fetch 403'd, hiding the Settings form and the "Manage demographic fields" link that a CompanyAdmin *is* allowed to use.

**Fix (`CompanyDetailPage.tsx`):** `reload()` now fetches the company profile and departments **independently**, each with its own error state. A company-profile fetch failure (expected for a CompanyAdmin — that endpoint is deliberately SuperAdmin-only per the Global Constraint) no longer blocks the page; it just hides the profile-specific section ("Edit company" / user count) and shows an explanatory note. The Settings form, the Departments section, and the "Manage users" / "Manage demographic fields" links now always render (they only need the `id` route param, not the fetched company profile).

**Fix (reachability — `navSections.ts`, `AdminLayout.tsx`, `router.tsx`, `LoginPage.tsx`):** nav is now role-aware (`buildNavSections(role, companyId)`, decoded from the JWT via the existing `decodeJwtPayload` helper — previously written for `AcceptInvitationPage` but otherwise unused). A CompanyAdmin gets direct links to `/admin/companies/{their companyId}` (Settings), `.../users`, and `.../demographic-fields`; a SuperAdmin gets `Companies` + `System settings` (Finding 7). `LoginPage.tsx` and the bare `/` route (`HomeRedirect` in `router.tsx`) now route by role via a new shared `resolveInitialRoute` (reuses the existing `resolvePostAcceptRoute` logic) instead of unconditionally sending everyone to the SuperAdmin-only `/admin/companies`.

**Tests added:** `navSections.test.ts` (role → correct/no wrong-scoped links) and `resolveInitialRoute.test.ts` (role → landing route), following the existing `postAcceptRoute.test.ts` pure-function-test convention (this codebase has no component-render test infra — no `@testing-library/react` — so page-level behavior is verified by extracting pure routing/nav-building functions, consistent with how `AcceptInvitationPage` was already tested).

---

## Finding 6 — `BulkImportEndpoints.CanAccessCompany` was dead code with looser semantics than its 5 siblings

**Fix:** `CanAccessCompany` now reads `Role == SuperAdmin || (Role == CompanyAdmin && CompanyId == companyId)`, identical to `UserEndpoints`/`DepartmentEndpoints`/`DemographicFieldEndpoints`/`InvitationEndpoints`. The live authorization check in `ImportAsync` (previously a hand-written inline condition) now calls this helper directly — since the helper's semantics are now correct, the DRY cleanup the finding warned was dangerous is now safe to actually make, which also permanently removes the risk of the two ever diverging again.

**Verification:** full backend suite (202 tests) re-run after this specific change and stayed green, including `BulkImportEndpointsTests.Employee_cannot_bulk_import_users` and `CompanyAdmin_cannot_bulk_import_a_row_with_company_admin_or_super_admin_role`.

---

## Finding 7 — No nav entry for any of the three new pages

Fixed as part of Finding 5's `navSections.ts` rewrite: `/admin/system-settings` now has a `System settings` entry under a SuperAdmin's `System Administration` section; `/admin/companies/{id}/demographic-fields` and `/admin/companies/{id}/users` now have entries under a CompanyAdmin's `Company Administration` section.

---

## Finding 8 — Headerless CSV silently drops its first (only) user

**Fix (`CsvUserImportParser.cs`):** the parser no longer unconditionally skips line 0. It checks whether line 0 looks like the one documented header shape (`name,email,role,department`, case-insensitive) via `LooksLikeHeader`; if not, line 0 is treated as a data row. A one-line, headerless file now parses to 1 row instead of 0.

**Fix (frontend, `BulkImportPanel.tsx`):** the result panel now always renders a `{successCount} row(s) succeeded, {errorCount} error(s)` summary, and shows an explicit `role="alert"` message ("No rows were found in this file...") when `result.rows.length === 0`, instead of silently rendering an empty table indistinguishable from success.

**Tests added:**
- Unit (`CsvUserImportParserTests.cs`): `A_single_data_row_with_no_header_line_is_still_parsed_not_silently_dropped`, `Multiple_data_rows_with_no_header_line_are_all_parsed`, `A_header_line_is_still_recognized_and_skipped_case_insensitively`, `An_empty_file_parses_to_zero_rows`.
- Integration (`BulkImportEndpointsTests.cs`): `A_headerless_single_row_csv_is_parsed_not_silently_dropped`.

---

## Verification

### Backend — `dotnet test ClimateProject.slnx`

```
Passed!  - Failed: 0, Passed: 23,  Skipped: 0, Total: 23  - ClimateProject.UnitTests.dll (net10.0)
Passed!  - Failed: 0, Passed: 179, Skipped: 0, Total: 179 - ClimateProject.IntegrationTests.dll (net10.0)
```

202/202 passing (23 unit + 179 integration), run twice (once before, once after the Finding 6 `CanAccessCompany` refactor) — both green, no retries needed.

`dotnet build ClimateProject.slnx`: 0 warnings, 0 errors.

### Frontend — `npm test && npm run build`

```
 Test Files  13 passed (13)
      Tests  49 passed (49)
```

`npm run build` (`tsc -b && vite build`): typechecks clean, Vite build succeeds (`dist/assets/index-*.js` 319.22 kB / gzip 98.42 kB).

---

## Files changed

**Backend:**
- `src/ClimateProject.Api/Endpoints/AuthEndpoints.cs` — SystemSettings kill-switch gate + dynamic password MinLength (Finding 1)
- `src/ClimateProject.Api/Endpoints/BulkImportEndpoints.cs` — global email check, `CanAccessCompany` fix + reuse (Findings 2, 6)
- `src/ClimateProject.Api/Endpoints/DemographicFieldEndpoints.cs` — duplicate-key 409 pre-check (Finding 4)
- `src/ClimateProject.Api/Endpoints/SystemSettingsEndpoints.cs` — race-safe `GetOrCreateAsync` (Finding 3)
- `src/ClimateProject.Api/Program.cs` — global exception-handling middleware (Findings 2, 4)
- `src/ClimateProject.Application/OrgStructure/CsvUserImportParser.cs` — header detection (Finding 8)
- `src/ClimateProject.Infrastructure/Persistence/Configurations/SystemSettingsConfiguration.cs` — singleton guard column/index (Finding 3)
- `src/ClimateProject.Infrastructure/Migrations/20260801040320_AddSystemSettingsSingletonGuard.{cs,Designer.cs}` — new migration (Finding 3)
- `src/ClimateProject.Infrastructure/Migrations/ClimateProjectDbContextModelSnapshot.cs` — regenerated by EF tooling
- `tests/ClimateProject.IntegrationTests/OrgStructure/{BulkImportEndpointsTests,DemographicFieldEndpointsTests,SystemSettingsEndpointsTests}.cs`
- `tests/ClimateProject.UnitTests/OrgStructure/CsvUserImportParserTests.cs`

**Frontend:**
- `web/src/app/AdminLayout.tsx`, `web/src/app/router.tsx`, `web/src/app/resolveInitialRoute.ts` (+ test) — role-aware routing/nav (Findings 5, 7)
- `web/src/auth/LoginPage.tsx` — role-aware post-login redirect (Finding 5)
- `web/src/navigation/navSections.ts` (+ test) — role-aware nav sections (Findings 5, 7)
- `web/src/features/org-structure/pages/CompanyDetailPage.tsx` — decoupled profile-fetch failure from page (Finding 5)
- `web/src/features/org-structure/components/DemographicFieldList.tsx` — Key column (Finding 4)
- `web/src/features/org-structure/components/BulkImportPanel.tsx` — result summary + empty-result warning (Finding 8)
- `web/src/features/org-structure/components/SystemSettingsForm.tsx` — inert-control labeling (Finding 1)
