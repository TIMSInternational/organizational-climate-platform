# Monorepo Frontend Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn this repo into the single monorepo home for both the organizational climate platform's React frontend and its .NET 10 backend, matching the FormMaps pattern (Vercel for the frontend, AWS App Runner for the backend, Supabase for Postgres), and rename the repo to `organizational-climate-platform` to reflect that.

**Architecture:** A new `web/` directory (React + Vite + TypeScript, scaffolded from scratch — no existing frontend to migrate) sits alongside the existing `src/` .NET solution. The two halves deploy independently and never share a runtime: Vercel builds/deploys `web/` on every push (bypassing the currently-billing-blocked GitHub Actions entirely), while App Runner continues serving `src/ClimateProject.Api` exactly as it does today. Cross-origin calls from the Vercel-hosted frontend to the App Runner API are permitted via an explicit CORS allowlist (exact production origin + a wildcard pattern for Vercel preview deployments), since auth is JWT-bearer-in-header and needs no cookie/SameSite handling.

**Tech Stack:** .NET 10 / ASP.NET Core minimal APIs (unchanged), EF Core + Npgsql (unchanged), React 18 + Vite + TypeScript (new), Vitest (new, frontend unit tests), xUnit (unchanged, backend tests), AWS CloudFormation + App Runner + Secrets Manager, Vercel, Supabase (managed Postgres).

## Global Constraints

