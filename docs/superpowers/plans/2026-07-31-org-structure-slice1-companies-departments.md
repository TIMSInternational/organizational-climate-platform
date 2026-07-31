# Org Structure Slice 1: Companies + Departments + Admin Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port Company + Department management (CRUD, admin-only) from the legacy
climate-project Next.js app into this monorepo — .NET 10 endpoints + a React admin
shell that can log in, list/create/edit companies, and manage a company's departments.

**Architecture:** Backend follows the existing `AuthEndpoints.cs` shape exactly (minimal
API, manual role checks in the handler body, no `[Authorize(Roles=)]`). Frontend adds
`react-router-dom` to `web/` (currently a single static page) and a minimal admin shell
(login → sidebar layout → pages), each new UI concern in its own small file rather than
porting the legacy 2044-line `ModernCompanyManagement.tsx` as one file.

**Tech Stack:** ASP.NET Core minimal APIs, EF Core (existing `Company`/`Department`
entities, unchanged), xUnit + Testcontainers Postgres (backend tests), React + Vite +
react-router-dom (new dependency) + Vitest (frontend tests).

## Global Constraints

- Do not modify the EF Core schema (`Company`, `Department`, their configurations, or
  any migration) — query/mutate through the existing `ClimateProjectDbContext` only.
- **Known schema gap, not a bug to fix:** `Company` has no `IsActive`/status column
  (unlike `Department`, which does). Company list/detail therefore expose no status
  field and there is no `?status=active|inactive` filter — this is a deliberate
  omission matching what the schema actually supports, not an oversight.
- Authorization pattern: `.RequireAuthorization()` on the route + manual
  `Roles.Admin.Contains(currentUser.Role)` (or narrower) check in the handler body,
  returning `Results.Forbid()` on failure — copy `AuthEndpoints.cs`'s
  `ResetCredentialsAsync` handler as the reference. Do not use `[Authorize(Roles=)]`.
- Company management is `Roles.SuperAdmin`-only. Department management is
  `Roles.SuperAdmin` OR (`Roles.CompanyAdmin` AND acting on their own `CompanyId`).
- Do not add a company or department DELETE endpoint — out of scope for this slice
  (legacy has both; this slice intentionally omits them per the approved design).
- Do not build anything for: users, invitations, roles management, system settings,
  demographics, bulk import, i18n, or PWA — all separate, later slices.
- `.NET`: don't touch pinned package versions in any `.csproj`.
- Frontend: Node 20 LTS+ (repo-wide constraint from the monorepo-consolidation plan).

---

## Task 1: React Router + minimal login page

Everything after this task needs a way to get a real JWT into the browser — there is
no login UI anywhere in `web/` yet (it currently has one static health-check page).
This is a small, obviously-necessary addition, not scope creep into Slice 2 (which
covers *managing* users, not authenticating as one) — it consumes the already-working
`POST /auth/login` endpoint.

**Files:**
- Modify: `web/package.json` (add `react-router-dom`)
- Create: `web/src/auth/token.ts` — token storage
- Create: `web/src/auth/token.test.ts`
- Create: `web/src/auth/api.ts` — login API client
- Create: `web/src/auth/LoginPage.tsx`
- Create: `web/src/app/router.tsx`
- Create: `web/src/app/RequireAuth.tsx` — route guard
- Modify: `web/src/main.tsx` — mount the router instead of `<App />` directly

**Interfaces:**
- Consumes: `VITE_API_BASE_URL` (existing env var, from the monorepo-consolidation plan).
- Produces: `getToken(): string | null`, `setToken(token: string): void`,
  `clearToken(): void` (all in `web/src/auth/token.ts`) — every later task's API client
  reads the token via `getToken()` to set the `Authorization` header.

- [ ] **Step 1: Install react-router-dom**

```bash
cd web && npm install react-router-dom
```

- [ ] **Step 2: Write the failing test for token storage**

Create `web/src/auth/token.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { getToken, setToken, clearToken } from './token'

describe('token storage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns null when no token is stored', () => {
    expect(getToken()).toBeNull()
  })

  it('returns the token after setToken', () => {
    setToken('abc.def.ghi')
    expect(getToken()).toBe('abc.def.ghi')
  })

  it('returns null after clearToken', () => {
    setToken('abc.def.ghi')
    clearToken()
    expect(getToken()).toBeNull()
  })
})
```

- [ ] **Step 2b: Run it to verify it fails**

```bash
npx vitest run src/auth/token.test.ts
```
Expected: FAIL — `Cannot find module './token'`.

- [ ] **Step 3: Implement token storage**

Create `web/src/auth/token.ts`:
```typescript
const STORAGE_KEY = 'climate_platform_token'

export function getToken(): string | null {
  return localStorage.getItem(STORAGE_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(STORAGE_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(STORAGE_KEY)
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
npx vitest run src/auth/token.test.ts
```
Expected: PASS, 3 tests.

- [ ] **Step 5: Login API client**

Create `web/src/auth/api.ts`:
```typescript
export interface LoginResponse {
  token: string
}

export async function login(baseUrl: string, email: string, password: string): Promise<LoginResponse> {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })

  if (!response.ok) {
    throw new Error(response.status === 401 ? 'Invalid email or password' : `Login failed: ${response.status}`)
  }

  return response.json() as Promise<LoginResponse>
}
```

