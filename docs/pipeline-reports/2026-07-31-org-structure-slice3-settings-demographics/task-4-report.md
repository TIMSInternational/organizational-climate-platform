# Task 4: Bulk User Import Endpoint - Implementation Report

## Summary
Task 4 (Bulk user import endpoint) completed successfully. All required files created, all tests passing, commit made.

## Files Created
1. `src/ClimateProject.Application/OrgStructure/BulkImportDtos.cs` - DTOs for bulk import request/response
2. `src/ClimateProject.Application/OrgStructure/CsvUserImportParser.cs` - CSV parser for user import
3. `src/ClimateProject.Api/Endpoints/BulkImportEndpoints.cs` - Bulk import endpoint implementation
4. `tests/ClimateProject.UnitTests/OrgStructure/CsvUserImportParserTests.cs` - Unit tests for CSV parser (3 tests)
5. `tests/ClimateProject.IntegrationTests/OrgStructure/BulkImportEndpointsTests.cs` - Integration tests (4 tests)

## Files Modified
1. `src/ClimateProject.Api/Program.cs` - Added endpoint registration

## Step-by-Step Execution

### Step 1-2: DTOs and Unit Tests
- Created BulkImportDtos.cs with BulkImportRowResult, BulkImportResponse, and ParsedImportRow records
- Created CsvUserImportParserTests.cs with 3 test cases:
  - `Parses_valid_rows_with_header()` - Tests basic CSV parsing with header and data rows
  - `Skips_blank_lines()` - Tests blank line handling
  - `Trims_whitespace_around_each_field()` - Tests whitespace trimming

### Step 3: Unit Tests - Initial Run (Failed)
```
Expected: FAIL with compile error (CsvUserImportParser doesn't exist)
```

### Step 4: CSV Parser Implementation
Implemented CsvUserImportParser.cs with Parse() method that:
- Splits CSV by newlines, skips header row
- Handles empty/blank lines
- Trims whitespace from each field
- Returns ParsedImportRow list with 1-based row numbers
- Does NOT support embedded commas in quoted fields (as specified in constraints)

### Step 5: Unit Tests - Rerun
```
Result: PASS - 3/3 unit tests
- Parses_valid_rows_with_header ✓
- Skips_blank_lines ✓  
- Trims_whitespace_around_each_field ✓
Duration: 29 ms
```

### Step 6-7: Integration Tests - Initial Run (Failed)
Created BulkImportEndpointsTests.cs with 4 test cases:
- `Preview_mode_validates_without_creating_users()` - Preview validates rows but doesn't create
- `Non_preview_mode_creates_valid_rows_and_reports_errors_for_invalid_ones()` - Creates valid users, reports errors
- `Duplicate_email_within_the_same_csv_is_reported_as_an_error_on_the_second_occurrence()` - Handles duplicates
- `Employee_cannot_bulk_import_users()` - Authorization check