- .NET SDK is pinned via `global.json` to `10.0.100` (`rollForward: latestFeature`) — do not change.
- All existing NuGet packages are pinned to `10.0.0` (ASP.NET Core / EF Core) or their current exact versions — do not upgrade or downgrade any of them as part of this work.
- Use Node.js 20 LTS or newer for everything under `web/` (required by current Vite).
- Do not modify `.github/workflows/ci.yml` or `.github/workflows/deploy-prod.yml` — both are .NET-only and unaffected by this work; that's a deliberate, explicit exclusion, not an oversight.
- Local development and the integration test suite (`ClimateProject.IntegrationTests`, Testcontainers) must keep using the existing `docker-compose` Postgres. Never point them at the Supabase database.
- Do not rename any AWS resource (ECR repository, IAM role names, App Runner service name) — they are already-live production identifiers. Only the `GitHubRepository` parameter (used in the OIDC trust condition) changes.
- Auth stays JWT-bearer-in-`Authorization`-header. Do not introduce cookie-based auth or credentialed CORS (`AllowCredentials`) as part of this work — none of it is needed for bearer-token auth.
- Out of scope, do not add tasks for: any actual frontend feature/screen implementation (tracked separately as issue #57), and the 3 FK-semantics bugs / other findings from the `#49` domain-schema final review (tracked in project memory, separate cleanup after this work is verified).

---

## Task 1: Rename the GitHub repo and update the OIDC trust condition

**Files:**
- Modify: `infra/aws/climate-project-api-bootstrap.yml:8` (the `GitHubRepository` parameter's `Default`)
- Modify: `README.md` (title, description, any `climate-project-api` GitHub URL references)
- Modify: local `.git/config` (via `git remote set-url`, not a tracked file)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: the repo is now reachable at `TIMSInternational/organizational-climate-platform` (GitHub auto-forwards the old URL); the `GitHubDeployRole`'s OIDC trust condition matches the new name, so any *future* GitHub Actions run (once the billing block clears) can still authenticate. All later tasks push to this renamed repo.

- [ ] **Step 1: Rename the repo on GitHub**

Run:
```bash
gh repo rename organizational-climate-platform --repo TIMSInternational/climate-project-api
```
Expected: command succeeds and prints the new URL, `https://github.com/TIMSInternational/organizational-climate-platform`.

- [ ] **Step 2: Point the local clone at the new URL**

Run:
```bash
git remote set-url origin https://github.com/TIMSInternational/organizational-climate-platform.git
git remote -v
```
Expected: both `fetch` and `push` lines show the new URL.

- [ ] **Step 3: Update the bootstrap CloudFormation template's `GitHubRepository` default**

In `infra/aws/climate-project-api-bootstrap.yml`, change:
```yaml
  GitHubRepository:
    Type: String
    Default: TIMSInternational/climate-project-api
    Description: GitHub owner/repository allowed to assume the deploy role.
```
to:
```yaml
  GitHubRepository:
    Type: String
    Default: TIMSInternational/organizational-climate-platform
    Description: GitHub owner/repository allowed to assume the deploy role.
```

- [ ] **Step 4: Redeploy the bootstrap stack with the updated parameter**

Run:
```bash
aws cloudformation deploy \
  --stack-name climate-project-api-bootstrap \
  --template-file infra/aws/climate-project-api-bootstrap.yml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    GitHubRepository=TIMSInternational/organizational-climate-platform \
    GitHubBranch=main
```
Expected: `Successfully created/updated stack`.

- [ ] **Step 5: Verify the trust policy actually changed**

Run:
```bash
aws iam get-role --role-name climate-project-github-deploy-prod \
  --query 'Role.AssumeRolePolicyDocument' --output json
```
Expected: the `StringLike` condition's values contain `repo:TIMSInternational/organizational-climate-platform:...` and no longer contain `climate-project-api`.

- [ ] **Step 6: Update README.md**

Update the title and first paragraph of `README.md` to reflect the new name and the fact that this is now a monorepo, e.g.:
```markdown
# organizational-climate-platform

Monorepo for the organizational climate platform: `web/` (React + Vite frontend) and
`src/` (.NET 10 backend) — the migration target for the legacy Next.js/MongoDB stack at
[climate-project](https://github.com/TIMSInternational/climate-project). See
[climate-project#17](https://github.com/TIMSInternational/climate-project/issues/17) for the
full migration epic.
```

- [ ] **Step 7: Commit**

```bash
git add infra/aws/climate-project-api-bootstrap.yml README.md
git commit -m "chore: rename repo to organizational-climate-platform, update OIDC trust condition"
```

---

## Task 2: Scaffold the `web/` frontend

**Files:**
- Create: `web/` (entire Vite scaffold: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/App.css`, `src/index.css`, `public/`)
- Modify: `.gitignore` (root) — add frontend build artifacts
- Modify: `README.md` — add the `web/` local-dev instructions

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: a `web/` directory that builds and runs, which Task 3 adds a health-check client to, and Task 5 points Vercel at.

- [ ] **Step 1: Scaffold the app**

Run from the repo root:
```bash
npm create vite@latest web -- --template react-ts
cd web
npm install
```

- [ ] **Step 2: Verify it builds and runs**

Run:
```bash
npm run build
```
Expected: `dist/` is produced with no errors.

```bash
npm run dev
```
Expected: Vite prints `Local: http://localhost:5173/`; visiting it shows the default Vite+React starter page. Stop the dev server (Ctrl+C) once confirmed.

- [ ] **Step 3: Add environment variable plumbing**

Create `web/.env.example`:
```
VITE_API_BASE_URL=http://localhost:5080
```

Create `web/.env.development` (this one is gitignored, but ship it locally so `npm run dev` works out of the box for anyone who copies `.env.example`):
```
VITE_API_BASE_URL=http://localhost:5080
```

- [ ] **Step 4: Update root `.gitignore`**

Add to `.gitignore`:
```
node_modules/
dist/
```
(Both are directory-name patterns with no leading slash, so they also correctly ignore `web/node_modules/` and `web/dist/` without needing `web/`-prefixed entries.)

- [ ] **Step 5: Update README's "Running locally" section**

Append to `README.md`, after the existing `curl http://localhost:5080/health` line:
```markdown
### Frontend (`web/`)

```bash
cd web
npm install
cp .env.example .env.development   # if not already present
npm run dev
```

Requires the API (above) running on `http://localhost:5080` — `web/.env.development` points at it via `VITE_API_BASE_URL`.
```

- [ ] **Step 6: Commit**

```bash
git add web/ .gitignore README.md
git commit -m "feat: scaffold web/ React+Vite+TypeScript frontend"
```

---

## Task 3: Add a health-check API client to `web/` (proves frontend↔backend connectivity)

**Files:**
- Create: `web/src/api/health.ts`
- Create: `web/src/api/health.test.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/package.json` (add `vitest` devDependency + `test` script)
- Modify: `web/vite.config.ts` (add Vitest config block)

**Interfaces:**
- Consumes: `VITE_API_BASE_URL` env var from Task 2.
- Produces: `getHealth(): Promise<HealthResponse>` — a typed export other frontend code (added in future, out-of-scope work) can reuse as the pattern for calling the API.

- [ ] **Step 1: Add Vitest**

```bash
cd web
npm install -D vitest
```

- [ ] **Step 2: Configure Vitest in `vite.config.ts`**

```typescript
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
  },
})
```

Add to `web/package.json` scripts:
```json
"test": "vitest run"
```

- [ ] **Step 3: Write the failing test**

Create `web/src/api/health.test.ts`:
```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'
import { getHealth } from './health'