(No test file for this one — it's a thin wrapper with the same shape as
`web/src/api/health.ts`, which already has test coverage establishing the pattern;
the login *page*'s behavior is what Step 7 verifies manually.)

- [ ] **Step 6: Login page**

Create `web/src/auth/LoginPage.tsx`:
```tsx
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { login } from './api'
import { setToken } from './token'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const baseUrl = import.meta.env.VITE_API_BASE_URL as string
      const { token } = await login(baseUrl, email, password)
      setToken(token)
      navigate('/admin/companies')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Sign in</h1>
      {error && <p role="alert">{error}</p>}
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      <button type="submit" disabled={submitting}>
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
```

- [ ] **Step 7: Route guard**

Create `web/src/app/RequireAuth.tsx`:
```tsx
import { Navigate, Outlet } from 'react-router-dom'
import { getToken } from '../auth/token'

export default function RequireAuth() {
  return getToken() ? <Outlet /> : <Navigate to="/login" replace />
}
```

- [ ] **Step 8: Router**

Create `web/src/app/router.tsx`:
```tsx
import { createBrowserRouter } from 'react-router-dom'
import LoginPage from '../auth/LoginPage'
import RequireAuth from './RequireAuth'

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      // Task 5 replaces this placeholder with the real AdminLayout + company routes.
      { path: '/admin/companies', element: <div>Companies (placeholder — Task 5/6)</div> },
    ],
  },
])
```

- [ ] **Step 9: Mount the router**

Replace the contents of `web/src/main.tsx`:
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from './app/router'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
```

- [ ] **Step 10: Verify manually**

With the API running locally (`dotnet run --project src/ClimateProject.Api`) and
`npm run dev` in `web/`: visiting `http://localhost:5173/admin/companies` unauthenticated
redirects to `/login`. Logging in with a valid user (seed one via
`dotnet ef database update` + a manual signup if needed) redirects to
`/admin/companies` and shows the placeholder text.

- [ ] **Step 11: Commit**

```bash
git add web/package.json web/package-lock.json web/src/auth/ web/src/app/ web/src/main.tsx
git commit -m "feat: add react-router-dom, token storage, and a minimal login page"
```

---

## Task 2: Backend — Company endpoints

**Files:**
- Create: `src/ClimateProject.Application/OrgStructure/CompanyDtos.cs`
- Create: `src/ClimateProject.Application/OrgStructure/CompanyValidation.cs`
- Create: `src/ClimateProject.Api/Endpoints/CompanyEndpoints.cs`
- Modify: `src/ClimateProject.Api/Program.cs` (map the new endpoint group)
- Create: `tests/ClimateProject.IntegrationTests/OrgStructure/CompanyEndpointsTests.cs`

**Interfaces:**
- Consumes: `ClimateProjectDbContext.Companies`/`.Users` (existing), `CurrentUser`/
  `Roles` (existing, `Application/Auth/`).
- Produces: `GET/POST /admin/companies`, `GET/PUT /admin/companies/{id}` — the
  response shapes (`CompanyListItem`, `CompanyDetail`) are what Task 4's `companies.ts`
  API client and Task 6/7's pages consume.

- [ ] **Step 1: Write the failing authorization test**

Create `tests/ClimateProject.IntegrationTests/OrgStructure/CompanyEndpointsTests.cs`:
```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.OrgStructure;

[Collection("Postgres")]
public class CompanyEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _domain = $"orgco-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public CompanyEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = "Org Co",
            EmailDomain = _domain,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        _companyId = company.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<string> SignUpAndGetTokenAsync(HttpClient client, string role)
    {
        var email = $"{Guid.NewGuid():N}@{_domain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "a-good-password"));
        var token = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        if (role != Roles.Employee)
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = role;
            await db.SaveChangesAsync();

            // Re-login to get a token carrying the updated role claim.
            var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
            token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        }

        return token;
    }

    [Fact]
    public async Task Non_admin_role_is_forbidden_from_listing_companies()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.Employee);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.GetAsync("/admin/companies");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task CompanyAdmin_is_forbidden_from_listing_companies()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.GetAsync("/admin/companies");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task SuperAdmin_can_list_create_and_update_a_company()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var list = await client.GetAsync("/admin/companies");
        Assert.Equal(HttpStatusCode.OK, list.StatusCode);
        var listBody = await list.Content.ReadFromJsonAsync<CompanyListResponse>();
        Assert.Contains(listBody!.Companies, c => c.Id == _companyId);

        var createResponse = await client.PostAsJsonAsync("/admin/companies", new CreateCompanyRequest(
            Name: "New Co",
            EmailDomain: $"newco-{Guid.NewGuid():N}.test",
            Industry: "Software",
            Size: "small",
            Country: "US",
            SubscriptionTier: null));
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        var created = await createResponse.Content.ReadFromJsonAsync<CompanyDetail>();
        Assert.Equal("basic", created!.SubscriptionTier);

        var updateResponse = await client.PutAsJsonAsync($"/admin/companies/{created.Id}", new UpdateCompanyRequest(
            Name: "New Co Renamed",
            EmailDomain: null,
            Industry: null,
            Size: null,
            Country: null,
            SubscriptionTier: null));
        Assert.Equal(HttpStatusCode.OK, updateResponse.StatusCode);
        var updated = await updateResponse.Content.ReadFromJsonAsync<CompanyDetail>();
        Assert.Equal("New Co Renamed", updated!.Name);
        Assert.Equal("Software", updated.Industry);
    }

    [Fact]
    public async Task Create_rejects_a_malformed_domain()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/admin/companies", new CreateCompanyRequest(
            Name: "Bad Domain Co",
            EmailDomain: "not a domain",
            Industry: "Software",
            Size: "small",
            Country: "US",
            SubscriptionTier: null));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Create_rejects_a_duplicate_domain()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.PostAsJsonAsync("/admin/companies", new CreateCompanyRequest(
            Name: "Duplicate Co",
            EmailDomain: _domain,
            Industry: "Software",
            Size: "small",
            Country: "US",
            SubscriptionTier: null));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

```bash
dotnet test tests/ClimateProject.IntegrationTests --filter CompanyEndpointsTests
```
Expected: FAIL to compile — `ClimateProject.Application.OrgStructure` and the
`CompanyEndpoints` route group don't exist yet.

- [ ] **Step 3: DTOs**

Create `src/ClimateProject.Application/OrgStructure/CompanyDtos.cs`:
```csharp
namespace ClimateProject.Application.OrgStructure;

public sealed record CompanyListItem(
    Guid Id,
    string Name,
    string? EmailDomain,
    string? Industry,
    string? Size,
    string? Country,
    string? SubscriptionTier,
    DateTimeOffset CreatedAt);

public sealed record CompanyListResponse(IReadOnlyList<CompanyListItem> Companies);

public sealed record CompanyDetail(
    Guid Id,
    string Name,
    string? EmailDomain,
    string? Industry,
    string? Size,
    string? Country,
    string? SubscriptionTier,
    DateTimeOffset CreatedAt,
    int UserCount);

public sealed record CreateCompanyRequest(
    string Name,
    string EmailDomain,
    string Industry,
    string Size,
    string Country,
    string? SubscriptionTier);

public sealed record UpdateCompanyRequest(
    string? Name,
    string? EmailDomain,
    string? Industry,
    string? Size,
    string? Country,
    string? SubscriptionTier);
```

- [ ] **Step 4: Validation helper**

Create `src/ClimateProject.Application/OrgStructure/CompanyValidation.cs`:
```csharp
using System.Text.RegularExpressions;

namespace ClimateProject.Application.OrgStructure;

public static class CompanyValidation
{
    // Same pattern the legacy climate-project app used for company domain validation.
    private static readonly Regex DomainPattern = new(
        @"^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$",
        RegexOptions.Compiled);

    public static readonly string[] ValidSizes = ["startup", "small", "medium", "large", "enterprise"];
    public static readonly string[] ValidSubscriptionTiers = ["basic", "professional", "enterprise"];

    public static bool IsValidDomain(string domain) => DomainPattern.IsMatch(domain);
}
```

- [ ] **Step 5: Endpoints**

Create `src/ClimateProject.Api/Endpoints/CompanyEndpoints.cs`:
```csharp
using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class CompanyEndpoints
{
    public static void MapCompanyEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/admin/companies").RequireAuthorization();

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);
        group.MapGet("/{id:guid}", GetAsync);
        group.MapPut("/{id:guid}", UpdateAsync);
    }

    private static async Task<IResult> ListAsync(
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (currentUser.Role != Roles.SuperAdmin)
        {
            return Results.Forbid();
        }

        var companies = await db.Companies
            .OrderByDescending(c => c.CreatedAt)
            .Select(c => new CompanyListItem(c.Id, c.Name, c.EmailDomain, c.Industry, c.Size, c.Country, c.SubscriptionTier, c.CreatedAt))
            .ToListAsync(cancellationToken);

        return Results.Ok(new CompanyListResponse(companies));
    }

    private static async Task<IResult> CreateAsync(
        CreateCompanyRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (currentUser.Role != Roles.SuperAdmin)
        {
            return Results.Forbid();
        }

        if (string.IsNullOrWhiteSpace(request.Name)
            || string.IsNullOrWhiteSpace(request.EmailDomain)
            || string.IsNullOrWhiteSpace(request.Industry)
            || string.IsNullOrWhiteSpace(request.Size)
            || string.IsNullOrWhiteSpace(request.Country))
        {
            return Results.Json(new { message = "Name, emailDomain, industry, size, and country are required" }, statusCode: 400);
        }

        var domain = request.EmailDomain.Trim().ToLowerInvariant();
        if (!CompanyValidation.IsValidDomain(domain))
        {
            return Results.Json(new { message = $"Invalid domain format: {domain}" }, statusCode: 400);
        }

        if (!CompanyValidation.ValidSizes.Contains(request.Size))
        {
            return Results.Json(new { message = $"Invalid size: {request.Size}" }, statusCode: 400);
        }

        var subscriptionTier = string.IsNullOrWhiteSpace(request.SubscriptionTier) ? "basic" : request.SubscriptionTier;
        if (!CompanyValidation.ValidSubscriptionTiers.Contains(subscriptionTier))
        {
            return Results.Json(new { message = $"Invalid subscription tier: {subscriptionTier}" }, statusCode: 400);
        }

        var existing = await db.Companies.FirstOrDefaultAsync(c => c.EmailDomain == domain, cancellationToken);
        if (existing is not null)
        {
            return Results.Json(new { message = $"Domain already exists: {domain}" }, statusCode: 409);
        }

        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = request.Name.Trim(),
            EmailDomain = domain,
            Industry = request.Industry.Trim(),
            Size = request.Size,
            Country = request.Country.Trim(),
            SubscriptionTier = subscriptionTier,
            CreatedAt = DateTimeOffset.UtcNow,
        };

        db.Companies.Add(company);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(
            new CompanyDetail(company.Id, company.Name, company.EmailDomain, company.Industry, company.Size, company.Country, company.SubscriptionTier, company.CreatedAt, UserCount: 0),
            statusCode: 201);
    }

    private static async Task<IResult> GetAsync(
        Guid id,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (currentUser.Role != Roles.SuperAdmin)
        {
            return Results.Forbid();
        }

        var company = await db.Companies.FirstOrDefaultAsync(c => c.Id == id, cancellationToken);
        if (company is null)
        {
            return Results.Json(new { message = "Company not found" }, statusCode: 404);
        }

        var userCount = await db.Users.CountAsync(u => u.CompanyId == id && u.IsActive, cancellationToken);

        return Results.Ok(new CompanyDetail(company.Id, company.Name, company.EmailDomain, company.Industry, company.Size, company.Country, company.SubscriptionTier, company.CreatedAt, userCount));
    }

    private static async Task<IResult> UpdateAsync(
        Guid id,
        UpdateCompanyRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (currentUser.Role != Roles.SuperAdmin)
        {
            return Results.Forbid();
        }

        var company = await db.Companies.FirstOrDefaultAsync(c => c.Id == id, cancellationToken);
        if (company is null)
        {
            return Results.Json(new { message = "Company not found" }, statusCode: 404);
        }

        if (!string.IsNullOrWhiteSpace(request.EmailDomain))
        {
            var domain = request.EmailDomain.Trim().ToLowerInvariant();
            if (domain != company.EmailDomain)
            {
                if (!CompanyValidation.IsValidDomain(domain))
                {
                    return Results.Json(new { message = $"Invalid domain format: {domain}" }, statusCode: 400);
                }

                var existing = await db.Companies.FirstOrDefaultAsync(c => c.EmailDomain == domain && c.Id != id, cancellationToken);
                if (existing is not null)
                {
                    return Results.Json(new { message = "Domain already exists" }, statusCode: 409);
                }

                company.EmailDomain = domain;
            }
        }

        if (!string.IsNullOrWhiteSpace(request.Name))
        {
            company.Name = request.Name.Trim();
        }

        if (!string.IsNullOrWhiteSpace(request.Industry))
        {
            company.Industry = request.Industry.Trim();
        }

        if (!string.IsNullOrWhiteSpace(request.Size))
        {
            if (!CompanyValidation.ValidSizes.Contains(request.Size))
            {
                return Results.Json(new { message = $"Invalid size: {request.Size}" }, statusCode: 400);
            }

            company.Size = request.Size;
        }

        if (!string.IsNullOrWhiteSpace(request.Country))
        {
            company.Country = request.Country.Trim();
        }

        if (!string.IsNullOrWhiteSpace(request.SubscriptionTier))
        {
            if (!CompanyValidation.ValidSubscriptionTiers.Contains(request.SubscriptionTier))
            {
                return Results.Json(new { message = $"Invalid subscription tier: {request.SubscriptionTier}" }, statusCode: 400);
            }

            company.SubscriptionTier = request.SubscriptionTier;
        }

        await db.SaveChangesAsync(cancellationToken);

        var userCount = await db.Users.CountAsync(u => u.CompanyId == id && u.IsActive, cancellationToken);

        return Results.Ok(new CompanyDetail(company.Id, company.Name, company.EmailDomain, company.Industry, company.Size, company.Country, company.SubscriptionTier, company.CreatedAt, userCount));
    }
}
```

- [ ] **Step 6: Wire it into `Program.cs`**

Add `using ClimateProject.Application.OrgStructure;` to the top of
`src/ClimateProject.Api/Program.cs`, and add `app.MapCompanyEndpoints();` on the line
immediately after `app.MapAuthEndpoints();`.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
dotnet test tests/ClimateProject.IntegrationTests --filter CompanyEndpointsTests
```
Expected: PASS, 5 tests.

