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

```bash
dotnet run --project src/ClimateProject.Api
curl http://localhost:5000/health
```