describe('getHealth', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the parsed health response on a 200', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ service: 'climate-project-api', status: 'ok' }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await getHealth('http://localhost:5080')

    expect(result).toEqual({ service: 'climate-project-api', status: 'ok' })
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:5080/health')
  })

  it('throws when the response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503 }),
    )

    await expect(getHealth('http://localhost:5080')).rejects.toThrow('Health check failed: 503')
  })
})
```

- [ ] **Step 4: Run it to verify it fails**

```bash
npx vitest run src/api/health.test.ts
```
Expected: FAIL — `Cannot find module './health'` (the file doesn't exist yet).

- [ ] **Step 5: Implement `getHealth`**

Create `web/src/api/health.ts`:
```typescript
export interface HealthResponse {
  service: string
  status: string
}

export async function getHealth(baseUrl: string): Promise<HealthResponse> {
  const response = await fetch(`${baseUrl}/health`)

  if (!response.ok) {
    throw new Error(`Health check failed: ${response.status}`)
  }

  return response.json() as Promise<HealthResponse>
}
```

- [ ] **Step 6: Run it to verify it passes**

```bash
npx vitest run src/api/health.test.ts
```
Expected: PASS, 2 tests.

- [ ] **Step 7: Wire it into `App.tsx`**

Replace the contents of `web/src/App.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { getHealth } from './api/health'
import './App.css'

function App() {
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')

  useEffect(() => {
    const baseUrl = import.meta.env.VITE_API_BASE_URL as string
    getHealth(baseUrl)
      .then(() => setStatus('ok'))
      .catch(() => setStatus('error'))
  }, [])

  return (
    <div className="App">
      <h1>Organizational Climate Platform</h1>
      <p>API status: {status}</p>
    </div>
  )
}

export default App
```

- [ ] **Step 8: Manually verify end to end**

With the API running (`dotnet run --project src/ClimateProject.Api`, from Task 2's README instructions) and `npm run dev` running in `web/`, visit `http://localhost:5173`. Expected: page renders `API status: ok`.

- [ ] **Step 9: Commit**

```bash
git add web/src/api/health.ts web/src/api/health.test.ts web/src/App.tsx web/package.json web/vite.config.ts web/package-lock.json
git commit -m "feat: add health-check API client to web/, proving frontend-backend connectivity"
```

---

## Task 4: Add a CORS policy to the API

**Files:**
- Create: `src/ClimateProject.Application/Cors/CorsOriginMatcher.cs`
- Create: `tests/ClimateProject.UnitTests/Cors/CorsOriginMatcherTests.cs`
- Create: `tests/ClimateProject.IntegrationTests/CorsPolicyTests.cs`
- Modify: `src/ClimateProject.Api/Program.cs`
- Modify: `src/ClimateProject.Api/appsettings.json`
- Modify: `src/ClimateProject.Api/appsettings.Development.json`

**Interfaces:**
- Consumes: nothing from other tasks (independent of `web/`).
- Produces: `CorsOriginMatcher(IEnumerable<string> exactOrigins, IEnumerable<string> wildcardOrigins).IsAllowed(string origin): bool` — used by `Program.cs`'s `"Frontend"` CORS policy. Task 5 sets the real production origin values via App Runner runtime env vars (`Cors:AllowedOrigins`, `Cors:AllowedWildcardOrigins`), which this task's config-binding code already reads.

- [ ] **Step 1: Write the failing unit test for the matcher**