- [ ] **Step 8: Run the full suite to check for regressions**

```bash
dotnet test ClimateProject.slnx
```
Expected: same pass count as before this task, plus these 5 new tests, no regressions.

- [ ] **Step 9: Commit**

```bash
git add src/ClimateProject.Application/OrgStructure/CompanyDtos.cs \
        src/ClimateProject.Application/OrgStructure/CompanyValidation.cs \
        src/ClimateProject.Api/Endpoints/CompanyEndpoints.cs \
        src/ClimateProject.Api/Program.cs \
        tests/ClimateProject.IntegrationTests/OrgStructure/CompanyEndpointsTests.cs
git commit -m "feat: add Company admin endpoints (list/create/get/update)"
```

---

## Task 3: Backend — Department endpoints

**Files:**
- Create: `src/ClimateProject.Application/OrgStructure/DepartmentDtos.cs`
- Create: `src/ClimateProject.Api/Endpoints/DepartmentEndpoints.cs`
- Modify: `src/ClimateProject.Api/Program.cs`
- Create: `tests/ClimateProject.IntegrationTests/OrgStructure/DepartmentEndpointsTests.cs`

**Interfaces:**
- Consumes: `ClimateProjectDbContext.Departments` (existing), `Roles`/`CurrentUser`
  (existing), the same `SignUpAndGetTokenAsync`-style role-seeding approach as Task 2
  (each test file has its own private copy — no shared test helper is introduced here,
  matching this codebase's existing per-file pattern).
- Produces: `GET/POST /admin/departments`, `GET/PUT /admin/departments/{id}` — consumed
  by Task 4's `departments.ts` and Task 7's `CompanyDetailPage`/`DepartmentList`.

- [ ] **Step 1: Write the failing tests**

Create `tests/ClimateProject.IntegrationTests/OrgStructure/DepartmentEndpointsTests.cs`:
```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.OrgStructure;

[Collection("Postgres")]
public class DepartmentEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyADomain = $"depta-{Guid.NewGuid():N}.test";
    private readonly string _companyBDomain = $"deptb-{Guid.NewGuid():N}.test";
    private Guid _companyAId;
    private Guid _companyBId;

    public DepartmentEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var companyA = new Company { Id = Guid.NewGuid(), Name = "Dept Co A", EmailDomain = _companyADomain, CreatedAt = DateTimeOffset.UtcNow };
        var companyB = new Company { Id = Guid.NewGuid(), Name = "Dept Co B", EmailDomain = _companyBDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.AddRange(companyA, companyB);
        _companyAId = companyA.Id;
        _companyBId = companyB.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<string> SignUpAndGetTokenAsync(HttpClient client, string role, string emailDomain, Guid? companyId = null)
    {
        var email = $"{Guid.NewGuid():N}@{emailDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "a-good-password"));
        var token = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        if (role != Roles.Employee)
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = role;
            if (companyId.HasValue)
            {
                user.CompanyId = companyId.Value;
            }
            await db.SaveChangesAsync();

            var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
            token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        }

        return token;
    }

    [Fact]
    public async Task CompanyAdmin_can_create_and_list_departments_in_their_own_company()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/admin/departments", new CreateDepartmentRequest(
            CompanyId: _companyAId, Name: "Engineering", Description: null, ParentDepartmentId: null, IsActive: true));
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        var created = await createResponse.Content.ReadFromJsonAsync<DepartmentDetail>();
        Assert.Equal("Engineering", created!.Name);

        var listResponse = await client.GetAsync($"/admin/departments?companyId={_companyAId}");
        Assert.Equal(HttpStatusCode.OK, listResponse.StatusCode);
        var list = await listResponse.Content.ReadFromJsonAsync<DepartmentListResponse>();
        Assert.Contains(list!.Departments, d => d.Id == created.Id);
    }

    [Fact]
    public async Task CompanyAdmin_cannot_list_or_create_departments_in_another_company()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var listResponse = await client.GetAsync($"/admin/departments?companyId={_companyBId}");
        Assert.Equal(HttpStatusCode.Forbidden, listResponse.StatusCode);

        var createResponse = await client.PostAsJsonAsync("/admin/departments", new CreateDepartmentRequest(
            CompanyId: _companyBId, Name: "Sales", Description: null, ParentDepartmentId: null, IsActive: true));
        Assert.Equal(HttpStatusCode.Forbidden, createResponse.StatusCode);
    }

    [Fact]
    public async Task SuperAdmin_can_manage_departments_in_any_company()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin, _companyADomain);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var createResponse = await client.PostAsJsonAsync("/admin/departments", new CreateDepartmentRequest(
            CompanyId: _companyBId, Name: "Marketing", Description: null, ParentDepartmentId: null, IsActive: true));
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);

        var listResponse = await client.GetAsync($"/admin/departments?companyId={_companyBId}");
        Assert.Equal(HttpStatusCode.OK, listResponse.StatusCode);
    }

    [Fact]
    public async Task Create_rejects_duplicate_name_at_the_same_level()
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, Roles.CompanyAdmin, _companyADomain, _companyAId);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        await client.PostAsJsonAsync("/admin/departments", new CreateDepartmentRequest(
            CompanyId: _companyAId, Name: "HR", Description: null, ParentDepartmentId: null, IsActive: true));

        var duplicate = await client.PostAsJsonAsync("/admin/departments", new CreateDepartmentRequest(
            CompanyId: _companyAId, Name: "HR", Description: null, ParentDepartmentId: null, IsActive: true));

        Assert.Equal(HttpStatusCode.BadRequest, duplicate.StatusCode);
    }

    [Fact]
    public async Task Create_rejects_a_parent_department_from_a_different_company()
    {
        var client = _factory.CreateClient();
        var superAdminToken = await SignUpAndGetTokenAsync(client, Roles.SuperAdmin, _companyADomain);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", superAdminToken);

        var parentInB = await client.PostAsJsonAsync("/admin/departments", new CreateDepartmentRequest(
            CompanyId: _companyBId, Name: "Parent In B", Description: null, ParentDepartmentId: null, IsActive: true));
        var parent = await parentInB.Content.ReadFromJsonAsync<DepartmentDetail>();

        var response = await client.PostAsJsonAsync("/admin/departments", new CreateDepartmentRequest(
            CompanyId: _companyAId, Name: "Child In A", Description: null, ParentDepartmentId: parent!.Id, IsActive: true));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

```bash
dotnet test tests/ClimateProject.IntegrationTests --filter DepartmentEndpointsTests
```
Expected: FAIL to compile — `DepartmentDtos`/`DepartmentEndpoints` don't exist yet.

- [ ] **Step 3: DTOs**

Create `src/ClimateProject.Application/OrgStructure/DepartmentDtos.cs`:
```csharp
namespace ClimateProject.Application.OrgStructure;

public sealed record DepartmentListItem(
    Guid Id,
    Guid CompanyId,
    string Name,
    string? Description,
    Guid? ParentDepartmentId,
    bool IsActive,
    int EmployeeCount);

public sealed record DepartmentListResponse(IReadOnlyList<DepartmentListItem> Departments);

public sealed record DepartmentDetail(
    Guid Id,
    Guid CompanyId,
    string Name,
    string? Description,
    Guid? ParentDepartmentId,
    bool IsActive,
    int EmployeeCount);

public sealed record CreateDepartmentRequest(
    Guid CompanyId,
    string Name,
    string? Description,
    Guid? ParentDepartmentId,
    bool IsActive);

public sealed record UpdateDepartmentRequest(
    string? Name,
    string? Description,
    bool? IsActive);
```

- [ ] **Step 4: Endpoints**

Create `src/ClimateProject.Api/Endpoints/DepartmentEndpoints.cs`:
```csharp
using System.Security.Claims;
using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public static class DepartmentEndpoints
{
    public static void MapDepartmentEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/admin/departments").RequireAuthorization();

        group.MapGet("", ListAsync);
        group.MapPost("", CreateAsync);
        group.MapGet("/{id:guid}", GetAsync);
        group.MapPut("/{id:guid}", UpdateAsync);
    }

    private static bool CanAccessCompany(CurrentUser currentUser, Guid companyId)
        => currentUser.Role == Roles.SuperAdmin
           || (currentUser.Role == Roles.CompanyAdmin && currentUser.CompanyId == companyId.ToString());

    private static async Task<IResult> ListAsync(
        Guid companyId,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, companyId))
        {
            return Results.Forbid();
        }

        var departments = await db.Departments
            .Where(d => d.CompanyId == companyId)
            .OrderBy(d => d.Name)
            .Select(d => new DepartmentListItem(d.Id, d.CompanyId, d.Name, d.Description, d.ParentDepartmentId, d.IsActive, d.EmployeeCount))
            .ToListAsync(cancellationToken);

        return Results.Ok(new DepartmentListResponse(departments));
    }

    private static async Task<IResult> CreateAsync(
        CreateDepartmentRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        if (!CanAccessCompany(currentUser, request.CompanyId))
        {
            return Results.Forbid();
        }

        if (string.IsNullOrWhiteSpace(request.Name) || request.Name.Length > 100)
        {
            return Results.Json(new { message = "Name is required and must be at most 100 characters" }, statusCode: 400);
        }

        if (request.Description is { Length: > 500 })
        {
            return Results.Json(new { message = "Description must be at most 500 characters" }, statusCode: 400);
        }

        if (request.ParentDepartmentId.HasValue)
        {
            var parent = await db.Departments.FirstOrDefaultAsync(d => d.Id == request.ParentDepartmentId.Value, cancellationToken);
            if (parent is null || parent.CompanyId != request.CompanyId)
            {
                return Results.Json(new { message = "Parent department must exist in the same company" }, statusCode: 400);
            }
        }

        var duplicate = await db.Departments.FirstOrDefaultAsync(
            d => d.CompanyId == request.CompanyId
                 && d.Name == request.Name
                 && d.ParentDepartmentId == request.ParentDepartmentId,
            cancellationToken);
        if (duplicate is not null)
        {
            return Results.Json(new { message = "Department with this name already exists at this level" }, statusCode: 400);
        }

        var department = new Department
        {
            Id = Guid.NewGuid(),
            CompanyId = request.CompanyId,
            Name = request.Name.Trim(),
            Description = request.Description?.Trim(),
            ParentDepartmentId = request.ParentDepartmentId,
            IsActive = request.IsActive,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };

        db.Departments.Add(department);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Json(
            new DepartmentDetail(department.Id, department.CompanyId, department.Name, department.Description, department.ParentDepartmentId, department.IsActive, department.EmployeeCount),
            statusCode: 201);
    }

    private static async Task<IResult> GetAsync(
        Guid id,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var department = await db.Departments.FirstOrDefaultAsync(d => d.Id == id, cancellationToken);
        if (department is null)
        {
            return Results.Json(new { message = "Department not found" }, statusCode: 404);
        }

        if (!CanAccessCompany(currentUser, department.CompanyId))
        {
            return Results.Forbid();
        }

        return Results.Ok(new DepartmentDetail(department.Id, department.CompanyId, department.Name, department.Description, department.ParentDepartmentId, department.IsActive, department.EmployeeCount));
    }

    private static async Task<IResult> UpdateAsync(
        Guid id,
        UpdateDepartmentRequest request,
        ClaimsPrincipal principal,
        ClimateProjectDbContext db,
        CancellationToken cancellationToken)
    {
        var currentUser = principal.GetCurrentUser();
        var department = await db.Departments.FirstOrDefaultAsync(d => d.Id == id, cancellationToken);
        if (department is null)
        {
            return Results.Json(new { message = "Department not found" }, statusCode: 404);
        }

        if (!CanAccessCompany(currentUser, department.CompanyId))
        {
            return Results.Forbid();
        }

        if (!string.IsNullOrWhiteSpace(request.Name) && request.Name != department.Name)
        {
            if (request.Name.Length > 100)
            {
                return Results.Json(new { message = "Name must be at most 100 characters" }, statusCode: 400);
            }

            var duplicate = await db.Departments.FirstOrDefaultAsync(
                d => d.CompanyId == department.CompanyId
                     && d.Name == request.Name
                     && d.ParentDepartmentId == department.ParentDepartmentId
                     && d.Id != id,
                cancellationToken);
            if (duplicate is not null)
            {
                return Results.Json(new { message = "Department with this name already exists at this level" }, statusCode: 400);
            }

            department.Name = request.Name.Trim();
        }

        if (request.Description is not null)
        {
            if (request.Description.Length > 500)
            {
                return Results.Json(new { message = "Description must be at most 500 characters" }, statusCode: 400);
            }

            department.Description = request.Description.Trim();
        }

        if (request.IsActive.HasValue)
        {
            department.IsActive = request.IsActive.Value;
        }

        department.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(new DepartmentDetail(department.Id, department.CompanyId, department.Name, department.Description, department.ParentDepartmentId, department.IsActive, department.EmployeeCount));
    }
}
```

- [ ] **Step 5: Wire it into `Program.cs`**

Add `app.MapDepartmentEndpoints();` immediately after `app.MapCompanyEndpoints();`.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
dotnet test tests/ClimateProject.IntegrationTests --filter DepartmentEndpointsTests
```
Expected: PASS, 5 tests.