Expected: FAIL with MethodNotAllowed (endpoint doesn't exist)

### Step 8: Endpoint Implementation
Implemented BulkImportEndpoints.cs with:
- POST /admin/users/bulk-import endpoint
- Form data parsing (file, companyId, preview)
- Authorization check (SuperAdmin or CompanyAdmin only)
- Email validation (contains @ and domain separator)
- Role validation (must be valid role from Roles.All)
- Department lookup by name
- Duplicate detection (within file and existing users)
- Batch user creation in non-preview mode
- Row-by-row error reporting with status (valid/error/duplicate/created)

Authorization logic: `!Roles.Admin.Contains(currentUser.Role) || (currentUser.Role != Roles.SuperAdmin && currentUser.CompanyId != companyId.ToString())`

### Step 9: Endpoint Registration
Added `app.MapBulkImportEndpoints();` to src/ClimateProject.Api/Program.cs after MapDemographicFieldEndpoints()

### Step 10: Integration Tests - Rerun
```
Result: PASS - 4/4 integration tests
- Preview_mode_validates_without_creating_users ✓
- Non_preview_mode_creates_valid_rows_and_reports_errors_for_invalid_ones ✓
- Duplicate_email_within_the_same_csv_is_reported_as_an_error_on_the_second_occurrence ✓
- Employee_cannot_bulk_import_users ✓
Duration: 28 s

Full test suite:
- Unit tests: 19 passed (16 baseline + 3 new)
- Integration tests: 174 passed (170 baseline + 4 new)
- Total: 193 passed, 0 failed
```

Note: Initial attempt had authorization issue - employee test was returning OK instead of Forbidden. Fixed by adding role check to ensure only Admin roles (SuperAdmin or CompanyAdmin) can perform bulk import.

### Step 11: Commit
```
Commit SHA: ea76c03323a79a7a5eea0f3443dfb5daa06ff033
Message: feat: add CSV bulk user import endpoint (preview + create modes)

Files committed:
- src/ClimateProject.Application/OrgStructure/BulkImportDtos.cs
- src/ClimateProject.Application/OrgStructure/CsvUserImportParser.cs
- src/ClimateProject.Api/Endpoints/BulkImportEndpoints.cs
- src/ClimateProject.Api/Program.cs
- tests/ClimateProject.UnitTests/OrgStructure/CsvUserImportParserTests.cs
- tests/ClimateProject.IntegrationTests/OrgStructure/BulkImportEndpointsTests.cs
```

## Test Results Summary
- All 7 Task 4 tests pass (3 unit + 4 integration)
- Full test suite: 193 tests pass, 0 failed
- Duration: 3m 36s total

## Deviations from Plan
None. Implementation follows the plan exactly.

## Status
✅ COMPLETE - Task 4 fully implemented, all tests passing, committed successfully.

## Fix round

### Finding addressed
`src/ClimateProject.Api/Endpoints/BulkImportEndpoints.cs:83` — the role-validation check
only verified `Roles.All.Contains(row.Role)`, which includes `super_admin` and
`company_admin`. Because `CanAccessCompany` treats `Role == SuperAdmin` as unconditionally
authorized for any company, a non-SuperAdmin CompanyAdmin bulk-importing users into their
own company could put `company_admin` (or `super_admin`) in the CSV's `role` column and mint
a peer company_admin, or even a platform-wide super_admin, account. This is the exact
privilege-escalation surface that `InvitationEndpoints.cs` (lines 69-77, and mirrored again
at 142) explicitly guards against for the sibling `employee_direct` invitation and
shareable-link flows.

### Fix
Excluded `Roles.SuperAdmin` and `Roles.CompanyAdmin` from the set of roles a bulk-import CSV
row may assign, regardless of who is performing the import (mirroring
`InvitationEndpoints.CreateAsync`'s `employee_direct` branch and
`CreateShareableLinkAsync`, which apply the same exclusion unconditionally — company-scoped
role assignment must never be able to create admin accounts, even when the actor is a
SuperAdmin). Added an inline comment referencing the underlying risk and the precedent in
`InvitationEndpoints.cs`, matching that file's existing pattern:

```csharp
// super_admin/company_admin are excluded from bulk-importable roles, not just
// invalid ones. CanAccessCompany treats Role == SuperAdmin as unconditionally
// authorized for any company, so without this exclusion a CompanyAdmin bulk-
// importing into their own company could mint a peer company_admin (or, if the
// row role were ever trusted further, a platform-wide super_admin). This mirrors
// the same exclusion in InvitationEndpoints.CreateAsync's employee_direct branch
// and CreateShareableLinkAsync -- company-scoped bulk role assignment must never
// be able to create admin accounts.
if (!Roles.All.Contains(row.Role) || row.Role == Roles.SuperAdmin || row.Role == Roles.CompanyAdmin)
{
    errors.Add($"Invalid role: {row.Role}");
}
```

### Test added
Added a regression test to
`tests/ClimateProject.IntegrationTests/OrgStructure/BulkImportEndpointsTests.cs`:
- `CompanyAdmin_cannot_bulk_import_a_row_with_company_admin_or_super_admin_role()` — a
  CompanyAdmin submits a non-preview CSV with one `company_admin` row and one `super_admin`
  row for their own company; asserts the response reports both rows as `"error"` with
  `SuccessCount == 0`, `ErrorCount == 2`, and that neither user was persisted to the
  database.

### Test output

`dotnet test ClimateProject.slnx --filter "FullyQualifiedName~BulkImportEndpointsTests"`:
```
Passed!  - Failed:     0, Passed:     5, Skipped:     0, Total:     5, Duration: 16 s - ClimateProject.IntegrationTests.dll (net10.0)
```
(4 pre-existing tests + 1 new regression test, all passing.)

Full suite — `dotnet test ClimateProject.slnx`:
```
Passed!  - Failed:     0, Passed:    19, Skipped:     0, Total:    19, Duration: 3 s - ClimateProject.UnitTests.dll (net10.0)
Passed!  - Failed:     0, Passed:   175, Skipped:     0, Total:   175, Duration: 2 m 20 s - ClimateProject.IntegrationTests.dll (net10.0)
```
(175 integration tests = 174 baseline + 1 new; no regressions.)

### Commit
```
fix: block super_admin/company_admin roles in bulk user import CSV rows
```