Create `tests/ClimateProject.UnitTests/Cors/CorsOriginMatcherTests.cs`:
```csharp
using ClimateProject.Application.Cors;

namespace ClimateProject.UnitTests.Cors;

public class CorsOriginMatcherTests
{
    [Fact]
    public void IsAllowed_returns_true_for_exact_origin_match()
    {
        var matcher = new CorsOriginMatcher(
            exactOrigins: ["http://localhost:5173"],
            wildcardOrigins: []);

        Assert.True(matcher.IsAllowed("http://localhost:5173"));
    }

    [Fact]
    public void IsAllowed_returns_false_for_unlisted_origin()
    {
        var matcher = new CorsOriginMatcher(
            exactOrigins: ["http://localhost:5173"],
            wildcardOrigins: []);

        Assert.False(matcher.IsAllowed("https://evil.example.com"));
    }

    [Fact]
    public void IsAllowed_returns_true_for_wildcard_subdomain_match()
    {
        var matcher = new CorsOriginMatcher(
            exactOrigins: [],
            wildcardOrigins: ["https://*.vercel.app"]);

        Assert.True(matcher.IsAllowed("https://organizational-climate-platform-git-main-fedes-projects.vercel.app"));
    }

    [Fact]
    public void IsAllowed_returns_false_for_near_miss_wildcard_suffix()
    {
        var matcher = new CorsOriginMatcher(
            exactOrigins: [],
            wildcardOrigins: ["https://*.vercel.app"]);

        // "notvercel.app" ends with "vercel.app" but NOT ".vercel.app" -- must not match.
        Assert.False(matcher.IsAllowed("https://notvercel.app"));
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

```bash
dotnet test tests/ClimateProject.UnitTests --filter CorsOriginMatcherTests
```
Expected: FAIL to compile — `ClimateProject.Application.Cors` namespace doesn't exist yet.

- [ ] **Step 3: Implement `CorsOriginMatcher`**

Create `src/ClimateProject.Application/Cors/CorsOriginMatcher.cs`:
```csharp
namespace ClimateProject.Application.Cors;

public sealed class CorsOriginMatcher
{
    private readonly IReadOnlyCollection<string> _exactOrigins;
    private readonly IReadOnlyList<(string Prefix, string Suffix)> _wildcardPatterns;

    public CorsOriginMatcher(IEnumerable<string> exactOrigins, IEnumerable<string> wildcardOrigins)
    {
        _exactOrigins = exactOrigins.ToArray();
        _wildcardPatterns = wildcardOrigins
            .Select(pattern =>
            {
                var starIndex = pattern.IndexOf('*');
                if (starIndex < 0)
                {
                    throw new ArgumentException(
                        $"Wildcard origin pattern '{pattern}' must contain '*'.",
                        nameof(wildcardOrigins));
                }

                return (Prefix: pattern[..starIndex], Suffix: pattern[(starIndex + 1)..]);
            })
            .ToList();
    }

    public bool IsAllowed(string origin)
    {
        if (_exactOrigins.Contains(origin, StringComparer.OrdinalIgnoreCase))
        {
            return true;
        }

        return _wildcardPatterns.Any(pattern =>
            origin.StartsWith(pattern.Prefix, StringComparison.OrdinalIgnoreCase)
            && origin.EndsWith(pattern.Suffix, StringComparison.OrdinalIgnoreCase));
    }
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
dotnet test tests/ClimateProject.UnitTests --filter CorsOriginMatcherTests
```
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing integration test**

Create `tests/ClimateProject.IntegrationTests/CorsPolicyTests.cs`:
```csharp
using System.Net;
using ClimateProject.IntegrationTests.Support;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace ClimateProject.IntegrationTests;

public class CorsPolicyTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public CorsPolicyTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["TrackingJwtSecret"] = AuthWebApplicationFactory.TestJwtSecret,
                    ["Cors:AllowedOrigins:0"] = "https://allowed.example.com",
                });
            });
        });
    }

    [Fact]
    public async Task Allowed_origin_receives_access_control_allow_origin_header()
    {
        var client = _factory.CreateClient();
        var request = new HttpRequestMessage(HttpMethod.Get, "/health");
        request.Headers.Add("Origin", "https://allowed.example.com");

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(response.Headers.TryGetValues("Access-Control-Allow-Origin", out var values));
        Assert.Equal("https://allowed.example.com", values!.Single());
    }

    [Fact]
    public async Task Disallowed_origin_does_not_receive_access_control_allow_origin_header()
    {
        var client = _factory.CreateClient();
        var request = new HttpRequestMessage(HttpMethod.Get, "/health");
        request.Headers.Add("Origin", "https://not-allowed.example.com");

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.False(response.Headers.Contains("Access-Control-Allow-Origin"));
    }
}
```

- [ ] **Step 6: Run it to verify it fails**

```bash
dotnet test tests/ClimateProject.IntegrationTests --filter CorsPolicyTests
```
Expected: FAIL — both tests fail because no CORS policy exists yet (no `Access-Control-Allow-Origin` header on either response).

- [ ] **Step 7: Add the `Cors` config section to appsettings**

In `src/ClimateProject.Api/appsettings.json`, add (alongside the existing top-level keys):
```json
  "Cors": {
    "AllowedOrigins": [],
    "AllowedWildcardOrigins": []
  },