- [ ] **Step 7: Run the full suite**

```bash
dotnet test ClimateProject.slnx
```
Expected: no regressions, plus these 5 new tests.

- [ ] **Step 8: Commit**

```bash
git add src/ClimateProject.Application/OrgStructure/DepartmentDtos.cs \
        src/ClimateProject.Api/Endpoints/DepartmentEndpoints.cs \
        src/ClimateProject.Api/Program.cs \
        tests/ClimateProject.IntegrationTests/OrgStructure/DepartmentEndpointsTests.cs
git commit -m "feat: add Department admin endpoints (list/create/get/update)"
```

---

## Task 4: Frontend — typed API clients for companies and departments

**Files:**
- Create: `web/src/features/org-structure/api/companies.ts`
- Create: `web/src/features/org-structure/api/companies.test.ts`
- Create: `web/src/features/org-structure/api/departments.ts`
- Create: `web/src/features/org-structure/api/departments.test.ts`
- Create: `web/src/api/authFetch.ts` — shared authenticated-fetch helper

**Interfaces:**
- Consumes: `getToken()` from `web/src/auth/token.ts` (Task 1).
- Produces: `listCompanies`, `createCompany`, `getCompany`, `updateCompany` and their
  Department equivalents — exact signatures below — consumed by Task 6/7's pages.

