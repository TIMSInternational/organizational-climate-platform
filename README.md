# organizational-climate-platform

Monorepo for the organizational climate platform: `web/` (React + Vite frontend) and
`src/` (.NET 10 backend) — the migration target for the legacy Next.js/MongoDB stack at
[climate-project](https://github.com/TIMSInternational/climate-project). See
[climate-project#17](https://github.com/TIMSInternational/climate-project/issues/17) for the
full migration epic and [#47](https://github.com/TIMSInternational/climate-project/issues/47)
for this repo's foundation-scaffold spec.

## Solution structure

- `src/ClimateProject.Domain` — entities, no dependencies.
- `src/ClimateProject.Application` — use cases, authorization policies.
- `src/ClimateProject.Infrastructure` — EF Core, external clients.
- `src/ClimateProject.Workers` — background jobs (notifications, scheduled tasks).
- `src/ClimateProject.Api` — ASP.NET Core minimal API host.
- `tests/ClimateProject.UnitTests`, `tests/ClimateProject.IntegrationTests`.

## Running locally

Requires a local Postgres instance and a `TrackingJwtSecret` value (the auth
endpoints won't start without one).

```bash
docker compose up -d
dotnet user-secrets set TrackingJwtSecret "any-local-dev-value-at-least-32-bytes-long" \
  --project src/ClimateProject.Api
dotnet ef database update --project src/ClimateProject.Infrastructure --startup-project src/ClimateProject.Api
dotnet run --project src/ClimateProject.Api
curl http://localhost:5080/health
```

### Frontend (`web/`)

```bash
cd web
npm install
cp .env.example .env.development   # if not already present
npm run dev
```

Requires the API (above) running on `http://localhost:5080` — `web/.env.development` points at it via `VITE_API_BASE_URL`.

Node **>= 22.12** is required (`web/package.json` `engines`); `.nvmrc` pins 24. CI runs the
web suite on 22, 24 and 25 because two defects here have come from Node version drift — see
`.github/workflows/ci.yml` for the details.

### Secret scanning

Enable the pre-commit hook once per clone (git does not distribute hooks):

```bash
git config core.hooksPath .githooks
brew install gitleaks   # or https://github.com/gitleaks/gitleaks/releases
```

The hook scans staged changes only. The enforcement point is the `secret-scan` CI job, which
runs `scripts/verify-secret-scanning.sh` — that asserts both that the scanner still detects a
planted credential and that the repository is clean, since a misconfigured scanner and a
clean repo produce identical output. Run it yourself any time:

```bash
./scripts/verify-secret-scanning.sh
```

Background and the credential-rotation checklist: `docs/security/rotation-inventory.md`.

## Deployments

- **Frontend:** [organizational-climate-platform.vercel.app](https://organizational-climate-platform.vercel.app) — deployed via Vercel, Root Directory `web/`, builds on push independent of GitHub Actions. Preview deployments use the `https://climate-*-federicos-projects-21f2ff63.vercel.app` pattern (also allowlisted in the API's CORS policy).
- **Backend:** `https://bhgrdkd4gt.us-east-1.awsapprunner.com` — AWS App Runner, see `infra/aws/README.md` for the deploy runbook. `TrackingJwtSecret`, `InternalApiKey`, and the database connection string are supplied via Secrets Manager (`RuntimeEnvironmentSecrets`), not plain env vars. `InternalApiKey` must be set or every `/api/internal/*` route 500s — see `infra/aws/README.md`'s manual-path step 5 note.
- **Database:** Supabase-hosted Postgres (project `organizational-climate-platform`, `us-east-1`). The app connects via the Transaction pooler (port 6543) at runtime; EF Core migrations must be run against the **direct** connection (port 5432, `db.<project-ref>.supabase.co`) — the pooler's transaction mode is incompatible with `dotnet ef database update`. Local dev and the integration test suite use the `docker-compose` Postgres instead (never Supabase).

## Tracking-module integration (#56)

- **`/api/internal/*` (nodos, personas, ciclos-encuesta, hallazgos, send-notification):**
  Authed via a static `InternalApiKey` (a `Bearer` token, not a user JWT) — the only caller
  is climate-tracking's own backend. Every route's `company_id` query param must be a
  climate-project `Company` GUID; all 5 validate it the same way and 400 uniformly on
  anything else (climate-tracking passes the same configured value to all 5, so a
  misconfiguration should fail closed everywhere, not just on the routes that happen to
  have real data behind them).
- **Frontend `web/src/features/tracking/api/trackingApi.ts`:** a typed client for calling
  climate-tracking's API directly from the browser (no proxy through this backend). **This
  client is not yet usable in production or from a browser at all** — climate-tracking has
  no CORS configuration, so every cross-origin call from this client will fail the
  preflight `authFetch` forces (it always sets both `Authorization` and
  `Content-Type: application/json`). Fixing this is climate-tracking-side work, tracked
  under `#56`'s Plan B; don't wire up UI that calls this client until that lands.
