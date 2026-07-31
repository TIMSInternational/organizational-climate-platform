# climate-project-api

.NET 10 backend for climate-project — migration target from the legacy Next.js/MongoDB stack. See [climate-project#17](https://github.com/TIMSInternational/climate-project/issues/17) for the full migration epic and [#47](https://github.com/TIMSInternational/climate-project/issues/47) for this repo's foundation-scaffold spec.

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