- [ ] **Step 1: Shared authenticated-fetch helper (no test — thin wrapper, exercised
  indirectly by every test below)**

Create `web/src/api/authFetch.ts`:
```typescript
import { getToken } from '../auth/token'

export async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken()
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(url, { ...init, headers })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error((body && body.message) || `Request failed: ${response.status}`)
  }
  return response
}
```

- [ ] **Step 2: Write the failing test for the companies client**

Create `web/src/features/org-structure/api/companies.test.ts`:
```typescript
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { listCompanies, createCompany, getCompany, updateCompany } from './companies'

const BASE_URL = 'http://localhost:5080'

describe('companies API client', () => {
  beforeEach(() => {
    localStorage.setItem('climate_platform_token', 'test-token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('lists companies', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ companies: [{ id: '1', name: 'Acme', emailDomain: 'acme.test', industry: null, size: null, country: null, subscriptionTier: null, createdAt: '2026-01-01T00:00:00Z' }] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await listCompanies(BASE_URL)

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Acme')
    expect(mockFetch).toHaveBeenCalledWith(`${BASE_URL}/admin/companies`, expect.objectContaining({
      headers: expect.any(Headers),
    }))
  })

  it('creates a company', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: '2', name: 'New Co', emailDomain: 'newco.test', industry: 'Tech', size: 'small', country: 'US', subscriptionTier: 'basic', createdAt: '2026-01-01T00:00:00Z', userCount: 0 }),
    }))

    const result = await createCompany(BASE_URL, { name: 'New Co', emailDomain: 'newco.test', industry: 'Tech', size: 'small', country: 'US' })

    expect(result.name).toBe('New Co')
  })

  it('gets a company by id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: '1', name: 'Acme', emailDomain: 'acme.test', industry: null, size: null, country: null, subscriptionTier: null, createdAt: '2026-01-01T00:00:00Z', userCount: 3 }),
    }))

    const result = await getCompany(BASE_URL, '1')

    expect(result.userCount).toBe(3)
  })

  it('updates a company', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: '1', name: 'Acme Renamed', emailDomain: 'acme.test', industry: null, size: null, country: null, subscriptionTier: null, createdAt: '2026-01-01T00:00:00Z', userCount: 3 }),
    }))

    const result = await updateCompany(BASE_URL, '1', { name: 'Acme Renamed' })

    expect(result.name).toBe('Acme Renamed')
  })

  it('throws with the server message on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ message: 'Domain already exists' }),
    }))

    await expect(createCompany(BASE_URL, { name: 'Dup', emailDomain: 'dup.test', industry: 'Tech', size: 'small', country: 'US' }))
      .rejects.toThrow('Domain already exists')
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

```bash
cd web && npx vitest run src/features/org-structure/api/companies.test.ts
```
Expected: FAIL — `Cannot find module './companies'`.

- [ ] **Step 4: Implement the companies client**

Create `web/src/features/org-structure/api/companies.ts`:
```typescript
import { authFetch } from '../../../api/authFetch'

export interface Company {
  id: string
  name: string
  emailDomain: string | null
  industry: string | null
  size: string | null
  country: string | null
  subscriptionTier: string | null
  createdAt: string
}

export interface CompanyDetail extends Company {
  userCount: number
}

export interface CreateCompanyInput {
  name: string
  emailDomain: string
  industry: string
  size: string
  country: string
  subscriptionTier?: string
}

export interface UpdateCompanyInput {
  name?: string
  emailDomain?: string
  industry?: string
  size?: string
  country?: string
  subscriptionTier?: string
}

export async function listCompanies(baseUrl: string): Promise<Company[]> {
  const response = await authFetch(`${baseUrl}/admin/companies`)
  const body = (await response.json()) as { companies: Company[] }
  return body.companies
}

