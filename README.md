# organizational-climate-platform

Monorepo for the organizational climate platform: `web/` (React + Vite SPA) and `src/`
(.NET 10 API). It runs organizational-climate surveys and microclimates — build an
instrument from a question library, invite a company's employees, collect responses under an
anonymity floor, and read the results as dimension scores, a climate map and action plans.
`services/tracking-api/` is a separate, single-tenant action-plan tracking service. It is
**live**: the web is `https://climate.timsint.com` and the API is
`https://bhgrdkd4gt.us-east-1.awsapprunner.com`, serving commit `e0896f9` (`GET /version`,
2026-09-03).

This repository replaced a legacy Next.js/MongoDB app, but it is **not** a migration target:
the legacy database held mock data and was abandoned rather than migrated on 2026-08-19 —
[`docs/decisions/no-data-migration.md`](docs/decisions/no-data-migration.md). The new platform
starts from an empty database populated by real use.

**Where the docs live:**

- [`docs/requirements/`](docs/requirements/README.md) — what the client asked for (see the
  paragraph below, which is the one to read first).
- [`docs/decisions/`](docs/decisions/) — why things are the way they are, one file per call.
- [`docs/runbooks/`](docs/runbooks/) — cutover, rollback, alerting, UAT, staging and the two
  provisioning runbooks. Each states its own measurement date; re-verify before acting.
