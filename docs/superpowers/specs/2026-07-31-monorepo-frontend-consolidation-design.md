# Monorepo frontend consolidation — design

## Context

`climate-project-api` was scaffolded as a backend-only .NET 10 API (issue #47), following the
original epic #17 plan of mirroring sibling products' split-repo pattern
(`{product}-api` + `{product}-web`). That split never actually happened in practice for the
closest sibling, FormMaps: `TIMSInternational/formmaps` is a single monorepo
(`apps/web` React/Next.js + `services/api` .NET 10 + `infra/aws`), with the frontend on Vercel
and the backend on AWS App Runner, both deployed from the same repo. No `formmaps-web` /
`tims-ats-web` repo is actually in use.

Decision: follow the FormMaps pattern instead of the original split-repo plan. This repo becomes
the single home for both the frontend and backend of the organizational climate platform, and is
renamed to reflect that.

As of this writing, the repo has zero frontend code of any kind (no `-web` repo exists either) —
this is a green-field addition, not a migration of existing frontend code.

## Repo rename

`TIMSInternational/climate-project-api` → `TIMSInternational/organizational-climate-platform`
(matches the product's actual name, already used as the `package.json` "name" in the legacy
Next.js repo).

AWS resource names (ECR repository, IAM role names, App Runner service name) are already-live
production identifiers and are **not** renamed. Only the `GitHubDeployRole` OIDC trust
condition's `GitHubRepository` parameter (in `infra/aws/climate-project-api-bootstrap.yml`) needs
updating to the new repo name, since GitHub Actions' OIDC token `sub` claim is checked against it.
The bootstrap stack must be redeployed after this change for future GitHub Actions-driven deploys
to authenticate — not an immediate blocker, since GitHub Actions deploys are currently unusable
anyway (see Known limitations below).

## Repo layout

```
organizational-climate-platform/
├── src/              # .NET 10 solution — unchanged (Domain/Application/Infrastructure/Workers/Api)
├── tests/            # unchanged
├── web/              # NEW — React + Vite + TypeScript frontend
├── infra/aws/        # unchanged — App Runner CloudFormation for the API
├── docker-compose.yml
└── ClimateProject.slnx
```

## Frontend deployment — Vercel

- Connect Vercel directly to this GitHub repo (post-rename).
- **Root Directory: `web/`** — Vercel builds/deploys only this subdirectory; it never touches the
  .NET solution.
- Framework preset: Vite (auto-detected).
- Preview deployments on every PR (Vercel Hobby tier, free).
- Env var `VITE_API_BASE_URL` points at the App Runner base URL — set per Vercel environment
  (production vs. preview).
- Deploys trigger on git push, independent of GitHub Actions. This is a deliberate property, not
  incidental: GitHub Actions is currently billing-blocked account-wide
  (`climate-project-api#5`), so keeping the frontend's deploy path off GitHub Actions entirely
  means that blocker never touches frontend releases.

## Backend deployment — AWS App Runner

Unchanged. `infra/aws/climate-project-api-prod-service.yml` and the existing manual-deploy
runbook (documented in `infra/aws/README.md`) continue to apply as-is. The only change here is
updating the `GitHubRepository` parameter on the bootstrap stack per the rename above.

## Database — Supabase

Epic #17 decided in principle to use Supabase-hosted Postgres, but this was never actually
provisioned — the repo currently only has a local `docker-compose` Postgres instance, and
`ConnectionStrings:ClimateProject` has never pointed anywhere else.

- **Staging/prod**: provision an actual Supabase project; App Runner's runtime environment
  variables supply the Supabase Postgres connection string via `ConnectionStrings:ClimateProject`.
  No code change is required — the API uses plain `Npgsql`/EF Core already, no Supabase-specific
  SDK.
- **Local dev and the integration test suite**: keep the existing `docker-compose`/Testcontainers
  Postgres. Do not point tests or local dev at the hosted Supabase project — this avoids consuming
  Supabase quota on every test run and avoids requiring network access to run tests.

## Cross-origin (CORS)

With the frontend (Vercel) and backend (App Runner) now on different origins, ASP.NET Core needs
an explicit CORS policy allowlisting the Vercel domain(s) — production domain plus the
preview-deployment domain pattern. Auth is JWT-bearer-in-`Authorization`-header (confirmed in
`Program.cs` — `AddJwtBearer`, no cookie-based auth), so this is a plain CORS allowlist with no
`SameSite`/credentialed-cookie complications.

## Local development

Two processes, same as FormMaps:
- `dotnet run --project src/ClimateProject.Api` (unchanged)
- `npm run dev` inside `web/`, a Vite dev server, calling the local API directly via
  `VITE_API_BASE_URL=http://localhost:5080`

No reverse proxy or dev-time gateway needed.

## CI/CD

- Existing `.github/workflows/ci.yml` and `deploy-prod.yml` (GitHub Actions, .NET-only) are
  unchanged.
- No new GitHub Actions workflow is added for the frontend — Vercel's own build/deploy pipeline
  handles it entirely, outside GitHub Actions.

## Known limitations (unchanged by this design)

- GitHub Actions remains billing-blocked account-wide (`climate-project-api#5`). This still blocks
  automated CI *and* the automated deploy path for the .NET API. The manual-deploy runbook in
  `infra/aws/README.md` remains the working path until that's resolved. This design does not fix
  that blocker — it only ensures the new frontend half is never affected by it.
- The Supabase project itself does not exist yet; provisioning it is implementation work, not part
  of this design decision.

## Out of scope

- Any actual frontend feature/screen work (issue #57, "cross-cutting frontend") — this design only
  covers where the frontend lives and how it deploys, not what it contains.
- The three FK-semantics bugs and other findings from the #49 final review (see project memory
  `project_49_remaining_domains_complete`) — tracked separately, not part of this design.