```

In `src/ClimateProject.Api/appsettings.Development.json`, add:
```json
  "Cors": {
    "AllowedOrigins": ["http://localhost:5173"]
  },
```

- [ ] **Step 8: Wire the CORS policy into `Program.cs`**

Add to the `using` block at the top of `src/ClimateProject.Api/Program.cs`:
```csharp
using ClimateProject.Application.Cors;
using Microsoft.AspNetCore.Cors.Infrastructure;
```

Add, right after the `builder.Services.AddAuthorization();` line (line 69):
```csharp
builder.Services.AddCors();
builder.Services.AddOptions<CorsOptions>()
    .Configure<IConfiguration>((options, configuration) =>
    {
        var allowedOrigins = configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
        var allowedWildcardOrigins = configuration.GetSection("Cors:AllowedWildcardOrigins").Get<string[]>() ?? [];
        var matcher = new CorsOriginMatcher(allowedOrigins, allowedWildcardOrigins);

        options.AddPolicy("Frontend", policy => policy
            .SetIsOriginAllowed(matcher.IsAllowed)
            .AllowAnyHeader()
            .AllowAnyMethod());
    });
```
(This mirrors the existing `AddOptions<JwtBearerOptions>().Configure<IConfiguration>(...)` pattern a few lines above it, for the same reason: reading `IConfiguration` from DI at options-binding time — not eagerly off `builder.Configuration` — means `WebApplicationFactory` test overrides are correctly picked up. See the comment above the `JwtBearerOptions` configuration for the full reasoning.)

Add `app.UseCors("Frontend");` immediately after `var app = builder.Build();` (line 77) and before `app.UseAuthentication();`:
```csharp
var app = builder.Build();

app.UseCors("Frontend");
app.UseAuthentication();
app.UseAuthorization();
```

- [ ] **Step 9: Run the integration tests again to verify they pass**

```bash
dotnet test tests/ClimateProject.IntegrationTests --filter CorsPolicyTests
```
Expected: PASS, 2 tests.

- [ ] **Step 10: Run the full test suite to check for regressions**

```bash
dotnet test ClimateProject.slnx
```
Expected: all tests pass (same count as before this task, plus the 4 new unit tests and 2 new integration tests).

- [ ] **Step 11: Commit**

```bash
git add src/ClimateProject.Application/Cors/CorsOriginMatcher.cs \
        tests/ClimateProject.UnitTests/Cors/CorsOriginMatcherTests.cs \
        tests/ClimateProject.IntegrationTests/CorsPolicyTests.cs \
        src/ClimateProject.Api/Program.cs \
        src/ClimateProject.Api/appsettings.json \
        src/ClimateProject.Api/appsettings.Development.json
git commit -m "feat: add CORS policy for cross-origin frontend access"
```

---

## Task 5: Connect Vercel and wire production CORS origins

**Files:**
- Modify: `infra/aws/climate-project-api-prod-service.yml` (add `CorsAllowedOrigin` / `CorsAllowedWildcardOrigin` parameters, wire into `RuntimeEnvironmentVariables`)
- Modify: `README.md` (document the Vercel project + production URLs)

**Interfaces:**
- Consumes: `web/` from Task 2/3, `Cors:AllowedOrigins` / `Cors:AllowedWildcardOrigins` config keys from Task 4.
- Produces: a live Vercel deployment of `web/`, and an App Runner service that accepts cross-origin requests from it.

- [ ] **Step 1: Finish the Vercel project setup**

In the Vercel dashboard, for the project connected to `TIMSInternational/organizational-climate-platform`:
- Set **Root Directory** to `web` (not `./`).
- Set **Framework Preset** to `Vite` (should auto-detect once Root Directory is set).
- Under **Environment Variables**, add `VITE_API_BASE_URL` = `https://bhgrdkd4gt.us-east-1.awsapprunner.com` for both the **Production** and **Preview** environments (there is only one backend environment right now, so both point at the same App Runner URL).
- Deploy.

