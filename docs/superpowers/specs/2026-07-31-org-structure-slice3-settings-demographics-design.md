# Org structure migration — Slice 3: System Settings + Demographics + Bulk Import

## Context

Follows Slice 2 (Users + invitations). Third and final `#50` slice: 1. Companies+Departments+shell (done), 2. Users+invitations (done), **3. System settings + demographics + bulk import (this spec)**.

Legacy inventory (`climate-project` repo):
- `src/app/api/admin/company-settings/route.ts` (248) — Settings+Branding for one company
- `src/app/api/admin/system-settings/route.ts` (108) — platform-wide singleton
- `src/app/api/admin/demographics/route.ts` (272), `.../bulk-upload/route.ts` (191)
- `src/app/api/admin/bulk-import/route.ts` (210) — CSV user import
- `src/app/admin/system-settings/page.tsx`, `src/app/admin/demographics/page.tsx`
- `src/models/SystemSettings.ts`, `DemographicField.ts`

## Real gaps found (grounded, not carried forward blindly)

- **`Company.Settings`/`Company.Branding` exist in the schema (`#49`) but Slice 1 never exposed them** — its `UpdateCompanyRequest` only covers profile fields. Flagged in Slice 1's final review as a plan-vs-design deviation, picked up here.
- **`SystemSettings` entity does not exist at all** — spec'd in `#49`'s design comment but never actually created. This slice adds it.
- **Company settings/branding permission differs from Slice 1's company-profile permission.** Legacy's `company-settings` route checks `hasPermission(role, 'company_admin')` (i.e. `Roles.Admin.Contains`), not super-admin-only — verified directly against `src/app/api/admin/company-settings/route.ts:64`. Company *profile* (name, industry, etc.) stays `Roles.SuperAdmin`-only per Slice 1's Global Constraints, unchanged; company *settings/branding* is broader.

## Backend

### Endpoints

| Method | Route | Authorization | Notes |
|---|---|---|---|
| PUT | `/admin/companies/{id}/settings` | `Roles.Admin.Contains` + own-company for CompanyAdmin, any for SuperAdmin | Updates `CompanySettings` + `CompanyBranding` fields together |
| GET | `/admin/system-settings` | `Roles.SuperAdmin` | Singleton read (creates default row on first read if none exists) |
| PUT | `/admin/system-settings` | `Roles.SuperAdmin` | Singleton update |
| GET | `/admin/demographic-fields?companyId=` | Same scoping as Department | List |
| POST | `/admin/demographic-fields` | Same scoping | Create |
| PUT | `/admin/demographic-fields/{id}` | Same scoping (load field, check its `CompanyId`) | Update |
| POST | `/admin/users/bulk-import` | `Roles.Admin.Contains` + own-company for CompanyAdmin, any for SuperAdmin | Multipart CSV, `preview=true` query param supported |

`SystemSettings` migration adds one seed row is NOT done via migration data-seeding (avoid environment-specific seed data in a migration); instead `GetAsync` creates-if-missing on first read, matching the legacy Mongoose static's `getSettings()` behavior.

Bulk import reuses the direct-password-creation pattern from Slice 2's invitation-accept endpoint (no invitation/token involved — this is an admin directly creating already-active accounts). CSV columns: `name,email,role,department`. Preview mode validates every row (email format, role in `Roles.All`, department exists in the target company, no existing user with that email) without writing anything; non-preview mode creates all valid rows in one transaction-scoped pass and skips invalid ones, returning a per-row result list.

### Out of scope for this slice

- Any survey/microclimate/report/notification settings (later domains own those).
- CSV export (legacy doesn't have a matching bulk-export for users either — asymmetric by design there, not carried over).

## Frontend

```
web/src/features/org-structure/
├── api/
│   ├── companySettings.ts
│   ├── systemSettings.ts
│   ├── demographicFields.ts
│   └── bulkImport.ts
├── components/
│   ├── CompanySettingsForm.tsx     # rendered inside CompanyDetailPage
│   ├── SystemSettingsForm.tsx
│   ├── DemographicFieldList.tsx
│   ├── DemographicFieldForm.tsx
│   └── BulkImportPanel.tsx         # file upload + preview table + confirm
└── pages/
    ├── SystemSettingsPage.tsx
    └── DemographicFieldsPage.tsx   # scoped to :companyId, same nav pattern as UsersListPage
```

`CompanySettingsForm` and `BulkImportPanel` both live inside `CompanyDetailPage` (settings alongside the existing company-edit form; bulk-import as a new section) rather than separate pages — matches Slice 1's precedent of embedding department management directly in `CompanyDetailPage`.

## Testing

Same xUnit + Testcontainers pattern as every prior slice; one test file per endpoint group. Bulk-import tests cover: preview mode returns validation results without persisting, non-preview mode creates valid rows and reports per-row errors for invalid ones, duplicate-email-within-the-same-CSV is caught.

## Out of scope (whole-slice level)

- i18n, PWA, design tokens beyond `--admin-*` reuse (`#57`)
- Anything for surveys/microclimates/action-plans/reports/notifications (later domains)
