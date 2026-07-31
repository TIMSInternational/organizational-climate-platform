# Org structure migration — Slice 2: Users + Invitations

## Context

Follows Slice 1 (Companies + Departments + admin shell, done 2026-07-31, see
`2026-07-31-org-structure-slice1-companies-departments-design.md`). Second of the three
`#50` slices: 1. Companies+Departments+shell (done), **2. Users + roles + invitations
(this spec)**, 3. System settings + demographics + bulk import.

Legacy inventory (`climate-project` repo):
- `src/app/api/admin/users/route.ts` (292), `.../[id]/route.ts` (259), `.../[id]/role/route.ts`
- `src/app/api/admin/invitations/{shareable-link,company-admin,resend,employees}/route.ts`
  (292+184+83+238 = 797 lines)
- `src/app/api/admin/companies/[id]/resend-invitation/route.ts` (132)
- `src/components/admin/UserManagement.tsx` (1861 lines, rendered at `src/app/users/page.tsx`),
  `src/components/admin/UserRoleManager.tsx` (97)
- Email: `src/lib/email.ts` + `src/lib/email-providers/brevo.ts` (Brevo/Sendinblue)

EF Core entities already exist (`#49` org-structure slice): `User` (with `NodoId`,
`Preferences`, `Consent`, `Demographics` jsonb already modeled), `UserInvitation`
(`InvitationType`/`Status` as strings, token, expiry, reminder tracking). Neither needs
schema changes except the two additions below.

## Decisions carried in from research (2026-07-31, approved)

**Email is stubbed, not real.** Platform has no real users yet (dark deployment). Invitation
creation returns the token/link in the response and logs it; no Brevo call. `IInvitationEmailSender`
interface with a `LoggingInvitationEmailSender` implementation — swap in a real Brevo sender
later without touching invitation service logic.

**All three invitation types built together** (`company_admin_setup`, `employee_direct`,
`employee_self_signup` via shareable link) — they share the same create → token → accept
service logic and the schema already models all three as one `InvitationType` enum-string;
no cost to deferring any of them.

**Identity-mapping columns added now, backfill deferred to cutover** (`#56` decision,
see `[[project_migration_blocking_decisions_resolved]]` memory): add `User.PersonaExternalId`
(`string?`) and `Department.LegacyExternalId` (`string?`), and change JWT minting in
`AuthEndpoints.cs` to `Sub = user.PersonaExternalId ?? user.Id.ToString()`. The actual
backfill (populating these from old Mongo `_id`s) needs real exported Mongo data, which
doesn't exist in this dark deployment — that execution is `#59`'s job at real cutover time,
not this slice's. This slice only adds the columns and the JWT logic.

## Backend

### Pattern

Identical to Slice 1: minimal-API endpoints in `ClimateProject.Api/Endpoints/`,
`.RequireAuthorization()` + manual `Roles.Admin.Contains(currentUser.Role)` (or narrower)
check in the handler body — never `[Authorize(Roles=)]`. Business logic in
`ClimateProject.Application/OrgStructure/` (extends the existing folder from Slice 1).

### Endpoints