- [ ] **Step 2: Record the real Vercel domains**

From the Vercel project's **Settings → Domains**, note:
- The production domain, e.g. `https://organizational-climate-platform.vercel.app`.
- The preview-deployment domain pattern shown for this project (Vercel shows the team-scoped pattern, e.g. `https://organizational-climate-platform-*-<team-slug>.vercel.app`).

- [ ] **Step 3: Add CORS origin parameters to the App Runner service template**

In `infra/aws/climate-project-api-prod-service.yml`, add two new `Parameters`:
```yaml
  CorsAllowedOrigin:
    Type: String
    Description: Exact production frontend origin allowed by CORS.
  CorsAllowedWildcardOrigin:
    Type: String
    Description: Wildcard-pattern frontend origin allowed by CORS (Vercel preview deployments).
```

Add two entries to the existing `RuntimeEnvironmentVariables` list (inside `ImageConfiguration`):
```yaml
              - Name: Cors__AllowedOrigins__0
                Value: !Ref CorsAllowedOrigin
              - Name: Cors__AllowedWildcardOrigins__0
                Value: !Ref CorsAllowedWildcardOrigin
```

- [ ] **Step 4: Redeploy the service stack with the real values**

Run (substituting the real domains recorded in Step 2):
```bash
aws cloudformation deploy \
  --stack-name climate-project-api-prod \
  --template-file infra/aws/climate-project-api-prod-service.yml \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    ServiceName=climate-project-api-prod \
    ImageIdentifier=<current-live-image-uri> \
    EcrAccessRoleArn=<AppRunnerEcrAccessRoleArn-from-bootstrap-outputs> \
    CorsAllowedOrigin=https://organizational-climate-platform.vercel.app \
    CorsAllowedWildcardOrigin='https://organizational-climate-platform-*-<team-slug>.vercel.app'
```
(`ImageIdentifier` and `EcrAccessRoleArn` are the same values already used for the currently-live deployment — read them the same way the existing manual-deploy runbook in `infra/aws/README.md` does, via `aws cloudformation describe-stacks` against the bootstrap and prod stacks.)

- [ ] **Step 5: Verify CORS headers are returned for the real production origin**

```bash
curl -sI -H "Origin: https://organizational-climate-platform.vercel.app" \
  https://bhgrdkd4gt.us-east-1.awsapprunner.com/health | grep -i access-control-allow-origin
```
Expected: `Access-Control-Allow-Origin: https://organizational-climate-platform.vercel.app`.

- [ ] **Step 6: Verify end to end in the browser**

Open the production Vercel URL. Expected: page renders `API status: ok` (same check as Task 3 Step 8, now running against the real deployed frontend and backend, cross-origin).

- [ ] **Step 7: Update README**

Add a "Deployments" section to `README.md` noting the live frontend URL, the live API URL (already documented), and that Vercel deploys `web/` independently of GitHub Actions.

- [ ] **Step 8: Commit**

```bash
git add infra/aws/climate-project-api-prod-service.yml README.md
git commit -m "feat: wire production CORS origins for Vercel-hosted frontend"
```

---

## Task 6: Provision Supabase and point production at it

**Files:**
- Modify: `infra/aws/climate-project-api-prod-service.yml` (add `DatabaseConnectionStringSecretArn` parameter, `RuntimeEnvironmentSecrets`, and a Secrets Manager read permission on `AppRunnerInstanceRole`)
- Modify: `README.md` (document that prod uses Supabase, local/tests do not)

**Interfaces:**
- Consumes: nothing from other tasks (independent of `web/`/Vercel/CORS work).
- Produces: the live App Runner service's `ConnectionStrings:ClimateProject` points at a real Supabase Postgres instance instead of never having been set to anything beyond local Docker Postgres.