- [`docs/legacy-issues/`](docs/legacy-issues/) — the legacy tracker, archived. This paragraph
  previously linked `climate-project#17` and `#47`; those issues were deleted
  (`gh issue view 17 --repo TIMSInternational/climate-project` → *"Could not resolve to an
  issue or pull request with the number of 17"*, same for 47, measured 2026-09-03), which is
  why the links are gone and the archive is cited instead.

[REWRITTEN 2026-09-03. The previous opening described this repo as "the migration target for
the legacy Next.js/MongoDB stack" and pointed at two deleted issues for "the full migration
epic".]

**What the client asked for lives in [`docs/requirements/`](docs/requirements/README.md)** — the
PRD, the tech spec and five rounds of client review notes, ported verbatim from the legacy repo.
Requirements in them are binding; their technical-stack sections are superseded by this stack.
Read the relevant ones before building a feature, not after.

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

- **Frontend:** **[climate.timsint.com](https://climate.timsint.com)** — Vercel project `climate` (team `federicos-projects-21f2ff63`), Root Directory `web/`, builds on push independent of GitHub Actions. Preview deployments use the `https://climate-*-federicos-projects-21f2ff63.vercel.app` pattern (also allowlisted in the API's CORS policy). The hosting decision, the DNS facts and the `VITE_API_BASE_URL` build-time trap are recorded in [`docs/decisions/web-hosting.md`](docs/decisions/web-hosting.md).

  **Corrected 2026-09-03.** This bullet named `web-one-green-86.vercel.app` — a Vercel-generated name — and the string `climate.timsint.com` appeared nowhere in this file. Measured today: `curl -s -o /dev/null -w '%{http_code} %{remote_ip}' https://climate.timsint.com/` → `200 76.76.21.21`, serving `<title>Organizational Climate Platform</title>`; `dig +noall +answer climate.timsint.com` → `1798 IN A 76.76.21.21`; and the API's `production` environment sets `CORS_ALLOWED_ORIGIN=https://climate.timsint.com` (`gh variable list --env production`, set `2026-08-19T04:15:37Z`). The earlier 2026-08-18 correction — which replaced `organizational-climate-platform.vercel.app` with the generated name — is superseded by this one, not contradicted by it: that host is a stale, unrelated deployment and never served this project.

  ~~**⚠️ Known break, open as of 2026-08-18: the production API's CORS allowlist still names the OLD url.**~~ **RESOLVED — verified 2026-09-03.** Preflight measured against `https://bhgrdkd4gt.us-east-1.awsapprunner.com/version`: `OPTIONS` with `Origin: https://climate.timsint.com` → `204` and `access-control-allow-origin: https://climate.timsint.com`; the same preflight with `Origin: https://organizational-climate-platform.vercel.app` → `204` with **no** `access-control-allow-origin` header at all. The canonical origin is the custom domain, and the old URL is no longer allowed. The remaining half of #160 is the **API** side: it still has no custom domain (`aws --profile claude apprunner describe-custom-domains …/climate-project-api-prod` → `"CustomDomains": []`).

- **Backend:** `https://bhgrdkd4gt.us-east-1.awsapprunner.com` — AWS App Runner, see `infra/aws/README.md` for the deploy runbook. `TrackingJwtSecret`, `InternalApiKey`, and the database connection string are supplied via Secrets Manager (`RuntimeEnvironmentSecrets`), not plain env vars. **As of #189, `InternalApiKey` and the connection string are validated at startup: if either is unset the service refuses to start**, rather than starting and 500ing (`/api/internal/*` for the key, every DB-touching route for the connection string) while `/health` still reports `ok`. A deploy that omits either now fails outright instead of coming up half-broken, and `/ready` (#206) covers the remaining case of a connection string that is present but points somewhere unreachable. Note the two failure modes for `InternalApiKey` are different and both matter for rotation: **unset** fails startup, whereas **mismatched** returns a per-request 401 — see `docs/security/rotation-inventory.md`. `GoogleClientId` is deliberately *not* required unless `GoogleAuth:Required` is `true`, so environments without Google sign-in are unaffected.
- **Email (#100):** off by default and **off in production until the settings below are supplied**. With `Email:Provider` unset (or `none`) the API keeps the logging stubs: notifications and invitations are recorded as `sent` and **no mail leaves the process**. That state is announced by a startup `WARNING` (`ClimateProject.Api.Email`), so a deploy that forgot the mail secrets says so in its first log lines rather than silently. To turn delivery on, supply all four of `Email:Provider=smtp`, `Email:SmtpHost`, `Email:FromAddress` and `Email:AppBaseUrl` — plus `Email:SmtpUsername`/`Email:SmtpPassword` unless the relay accepts anonymous submission (they must be set together or both left empty). A provider selected with any of the required values missing **fails startup**, following #189: a half-configured mail deploy that boots is exactly the "healthy service that delivers nothing" failure this repo has already been bitten by. Optional: `Email:SmtpPort` (default 587), `Email:SmtpUseStartTls` (default `true`), `Email:MaxSendsPerSecond` (default 10, per instance — set it below the provider's account limit divided by the instance count), `Email:TimeoutSeconds` (default 30), `Email:FromName`. For Amazon SES the host is `email-smtp.<region>.amazonaws.com`, the credentials are the **SES SMTP** username/password pair (derived from an IAM key, not the IAM key itself), the `FromAddress` domain must be verified in SES, and the account must be out of the SES sandbox or sending is limited to verified recipients.
- **Database:** Supabase-hosted Postgres (project `organizational-climate-platform`, `us-east-1`). Both the runtime app and EF Core migrations want the **session pooler** — `aws-0-<region>.pooler.supabase.com`, port **5432**, username `postgres.<project-ref>`. Transaction mode (port 6543) is incompatible with `dotnet ef database update`, and equally incompatible with the runtime app, whose Npgsql pool holds connections open across statements. **The runtime secret was moved from 6543 to 5432 on 2026-08-10 and #220 closed on the evidence** — 20 of 20 consecutive `/ready` probes returned 200 and the transaction-pooler warning is gone from the App Runner logs. The API still logs that startup warning whenever it sees 6543, and `Database:RequireSessionPooler` turns it into a startup failure so the port cannot regress silently; **the flag is armed (`true`) in prod as of 2026-08-17, closing the last step of #220** — see `infra/aws/README.md` ("Connection pooling and the connection budget", then "Arming the guard"). The value itself lives in AWS Secrets Manager, not this repository. The dashboard's "direct connection" (`db.<project-ref>.supabase.co:5432`) also works from a workstation but is **IPv6-only, so it is unreachable from GitHub Actions**; see `infra/aws/README.md` for the full explanation and #212 for the measurements. Local dev and the integration test suite use the `docker-compose` Postgres instead (never Supabase).

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
