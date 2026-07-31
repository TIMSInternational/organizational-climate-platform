# Org structure migration — Slice 1: Companies + Departments + Admin Shell

## Context

Epic #17's remaining scope (feature migration from the legacy Next.js/MongoDB app into
this C#/.NET 10 + React monorepo) is too large for one spec. Decomposed by domain, in
the epic's own dependency order: org structure (#50) first, since every other domain
scopes/permissions against companies, users, and departments.

`#50` itself is too large for one spec (companies, users, departments, invitations,
system settings, demographics, admin shell — 25+ legacy API routes). Sliced into three:

1. **Slice 1 (this spec):** Companies + Departments + admin shell/nav
2. Slice 2: Users + roles + invitations
3. Slice 3: System settings + demographics + bulk import

Legacy inventory for this slice (`climate-project` repo):
- `src/app/api/admin/companies/route.ts` (303 lines), `.../[id]/route.ts` (398 lines)
- `src/app/api/admin/departments/route.ts` (269 lines), `.../[id]/route.ts` (301 lines)
- `src/app/admin/companies/page.tsx` (210 lines, list), `.../[id]/page.tsx` (525 lines,
  detail — departments are managed *inside* this page; no standalone departments page
  exists in the legacy app)
- `src/components/admin/ModernCompanyManagement.tsx` (2044 lines)
- `src/components/navigation/RoleBasedNav.tsx` (247 lines) + `useNavSections` hook

The EF Core schema for `Company` and `Department` (+ owned `CompanySettings`/
`DepartmentSettings`) already exists (`#49` org-structure slice, done 2026-07-31).
Auth (JWT bearer, `Roles.SuperAdmin`/`Roles.CompanyAdmin`/etc. constants, `CurrentUser`
claims extension) already exists (`#48`, done). Neither needs to be built — this slice
is endpoints + UI on top of both.

## Backend

### Pattern

Follow `src/ClimateProject.Api/Endpoints/AuthEndpoints.cs`'s established shape exactly:
minimal-API endpoints in `ClimateProject.Api/Endpoints/`, `.RequireAuthorization()` plus
a manual `Roles.Admin.Contains(currentUser.Role)` (or narrower) check in the handler
body — **not** `[Authorize(Roles=)]`, which this codebase does not use (see
`AuthEndpoints.cs:244` for the reference pattern). Business logic lives in a new
`ClimateProject.Application/OrgStructure/` folder (services + DTOs), following the
existing `Application/Auth/` folder's shape. EF Core queries go through
`ClimateProjectDbContext` directly from the Application-layer service, matching how
`AuthEndpoints.cs` does it today (no separate repository abstraction in this codebase).

### Endpoints

All require authentication. Authorization column below is the manual in-handler check.

| Method | Route | Authorization | Notes |
|---|---|---|---|
| GET | `/admin/companies` | `Roles.SuperAdmin` | List, paginated |
| POST | `/admin/companies` | `Roles.SuperAdmin` | Create |
| GET | `/admin/companies/{id}` | `Roles.SuperAdmin` | Detail |
| PUT | `/admin/companies/{id}` | `Roles.SuperAdmin` | Update (profile fields + `CompanySettings`) |
| GET | `/admin/departments?companyId={id}` | `Roles.SuperAdmin` OR (`Roles.CompanyAdmin` AND `currentUser.CompanyId == companyId`) | List, scoped to a company |
| POST | `/admin/departments` | Same scoping rule | Create |
| GET | `/admin/departments/{id}` | Same scoping rule | Detail |
| PUT | `/admin/departments/{id}` | Same scoping rule | Update |

Company deletion is explicitly **not** in scope — the legacy app has no company-delete
route either (only edit); do not add one.

### Out of scope for this slice (do not build)

- `resend-invitation` (`/admin/companies/{id}/resend-invitation`) — belongs to Slice 2
  (invitations), not company management.
- `bulk-import`, `company-settings` as a *separate* route (settings are part of the
  company PUT payload here, matching the EF Core `CompanySettings` owned-type shape
  from `#49`), `demographics` — Slice 3.
- User management, roles — Slice 2.

## Frontend

### New dependency

`react-router-dom` — not yet installed. `web/` currently has one static page (the
health-check placeholder from Task 3 of the monorepo-consolidation plan).

### Structure

```
web/src/
├── app/
│   ├── router.tsx              # react-router route table
│   └── AdminLayout.tsx         # sidebar + top bar shell, wraps all /admin/* routes
├── features/
│   └── org-structure/
│       ├── api/                # typed fetch clients (mirrors web/src/api/health.ts pattern)
│       │   ├── companies.ts
│       │   └── departments.ts
│       ├── components/
│       │   ├── CompanyList.tsx
│       │   ├── CompanyForm.tsx        # shared by create + edit
│       │   ├── CompanyFilters.tsx
│       │   └── DepartmentList.tsx     # rendered inside CompanyDetailPage
│       └── pages/
│           ├── CompaniesListPage.tsx
│           └── CompanyDetailPage.tsx  # includes department management
├── navigation/
│   └── RoleBasedNav.tsx         # port of the legacy component + useNavSections hook
```

### Deliberate deviation from legacy: `ModernCompanyManagement.tsx` is not ported as one file

That file is 2044 lines doing list rendering, filtering, create/edit forms, and modal
state all together. Since this is a full rewrite (Next.js App Router → Vite +
react-router, Mongoose → EF Core) rather than a copy-paste port, it's split into the
focused pieces listed above instead — each with one clear responsibility, independently
testable. Legacy behavior (fields, validation rules, filter options) is the spec to
match; the file organization is not.

### RoleBasedNav port

Port `RoleBasedNav.tsx` + `useNavSections` largely as-is (already confirmed correct
nested-nav pattern, already using the `--admin-*` design-token CSS vars this monorepo's
frontend should also use). Swap `next/link`/`usePathname` for `react-router-dom`'s
`Link`/`useLocation`. Role-based section visibility logic in `useNavSections` is
ported unchanged — it's pure logic, framework-agnostic.

## Testing

TDD throughout. Backend: xUnit integration tests following the existing
`tests/ClimateProject.IntegrationTests/Auth/AuthFlowEndToEndTests.cs` pattern
(`WebApplicationFactory`, real Postgres via Testcontainers) — one test file per
endpoint group (`CompanyEndpointsTests.cs`, `DepartmentEndpointsTests.cs`), covering
the authorization matrix (SuperAdmin allowed, CompanyAdmin allowed only for own
company, other roles/companies 403) as well as the happy-path CRUD behavior. Frontend:
Vitest, following `web/src/api/health.test.ts`'s pattern for the typed API clients;
component tests are out of scope for this slice (no component-testing library is set
up in `web/` yet, and adding one is not part of what this slice needs).

## Out of scope (whole-slice level)

- Users, invitations, system settings, demographics, bulk import (later slices)
- Any deploy/infra work (monorepo consolidation plan already covers this — see
  `docs/superpowers/specs/2026-07-31-monorepo-frontend-consolidation-design.md`)
- i18n, PWA, design-system token work beyond reusing the existing `--admin-*` vars
  (that's `#57`, cross-cutting frontend)