export async function createCompany(baseUrl: string, input: CreateCompanyInput): Promise<CompanyDetail> {
  const response = await authFetch(`${baseUrl}/admin/companies`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<CompanyDetail>
}

export async function getCompany(baseUrl: string, id: string): Promise<CompanyDetail> {
  const response = await authFetch(`${baseUrl}/admin/companies/${id}`)
  return response.json() as Promise<CompanyDetail>
}

export async function updateCompany(baseUrl: string, id: string, input: UpdateCompanyInput): Promise<CompanyDetail> {
  const response = await authFetch(`${baseUrl}/admin/companies/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<CompanyDetail>
}
```

- [ ] **Step 5: Run it to verify it passes**

```bash
npx vitest run src/features/org-structure/api/companies.test.ts
```
Expected: PASS, 5 tests.

- [ ] **Step 6: Write the failing test for the departments client**

Create `web/src/features/org-structure/api/departments.test.ts`:
```typescript
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { listDepartments, createDepartment, updateDepartment } from './departments'

const BASE_URL = 'http://localhost:5080'

describe('departments API client', () => {
  beforeEach(() => {
    localStorage.setItem('climate_platform_token', 'test-token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('lists departments for a company', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ departments: [{ id: 'd1', companyId: 'c1', name: 'Engineering', description: null, parentDepartmentId: null, isActive: true, employeeCount: 0 }] }),
    }))

    const result = await listDepartments(BASE_URL, 'c1')

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Engineering')
  })

  it('creates a department', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'd2', companyId: 'c1', name: 'Sales', description: null, parentDepartmentId: null, isActive: true, employeeCount: 0 }),
    }))

    const result = await createDepartment(BASE_URL, { companyId: 'c1', name: 'Sales', isActive: true })

    expect(result.name).toBe('Sales')
  })

  it('updates a department', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'd1', companyId: 'c1', name: 'Engineering', description: 'Renamed', parentDepartmentId: null, isActive: true, employeeCount: 0 }),
    }))

    const result = await updateDepartment(BASE_URL, 'd1', { description: 'Renamed' })

    expect(result.description).toBe('Renamed')
  })
})
```

- [ ] **Step 7: Run it to verify it fails**

```bash
npx vitest run src/features/org-structure/api/departments.test.ts
```
Expected: FAIL — `Cannot find module './departments'`.

- [ ] **Step 8: Implement the departments client**

Create `web/src/features/org-structure/api/departments.ts`:
```typescript
import { authFetch } from '../../../api/authFetch'

export interface Department {
  id: string
  companyId: string
  name: string
  description: string | null
  parentDepartmentId: string | null
  isActive: boolean
  employeeCount: number
}

export interface CreateDepartmentInput {
  companyId: string
  name: string
  description?: string
  parentDepartmentId?: string
  isActive: boolean
}

export interface UpdateDepartmentInput {
  name?: string
  description?: string
  isActive?: boolean
}

export async function listDepartments(baseUrl: string, companyId: string): Promise<Department[]> {
  const response = await authFetch(`${baseUrl}/admin/departments?companyId=${companyId}`)
  const body = (await response.json()) as { departments: Department[] }
  return body.departments
}

export async function createDepartment(baseUrl: string, input: CreateDepartmentInput): Promise<Department> {
  const response = await authFetch(`${baseUrl}/admin/departments`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<Department>
}

export async function updateDepartment(baseUrl: string, id: string, input: UpdateDepartmentInput): Promise<Department> {
  const response = await authFetch(`${baseUrl}/admin/departments/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<Department>
}
```

- [ ] **Step 9: Run it to verify it passes**

```bash
npx vitest run src/features/org-structure/api/departments.test.ts
```
Expected: PASS, 3 tests.

- [ ] **Step 10: Commit**

```bash
git add web/src/api/authFetch.ts web/src/features/org-structure/api/
git commit -m "feat: add typed API clients for companies and departments"
```

---

## Task 5: Frontend — AdminLayout + nav port + router wiring

**Files:**
- Create: `web/src/navigation/RoleBasedNav.tsx` — port of the legacy rendering
  component (framework-agnostic logic kept, `next/link`/`usePathname` swapped for
  `react-router-dom`)
- Create: `web/src/navigation/navSections.ts` — **new, minimal** nav data for what
  actually exists today (not a port of the legacy `useNavSections.ts`, which has ~15
  sections pointing at features that don't exist in this monorepo yet — porting it
  verbatim would mean dead links; see rationale below)
- Create: `web/src/app/AdminLayout.tsx`
- Modify: `web/src/app/router.tsx` — replace the Task 1 placeholder route

**Interfaces:**
- Consumes: nothing new.
- Produces: `<AdminLayout>` (wraps `/admin/*` routes via `react-router-dom`'s
  `<Outlet />`), used by Task 6/7's page routes.

**Why `navSections.ts` is new, not ported:** the legacy `useNavSections.ts` (316
lines) renders survey/microclimate/action-plan/tracking/analytics sections — none of
which exist in this monorepo yet. Porting it verbatim would either 404 on click or
require stubbing ~10 unbuilt routes. Instead, this task ports `RoleBasedNav.tsx`'s
*rendering* component (the nested-nav/breadcrumb-connector logic, which is
content-agnostic) and supplies a small nav-sections list containing only what Slice 1
actually built. Later slices add their own sections to this same list as they land —
the rendering component doesn't change.

- [ ] **Step 1: Port the nav rendering component**

Create `web/src/navigation/RoleBasedNav.tsx` (based on the legacy file at
`/Users/federicotafur/Desktop/NexaDev/clients/tims-international/github/climate-project/src/components/navigation/RoleBasedNav.tsx`
— read it for the exact `SubItemBreadcrumb` connector-line styling and `matchesRoute`
logic, which are ported unchanged; only the routing-library calls change):
```tsx
import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import type { NavSection, NavItem as NavItemType } from './navSections'

function SubItemBreadcrumb({ isLast, isActive }: { isLast: boolean; isActive: boolean }) {
  const lineColor = 'var(--admin-border-default)'
  const activeColor = 'var(--admin-font-tertiary)'
  return (
    <div style={{ position: 'relative', width: 16, height: 28, flexShrink: 0, marginLeft: 8 }}>
      <div style={{ position: 'absolute', left: 4, top: 0, width: 1, height: 14, background: isActive ? activeColor : lineColor }} />
      <div style={{ position: 'absolute', left: 4, top: 14, width: 8, height: 1, background: isActive ? activeColor : lineColor, borderBottomLeftRadius: 2 }} />
      {!isLast && <div style={{ position: 'absolute', left: 4, top: 14, width: 1, height: 14, background: lineColor }} />}
    </div>
  )
}

function matchesRoute(pathname: string, href: string) {
  if (href === '/dashboard') {
    return pathname === '/dashboard' || pathname === '/'
  }
  return pathname.startsWith(href)
}

export default function RoleBasedNav({ sections }: { sections: NavSection[] }) {
  const location = useLocation()
  const pathname = location.pathname
  const [expanded, setExpanded] = useState<string[]>(() => {
    const initiallyExpanded: string[] = []
    for (const section of sections) {
      for (const item of section.items) {
        if (item.sub?.some((sub) => matchesRoute(pathname, sub.href))) {
          initiallyExpanded.push(item.label)
        }
      }
    }
    return initiallyExpanded
  })

  function toggleExpand(label: string) {
    setExpanded((current) => (current.includes(label) ? current.filter((l) => l !== label) : [...current, label]))
  }

  function renderItem(item: NavItemType) {
    const isActive = matchesRoute(pathname, item.href)
    const hasSub = Boolean(item.sub?.length)
    const isExpanded = expanded.includes(item.label)

    return (
      <div key={item.label}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Link
            to={item.href}
            onClick={hasSub ? (e) => { e.preventDefault(); toggleExpand(item.label) } : undefined}
            style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, textDecoration: 'none', color: isActive ? 'var(--admin-font-primary)' : 'var(--admin-font-secondary)' }}
          >
            <item.icon className="nav-icon" />
            <span>{item.label}</span>
            {item.badge && <span className="nav-badge">{item.badge}</span>}
          </Link>
          {hasSub && (
            <ChevronRight
              onClick={() => toggleExpand(item.label)}
              style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', cursor: 'pointer' }}
            />
          )}
        </div>
        {hasSub && isExpanded && (
          <div>
            {item.sub!.map((sub, index) => (
              <div key={sub.label} style={{ display: 'flex', alignItems: 'center' }}>
                <SubItemBreadcrumb isLast={index === item.sub!.length - 1} isActive={matchesRoute(pathname, sub.href)} />
                <Link to={sub.href} style={{ color: matchesRoute(pathname, sub.href) ? 'var(--admin-font-primary)' : 'var(--admin-font-secondary)', textDecoration: 'none' }}>
                  {sub.label}
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <nav>
      {sections.map((section, index) => (
        <div key={section.title || index}>
          {section.title && <div className="nav-section-title">{section.title}</div>}
          {section.items.map(renderItem)}
        </div>
      ))}
    </nav>
  )
}
```

- [ ] **Step 2: Minimal nav data for what exists today**

Create `web/src/navigation/navSections.ts`:
```typescript
import { Shield, Building2 } from 'lucide-react'

export interface NavItem {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  badge?: string
  sub?: NavItem[]
}

export interface NavSection {
  title: string
  items: NavItem[]
}

export const navSections: NavSection[] = [
  {
    title: '',
    items: [
      {
        label: 'System Administration',
        href: '/admin/companies',
        icon: Shield,
        sub: [
          { label: 'Companies', href: '/admin/companies', icon: Building2 },
        ],
      },
    ],
  },
]
```

- [ ] **Step 3: Admin shell layout**

Create `web/src/app/AdminLayout.tsx`:
```tsx
import { Outlet } from 'react-router-dom'
import RoleBasedNav from '../navigation/RoleBasedNav'
import { navSections } from '../navigation/navSections'
import { clearToken } from '../auth/token'
import { useNavigate } from 'react-router-dom'

export default function AdminLayout() {
  const navigate = useNavigate()

  function handleLogout() {
    clearToken()
    navigate('/login')
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside style={{ width: 240, borderRight: '1px solid var(--admin-border-default)' }}>
        <RoleBasedNav sections={navSections} />
        <button onClick={handleLogout}>Log out</button>
      </aside>
      <main style={{ flex: 1, padding: 24 }}>
        <Outlet />
      </main>
    </div>
  )
}
```

- [ ] **Step 4: Wire the layout into the router**

Modify `web/src/app/router.tsx` — replace the placeholder `/admin/companies` route:
```tsx
import { createBrowserRouter } from 'react-router-dom'
import LoginPage from '../auth/LoginPage'
import RequireAuth from './RequireAuth'
import AdminLayout from './AdminLayout'

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AdminLayout />,
        children: [
          // Task 6/7 add the real CompaniesListPage/CompanyDetailPage routes here.
          { path: '/admin/companies', element: <div>Companies list (Task 6)</div> },
        ],
      },
    ],
  },
])
```

- [ ] **Step 5: Verify manually**

`npm run dev`, log in, confirm the sidebar renders with "System Administration" →
"Companies" (nested, matching the legacy visual pattern), and the page content area
shows the placeholder.

- [ ] **Step 6: Commit**

```bash
git add web/src/navigation/ web/src/app/AdminLayout.tsx web/src/app/router.tsx
git commit -m "feat: add admin shell layout and nested nav (scoped to what's built)"
```

---

## Task 6: Frontend — CompaniesListPage

**Files:**
- Create: `web/src/features/org-structure/components/CompanyFilters.tsx`
- Create: `web/src/features/org-structure/components/CompanyList.tsx`
- Create: `web/src/features/org-structure/components/CompanyForm.tsx` (shared by
  create here and edit in Task 7)
- Create: `web/src/features/org-structure/pages/CompaniesListPage.tsx`
- Modify: `web/src/app/router.tsx`

**Interfaces:**
- Consumes: `listCompanies`, `createCompany` (Task 4), `Company`/`CreateCompanyInput`
  types (Task 4).
- Produces: `<CompanyForm>` component, reused as-is by Task 7's edit page (same props
  shape: `initialValues?: Partial<CreateCompanyInput>`, `onSubmit: (input) => Promise<void>`).

- [ ] **Step 1: Filters component**

Create `web/src/features/org-structure/components/CompanyFilters.tsx`:
```tsx
export interface CompanyFiltersValue {
  search: string
}

interface CompanyFiltersProps {
  value: CompanyFiltersValue
  onChange: (value: CompanyFiltersValue) => void
}

export default function CompanyFilters({ value, onChange }: CompanyFiltersProps) {
  return (
    <input
      type="search"
      placeholder="Search by name, domain, or industry"
      value={value.search}
      onChange={(e) => onChange({ search: e.target.value })}
    />
  )
}
```

- [ ] **Step 2: List component**

Create `web/src/features/org-structure/components/CompanyList.tsx`:
```tsx
import { Link } from 'react-router-dom'
import type { Company } from '../api/companies'

export default function CompanyList({ companies }: { companies: Company[] }) {
  if (companies.length === 0) {
    return <p>No companies found.</p>
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Domain</th>
          <th>Industry</th>
          <th>Size</th>
          <th>Country</th>
        </tr>
      </thead>
      <tbody>
        {companies.map((company) => (
          <tr key={company.id}>
            <td><Link to={`/admin/companies/${company.id}`}>{company.name}</Link></td>
            <td>{company.emailDomain}</td>
            <td>{company.industry}</td>
            <td>{company.size}</td>
            <td>{company.country}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

- [ ] **Step 3: Shared create/edit form**

Create `web/src/features/org-structure/components/CompanyForm.tsx`:
```tsx
import { useState, type FormEvent } from 'react'
import { CompanyValidation } from './companyValidation'

export interface CompanyFormValues {
  name: string
  emailDomain: string
  industry: string
  size: string
  country: string
  subscriptionTier: string
}

interface CompanyFormProps {
  initialValues?: Partial<CompanyFormValues>
  submitLabel: string
  onSubmit: (values: CompanyFormValues) => Promise<void>
}

const EMPTY_VALUES: CompanyFormValues = { name: '', emailDomain: '', industry: '', size: '', country: '', subscriptionTier: '' }

export default function CompanyForm({ initialValues, submitLabel, onSubmit }: CompanyFormProps) {
  const [values, setValues] = useState<CompanyFormValues>({ ...EMPTY_VALUES, ...initialValues })
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await onSubmit(values)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <p role="alert">{error}</p>}
      <label>
        Name
        <input value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} required />
      </label>
      <label>
        Domain
        <input value={values.emailDomain} onChange={(e) => setValues({ ...values, emailDomain: e.target.value })} required />
      </label>
      <label>
        Industry
        <input value={values.industry} onChange={(e) => setValues({ ...values, industry: e.target.value })} required />
      </label>
      <label>
        Size
        <select value={values.size} onChange={(e) => setValues({ ...values, size: e.target.value })} required>
          <option value="">Select size</option>
          {CompanyValidation.sizes.map((size) => (
            <option key={size} value={size}>{size}</option>
          ))}
        </select>
      </label>
      <label>
        Country
        <input value={values.country} onChange={(e) => setValues({ ...values, country: e.target.value })} required />
      </label>
      <label>
        Subscription tier
        <select value={values.subscriptionTier} onChange={(e) => setValues({ ...values, subscriptionTier: e.target.value })}>
          <option value="">Default (basic)</option>
          {CompanyValidation.subscriptionTiers.map((tier) => (
            <option key={tier} value={tier}>{tier}</option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={submitting}>{submitting ? 'Saving…' : submitLabel}</button>
    </form>
  )
}
```

Create `web/src/features/org-structure/components/companyValidation.ts` (mirrors the
backend's `CompanyValidation` constants from Task 2, so the dropdowns only ever offer
values the API accepts):
```typescript
export const CompanyValidation = {
  sizes: ['startup', 'small', 'medium', 'large', 'enterprise'],
  subscriptionTiers: ['basic', 'professional', 'enterprise'],
}
```

- [ ] **Step 4: List page**

Create `web/src/features/org-structure/pages/CompaniesListPage.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { listCompanies, createCompany, type Company } from '../api/companies'
import CompanyList from '../components/CompanyList'
import CompanyFilters, { type CompanyFiltersValue } from '../components/CompanyFilters'
import CompanyForm, { type CompanyFormValues } from '../components/CompanyForm'

export default function CompaniesListPage() {
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<CompanyFiltersValue>({ search: '' })
  const [showCreateForm, setShowCreateForm] = useState(false)

  async function reload() {
    setLoading(true)
    const result = await listCompanies(baseUrl)
    setCompanies(result)
    setLoading(false)
  }

  useEffect(() => {
    reload()
  }, [])

  const filtered = companies.filter((company) => {
    const search = filters.search.toLowerCase()
    if (!search) return true
    return (
      company.name.toLowerCase().includes(search)
      || (company.emailDomain?.toLowerCase().includes(search) ?? false)
      || (company.industry?.toLowerCase().includes(search) ?? false)
    )
  })

  async function handleCreate(values: CompanyFormValues) {
    await createCompany(baseUrl, {
      name: values.name,
      emailDomain: values.emailDomain,
      industry: values.industry,
      size: values.size,
      country: values.country,
      subscriptionTier: values.subscriptionTier || undefined,
    })
    setShowCreateForm(false)
    await reload()
  }

  return (
    <div>
      <h1>Companies</h1>
      <CompanyFilters value={filters} onChange={setFilters} />
      <button onClick={() => setShowCreateForm((v) => !v)}>{showCreateForm ? 'Cancel' : 'New company'}</button>
      {showCreateForm && <CompanyForm submitLabel="Create company" onSubmit={handleCreate} />}
      {loading ? <p>Loading…</p> : <CompanyList companies={filtered} />}
    </div>
  )
}
```

- [ ] **Step 5: Wire the route**

Modify `web/src/app/router.tsx` — replace the Task 5 placeholder:
```tsx
{ path: '/admin/companies', element: <CompaniesListPage /> },
```
(add `import CompaniesListPage from '../features/org-structure/pages/CompaniesListPage'`
to the top of the file).

- [ ] **Step 6: Verify manually**

Log in as a super_admin user, confirm the companies list loads, the search filter
narrows results client-side, and "New company" creates one that then appears in the
list.

- [ ] **Step 7: Commit**

```bash
git add web/src/features/org-structure/components/ web/src/features/org-structure/pages/CompaniesListPage.tsx web/src/app/router.tsx
git commit -m "feat: add CompaniesListPage (list, search filter, create)"
```

---

## Task 7: Frontend — CompanyDetailPage + embedded department management

**Files:**
- Create: `web/src/features/org-structure/components/DepartmentList.tsx`
- Create: `web/src/features/org-structure/components/DepartmentForm.tsx`
- Create: `web/src/features/org-structure/pages/CompanyDetailPage.tsx`
- Modify: `web/src/app/router.tsx`

**Interfaces:**
- Consumes: `getCompany`, `updateCompany` (Task 4), `listDepartments`,
  `createDepartment`, `updateDepartment` (Task 4), `CompanyForm` (Task 6, reused
  unchanged for editing).

- [ ] **Step 1: Department list (flat, parent shown by name — no tree UI; the schema
  stores only a single `parentDepartmentId` link, not a materialized path, so this
  slice keeps the display equally flat)**

Create `web/src/features/org-structure/components/DepartmentList.tsx`:
```tsx
import type { Department } from '../api/departments'

export default function DepartmentList({ departments, onEdit }: { departments: Department[]; onEdit: (department: Department) => void }) {
  if (departments.length === 0) {
    return <p>No departments yet.</p>
  }

  const byId = new Map(departments.map((d) => [d.id, d]))

  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Parent</th>
          <th>Active</th>
          <th>Employees</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {departments.map((department) => (
          <tr key={department.id}>
            <td>{department.name}</td>
            <td>{department.parentDepartmentId ? byId.get(department.parentDepartmentId)?.name ?? '—' : '—'}</td>
            <td>{department.isActive ? 'Yes' : 'No'}</td>
            <td>{department.employeeCount}</td>
            <td><button onClick={() => onEdit(department)}>Edit</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

- [ ] **Step 2: Department create/edit form**

Create `web/src/features/org-structure/components/DepartmentForm.tsx`:
```tsx
import { useState, type FormEvent } from 'react'
import type { Department } from '../api/departments'

export interface DepartmentFormValues {
  name: string
  description: string
  parentDepartmentId: string
  isActive: boolean
}

interface DepartmentFormProps {
  departments: Department[]
  initialValues?: Partial<DepartmentFormValues>
  excludeIdFromParentOptions?: string
  submitLabel: string
  onSubmit: (values: DepartmentFormValues) => Promise<void>
}

const EMPTY_VALUES: DepartmentFormValues = { name: '', description: '', parentDepartmentId: '', isActive: true }

export default function DepartmentForm({ departments, initialValues, excludeIdFromParentOptions, submitLabel, onSubmit }: DepartmentFormProps) {
  const [values, setValues] = useState<DepartmentFormValues>({ ...EMPTY_VALUES, ...initialValues })
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const parentOptions = departments.filter((d) => d.id !== excludeIdFromParentOptions)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await onSubmit(values)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <p role="alert">{error}</p>}
      <label>
        Name
        <input value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} required maxLength={100} />
      </label>
      <label>
        Description
        <textarea value={values.description} onChange={(e) => setValues({ ...values, description: e.target.value })} maxLength={500} />
      </label>
      <label>
        Parent department
        <select value={values.parentDepartmentId} onChange={(e) => setValues({ ...values, parentDepartmentId: e.target.value })}>
          <option value="">None (top-level)</option>
          {parentOptions.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </label>
      <label>
        <input type="checkbox" checked={values.isActive} onChange={(e) => setValues({ ...values, isActive: e.target.checked })} />
        Active
      </label>
      <button type="submit" disabled={submitting}>{submitting ? 'Saving…' : submitLabel}</button>
    </form>
  )
}
```

- [ ] **Step 3: Detail page**

Create `web/src/features/org-structure/pages/CompanyDetailPage.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getCompany, updateCompany, type CompanyDetail } from '../api/companies'
import { listDepartments, createDepartment, updateDepartment, type Department } from '../api/departments'
import CompanyForm, { type CompanyFormValues } from '../components/CompanyForm'
import DepartmentList from '../components/DepartmentList'
import DepartmentForm, { type DepartmentFormValues } from '../components/DepartmentForm'

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [company, setCompany] = useState<CompanyDetail | null>(null)
  const [departments, setDepartments] = useState<Department[]>([])
  const [editingCompany, setEditingCompany] = useState(false)
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(null)
  const [creatingDepartment, setCreatingDepartment] = useState(false)

  async function reload() {
    if (!id) return
    const [companyResult, departmentsResult] = await Promise.all([
      getCompany(baseUrl, id),
      listDepartments(baseUrl, id),
    ])
    setCompany(companyResult)
    setDepartments(departmentsResult)
  }

  useEffect(() => {
    reload()
  }, [id])

  if (!company) {
    return <p>Loading…</p>
  }

  async function handleUpdateCompany(values: CompanyFormValues) {
    await updateCompany(baseUrl, id!, values)
    setEditingCompany(false)
    await reload()
  }

  async function handleCreateDepartment(values: DepartmentFormValues) {
    await createDepartment(baseUrl, {
      companyId: id!,
      name: values.name,
      description: values.description || undefined,
      parentDepartmentId: values.parentDepartmentId || undefined,
      isActive: values.isActive,
    })
    setCreatingDepartment(false)
    await reload()
  }

  async function handleUpdateDepartment(values: DepartmentFormValues) {
    await updateDepartment(baseUrl, editingDepartment!.id, {
      name: values.name,
      description: values.description,
      isActive: values.isActive,
    })
    setEditingDepartment(null)
    await reload()
  }

  return (
    <div>
      <h1>{company.name}</h1>
      <p>{company.userCount} active users</p>

      {editingCompany ? (
        <CompanyForm
          submitLabel="Save"
          initialValues={{
            name: company.name,
            emailDomain: company.emailDomain ?? '',
            industry: company.industry ?? '',
            size: company.size ?? '',
            country: company.country ?? '',
            subscriptionTier: company.subscriptionTier ?? '',
          }}
          onSubmit={handleUpdateCompany}
        />
      ) : (
        <button onClick={() => setEditingCompany(true)}>Edit company</button>
      )}

      <h2>Departments</h2>
      <button onClick={() => setCreatingDepartment((v) => !v)}>{creatingDepartment ? 'Cancel' : 'New department'}</button>
      {creatingDepartment && <DepartmentForm departments={departments} submitLabel="Create department" onSubmit={handleCreateDepartment} />}

      {editingDepartment && (
        <DepartmentForm
          departments={departments}
          excludeIdFromParentOptions={editingDepartment.id}
          submitLabel="Save department"
          initialValues={{
            name: editingDepartment.name,
            description: editingDepartment.description ?? '',
            parentDepartmentId: editingDepartment.parentDepartmentId ?? '',
            isActive: editingDepartment.isActive,
          }}
          onSubmit={handleUpdateDepartment}
        />
      )}

      <DepartmentList departments={departments} onEdit={setEditingDepartment} />
    </div>
  )
}
```

- [ ] **Step 4: Wire the route**

Modify `web/src/app/router.tsx` — add, as a sibling of the `/admin/companies` route
inside `AdminLayout`'s `children`:
```tsx
{ path: '/admin/companies/:id', element: <CompanyDetailPage /> },
```
(add `import CompanyDetailPage from '../features/org-structure/pages/CompanyDetailPage'`).

- [ ] **Step 5: Verify manually**

Click into a company from the list, confirm the detail page loads with its user
count, edit the company (confirm the list reflects the rename on navigating back),
create a department, create a second department with the first as its parent, and
confirm the parent name renders correctly in the list.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/org-structure/components/DepartmentList.tsx \
        web/src/features/org-structure/components/DepartmentForm.tsx \
        web/src/features/org-structure/pages/CompanyDetailPage.tsx \
        web/src/app/router.tsx
git commit -m "feat: add CompanyDetailPage with embedded department management"
```