| Method | Route | Authorization | Notes |
|---|---|---|---|
| GET | `/admin/users?companyId=&departmentId=&role=` | `Roles.SuperAdmin` (any company) OR `Roles.CompanyAdmin` (own company only, `companyId` forced to own) | List, filterable |
| GET | `/admin/users/{id}` | Same scoping as Department (`CanAccessCompany` against the user's `CompanyId`) | Detail |
| PUT | `/admin/users/{id}` | Same scoping | Update profile fields, `DepartmentId`, `ManagerId`, `IsActive` (deactivate — no hard delete, matches Company/Department precedent) |
| PUT | `/admin/users/{id}/role` | `Roles.SuperAdmin` only (a CompanyAdmin changing their own role, or another admin's, is a privilege-escalation surface — keep this stricter than the general user-update scoping) | Role change |
| POST | `/admin/invitations` | `Roles.SuperAdmin` (`company_admin_setup`) or `Roles.Admin.Contains` scoped to own company (`employee_direct`) | Create + "send" (log link) |
| POST | `/admin/invitations/shareable-link` | `Roles.Admin.Contains`, scoped to own company for CompanyAdmin | Multi-use link, `employee_self_signup` |
| POST | `/admin/invitations/{id}/resend` | Same scoping as the invitation's company | Regenerates token/expiry, re-logs the link |
| GET | `/admin/invitations?companyId=` | Same scoping | List, for admin visibility into pending/sent/accepted/expired |
| POST | `/invitations/{token}/accept` | **Unauthenticated** — token itself is the credential | Validates token (not expired, status pending/sent/opened), creates or activates the `User`, sets password, marks invitation accepted |

Invitation deletion/cancellation: matches legacy — no hard delete; `PUT` isn't listed above
because cancel-by-status-update wasn't in the legacy route set either (only resend). If this
turns out to be needed during implementation, it's a small additive endpoint, not a design
change.

### New dependency: `IInvitationEmailSender`

```csharp
public interface IInvitationEmailSender
{
    Task SendAsync(UserInvitation invitation, string acceptUrl, CancellationToken ct);
}
```

`LoggingInvitationEmailSender` (only implementation this slice ships) logs
`invitation.Email` + `acceptUrl` via `ILogger` and returns immediately. Registered in
`Program.cs` DI alongside the other Slice 1/2 services.

### Out of scope for this slice (do not build)

- Real Brevo email sending (later, when there's a real user to email).
- System settings, demographics, bulk import (Slice 3).
- The actual `PersonaExternalId`/`LegacyExternalId` **backfill execution** (columns + JWT
  logic only; running it against real data is `#59`'s cutover job).
- `#56`'s `/internal/*` endpoints (separate issue, separate slice).

## Frontend

### Structure (extends `features/org-structure/` from Slice 1)

```
web/src/features/org-structure/
├── api/
│   ├── users.ts
│   └── invitations.ts
├── components/
│   ├── UserFilters.tsx
│   ├── UserList.tsx
│   ├── UserForm.tsx          # edit only — creation happens via invitation, not direct user creation
│   ├── RoleSelector.tsx
│   ├── InvitationList.tsx
│   ├── InvitationForm.tsx    # create company_admin_setup / employee_direct
│   └── ShareableLinkPanel.tsx
└── pages/
    ├── UsersListPage.tsx       # embeds UserList + InvitationList (tabs or sections, like
    │                           # CompanyDetailPage embedded departments in Slice 1)
    └── AcceptInvitationPage.tsx
```

`AcceptInvitationPage` is **new territory**: it lives outside `RequireAuth`/`AdminLayout`
entirely (route `/accept-invitation/:token`, sibling of `/login` in `router.tsx`, not nested
under the `AdminLayout` children) — the person hitting it doesn't have an account yet.

### Deliberate deviation from legacy: `UserManagement.tsx` is not ported as one file

Same rationale as Slice 1's `ModernCompanyManagement.tsx` split: 1861 lines doing list,
filtering, role management, and invitation UI together becomes the focused-component split
above instead. Legacy behavior (fields, validation, filter options) is the spec to match;
file organization is not.

## Testing

Same as Slice 1: xUnit integration tests (`WebApplicationFactory` + Testcontainers Postgres)
covering the authorization matrix per endpoint, one test file per endpoint group
(`UserEndpointsTests.cs`, `InvitationEndpointsTests.cs`). Frontend: Vitest for the typed API
clients, following `companies.test.ts`'s pattern. Component tests still out of scope (no
component-testing library set up in `web/`).

The invitation-accept flow additionally needs: expired-token rejection, already-accepted
token rejection, and a happy-path test that a created `User` is actually queryable afterward
with the right `CompanyId`/`Role`/`DepartmentId`.

## Out of scope (whole-slice level)

- System settings, demographics, bulk import (Slice 3)
- Real email delivery (later, non-blocking follow-up)
- `PersonaExternalId`/`LegacyExternalId` backfill execution (`#59` cutover)
- `#56`'s `/internal/*` endpoints (separate issue)
- i18n, PWA, design-system token work beyond reusing existing `--admin-*` vars (`#57`)