- [ ] **Step 1: Create the Supabase project**

Via the Supabase dashboard (or `supabase projects create`), create a new project for this product, in a region close to `us-east-1` (App Runner's region). Set a strong database password when prompted; store it in a password manager.

- [ ] **Step 2: Get the pooled connection string**

From the Supabase project's **Settings → Database → Connection string**, copy the **URI** format connection string using the **Transaction** pooler mode (port `6543`) — this is the right mode for a container workload that opens/closes connections per request rather than holding long-lived ones.

- [ ] **Step 3: Store the connection string in AWS Secrets Manager**

```bash
aws secretsmanager create-secret \
  --name climate-project-api/prod/database-connection-string \
  --secret-string "<the-supabase-connection-string-from-step-2>"
```
Expected: output includes the new secret's ARN — record it.

- [ ] **Step 4: Add the secret wiring to the service template**

In `infra/aws/climate-project-api-prod-service.yml`, add a new `Parameters` entry:
```yaml
  DatabaseConnectionStringSecretArn:
    Type: String
    Description: Secrets Manager ARN holding the Supabase Postgres connection string.
```

Add a `RuntimeEnvironmentSecrets` block inside `ImageConfiguration` (a sibling of the existing `RuntimeEnvironmentVariables`):
```yaml
            RuntimeEnvironmentSecrets:
              - Name: ConnectionStrings__ClimateProject
                Value: !Ref DatabaseConnectionStringSecretArn
```

Add a `Policies` block to the existing `AppRunnerInstanceRole` resource (so the running container is allowed to read the secret — `RuntimeEnvironmentSecrets` are fetched using the *instance* role, not the ECR access role):
```yaml
      Policies:
        - PolicyName: read-database-secret
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              - Effect: Allow
                Action: secretsmanager:GetSecretValue
                Resource: !Ref DatabaseConnectionStringSecretArn
```

- [ ] **Step 5: Apply EF Core migrations against the new Supabase database**

Run locally, once (there's no CI/CD path that can do this automatically while GitHub Actions remains billing-blocked):
```bash
dotnet ef database update \
  --project src/ClimateProject.Infrastructure \
  --startup-project src/ClimateProject.Api \
  --connection "<the-supabase-connection-string-from-step-2>"
```
Expected: all 30 existing migrations apply cleanly, ending with `Done.`

- [ ] **Step 6: Redeploy the service stack with the new secret parameter**

```bash
aws cloudformation deploy \
  --stack-name climate-project-api-prod \
  --template-file infra/aws/climate-project-api-prod-service.yml \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    ServiceName=climate-project-api-prod \
    ImageIdentifier=<current-live-image-uri> \
    EcrAccessRoleArn=<AppRunnerEcrAccessRoleArn-from-bootstrap-outputs> \
    CorsAllowedOrigin=https://organizational-climate-platform.vercel.app \
    CorsAllowedWildcardOrigin='https://organizational-climate-platform-*-<team-slug>.vercel.app' \
    DatabaseConnectionStringSecretArn=<the-secret-arn-from-step-3>
```

- [ ] **Step 7: Verify the API is actually using the Supabase database**

```bash
curl -s https://bhgrdkd4gt.us-east-1.awsapprunner.com/health
```
Expected: `{"service":"climate-project-api","status":"ok"}` (proves the container started successfully with the new config — a bad connection string would crash the app on the DB-touching first request, though `/health` itself doesn't query the DB).

```bash
curl -s -X POST https://bhgrdkd4gt.us-east-1.awsapprunner.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"nobody@example.com","password":"wrong-password"}'
```
Expected: HTTP `401 Unauthorized` (not a `500` DB-connection error) — a 401 proves the API successfully queried the `users` table in Supabase and correctly found no match, rather than failing to connect at all.

- [ ] **Step 8: Update README**

Note in `README.md`'s "Running locally" section that production uses Supabase-hosted Postgres while local dev and the test suite use the `docker-compose` Postgres — link to this plan or the design doc for the full rationale.

- [ ] **Step 9: Commit**

```bash
git add infra/aws/climate-project-api-prod-service.yml README.md
git commit -m "feat: provision Supabase Postgres for production, wire via Secrets Manager"
```
