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

## Deployments

- **Frontend:** [organizational-climate-platform.vercel.app](https://organizational-climate-platform.vercel.app) — deployed via Vercel, Root Directory `web/`, builds on push independent of GitHub Actions. Preview deployments use the `https://climate-*-federicos-projects-21f2ff63.vercel.app` pattern (also allowlisted in the API's CORS policy).
- **Backend:** `https://bhgrdkd4gt.us-east-1.awsapprunner.com` — AWS App Runner, see `infra/aws/README.md` for the deploy runbook. `TrackingJwtSecret` and (once provisioned) the database connection string are supplied via Secrets Manager (`RuntimeEnvironmentSecrets`), not plain env vars.
- Production Postgres is Supabase-hosted; local dev and the integration test suite use the `docker-compose` Postgres instead (never Supabase).
