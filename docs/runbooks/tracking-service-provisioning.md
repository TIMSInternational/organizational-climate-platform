# Giving `services/tracking-api` a production deployment path — #219

**Status: NOTHING BELOW HAS BEEN EXECUTED.** This branch adds four files —
`infra/aws/climate-tracking-api-bootstrap.yml`,
`infra/aws/climate-tracking-api-prod-service.yml`,
`.github/workflows/deploy-tracking-prod.yml` and `services/tracking-api/Dockerfile`.
No workflow was dispatched, no stack was created, no secret was written, no image
was built. Authoring a workflow file does not run it.

Written for someone who will execute it, not read it. Every command is meant to be
pasted. Where a value is not knowable from this repository it is marked
**HUMAN INPUT** and collected again at the end.

---

## 0. What is true today (measured 2026-08-24, not assumed)

| Fact | How it was established |
|---|---|
| `services/tracking-api` has **no deploy workflow, no stack, no image, no database**. | `grep -rn tracking-api .github/workflows/*.yml` returned nothing; `infra/aws/` held two templates, both `climate-project-api`. |
| It also has **no CI**. `ci.yml`'s .NET job restores/builds/tests `ClimateProject.slnx` only. `ClimateTracking.slnx` is built nowhere. | Read `.github/workflows/ci.yml`. #219's body says the service "is built and tested in CI"; that is the one claim in the issue that is **wrong**. |
| A client-facing feature just merged into it: `fab4c40 feat(tracking): export the plans as the client's own Tracking workbook (#386)`. | `git log services/tracking-api`. It has therefore never been deployed anywhere. |
| Production `climate-project-api` is on commit `fc53936`, built `2026-08-19T15:31:59Z`. `main` is **23 commits ahead**. | `curl https://bhgrdkd4gt.us-east-1.awsapprunner.com/version`; `git rev-list --count fc53936..origin/main`. |
| **The cross-service contract is unchanged between `fc53936` and `main`.** | `git diff --stat fc53936..origin/main -- src/ClimateProject.Api/Endpoints/TrackingInternalEndpoints.cs src/ClimateProject.Api/Infrastructure/InternalApiKeyFilter.cs src/ClimateProject.Application/Tracking src/ClimateProject.Infrastructure/Auth/JwtTokenService.cs services/tracking-api/src/ClimateTracking.Application/Auth/TrackingTokenValidation.cs` → empty. This is load-bearing; see §7. |
| The `production` GitHub environment already holds `INTERNAL_API_KEY_SECRET_ARN` and `TRACKING_JWT_SECRET_ARN`. | `gh api /repos/TIMSInternational/organizational-climate-platform/environments/production/variables`. Exact values in §4. |
| The web tracking module is **already in the production bundle**, dormant. `06a1531` shipped `web/src/features/tracking/**` and Vercel deploys on every merge. | `git show --stat 06a1531`; `web/src/features/tracking/api/config.ts`. This is the whole of the §7 ordering risk. |
| `https://climate.timsint.com` is live and IS the API's allowed CORS origin. | `curl -I` → 200; `OPTIONS` preflight with that `Origin` returns `access-control-allow-origin: https://climate.timsint.com`. The "known break" in README.md §Frontend is **fixed**; that paragraph is stale. |
| **Supabase PITR is OFF and there are zero listed backups** for the production database. | `supabase backups list --project-ref uleeeziiceduvmiftgby -o json` → `{"backups": [], "pitr_enabled": false, "walg_enabled": true}`. Confirms the standing risk. `walg_enabled: true` only means the physical-backup engine exists; nothing restorable is listed. |
| `deploy-prod.yml` takes **~21–22 minutes** per run. | `gh run list --workflow=deploy-prod.yml` — five successful runs, 21m04s to 22m36s. Budget the same for tracking. |
| `deploy-staging.yml` has **never run**, and there is **no `staging` GitHub environment**. | `gh run list --workflow=deploy-staging.yml` → empty; `gh api .../environments` → only `Preview` and `production`. **There is no place to rehearse this.** |

---

## 1. The shape, and why it is this shape

Two CloudFormation stacks and one dispatch-only workflow, identical in structure to
`climate-project-api` — bootstrap once, service stack on every deploy:

| Resource | climate-project (live) | climate-tracking (this branch) |
|---|---|---|
| Bootstrap stack | `climate-project-api-bootstrap` | `climate-tracking-api-bootstrap` |
| Service stack | `climate-project-api-prod` | `climate-tracking-api-prod` |
| ECR repository | `climate-project-api` | `climate-tracking-api` |
| App Runner ECR access role | `climate-project-apprunner-ecr-access-prod` | `climate-tracking-apprunner-ecr-access-prod` |
| GitHub OIDC deploy role | `climate-project-github-deploy-prod` | `climate-tracking-github-deploy-prod` |
| GitHub environment | `production` | **`production` — the same one** |
| Health check path | `/ready` | `/ready` |
| Autoscaling | implicit default (Min 1 / **Max 25**) | **explicit Min 1 / Max 1** |

Three decisions in that table are not copies, and each is argued at length in the
file that makes it. In brief:

**Separate bootstrap stack rather than parameterising the existing one.** The live
template's IAM role names are `!Sub`-built from a `ResourceNameSuffix` whose
`AllowedValues` are `prod` and `staging`. CloudFormation *replaces* a named role
rather than renaming it, so widening that parameter and redeploying would rename
live IAM roles and orphan the deployed climate-project stacks — the failure
`infra/aws/README.md` warns about in the words "renaming them orphans the deployed
stacks". `scripts/verify-oidc-trust-subs.py` also pins that file's trust policy
byte-for-byte against the live role. A sibling file is a second *file*, not a
second *pattern*.

**The same `production` GitHub environment.** This is what makes
`vars.INTERNAL_API_KEY_SECRET_ARN` literally the same variable object both deploy
workflows read. #219's first acceptance criterion is one source of truth; sharing
the environment is that criterion at the configuration layer, and the identity
preflight (§5, step 5.3) is the same criterion enforced again at deploy time
against the live stack.

**Max 1 instance.** `CacheSyncWorker` and `DailySemaforoWorker` are plain
`BackgroundService`s on `PeriodicTimer`s with **no distributed lease**.
climate-project can run 25 instances because its jobs take a Postgres advisory
lease (`PostgresAdvisoryJobLease`); nothing equivalent exists here. On N instances
`DailySemaforoWorker` runs N times a day and it *sends notifications*, with
read-then-write idempotency and no lock — so two instances ticking together can
both read "not sent" and both send. **Duplicate 30-day and 15-day reminders about
their own action plans, to a government client.** Max 1 removes that without a code
change. If horizontal scale is ever needed, the fix is a lease in the workers, not
a bigger number here.

---

## 2. Step 0 — give the tracking solution a CI gate first

`deploy-tracking-prod.yml` runs `dotnet test services/tracking-api/ClimateTracking.slnx`
before it deploys, exactly as `deploy-prod.yml` does. As things stand that is the
**first and only** automated run of that suite, which means a red suite would be
discovered inside a production deploy rather than on the pull request that broke it.

Add this job to `.github/workflows/ci.yml`. It is **not** added on this branch, on
purpose: this lane could not run the .NET suites (Docker was held by another lane),
so shipping an unverified job that runs on every PR would risk turning CI red for
everyone. Run the suite green once locally, then add it in its own commit.

```yaml
  tracking-build-and-test:
    name: tracking-build-and-test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # services/tracking-api/global.json, not the root one. They pin the same SDK
      # today (10.0.100, rollForward latestFeature); using the solution's own is
      # what keeps that true if one of them moves.
      - uses: actions/setup-dotnet@v4
        with:
          global-json-file: services/tracking-api/global.json

      - name: Restore
        run: dotnet restore services/tracking-api/ClimateTracking.slnx

      - name: Build
        run: dotnet build services/tracking-api/ClimateTracking.slnx --no-restore --configuration Release

      # ClimateTracking.IntegrationTests uses Testcontainers (PostgresFixture spins
      # postgres:16-alpine), so this needs the runner's Docker daemon.
      # ClimateProject.IntegrationTests already relies on the same thing in the
      # build-and-test job above, so this adds no new requirement.
      - name: Test
        run: dotnet test services/tracking-api/ClimateTracking.slnx --no-build --configuration Release --verbosity normal
```

Verify locally first, from the repository root:

```bash
dotnet restore services/tracking-api/ClimateTracking.slnx
dotnet build   services/tracking-api/ClimateTracking.slnx --no-restore --configuration Release
dotnet test    services/tracking-api/ClimateTracking.slnx --no-build   --configuration Release
```

Restore and Release build were run on this branch and are clean (**0 warnings, 0
errors** — `TreatWarningsAsErrors` is on for that solution). The **test** command
was not run here.

---

## 3. Step 1 — three source changes, without which no deploy can succeed

These are in `services/tracking-api` source and were deliberately **not** made on
this branch (two other lanes were building in that tree). Each is mechanical; the
exact code is given so this is a paste, not a design task.

### 3.1 `GET /ready` — required by the App Runner health check

App Runner's health check probes `/ready` and the tracking host serves only a
static `/health`. Without this the rollout fails its health check and is rejected,
and the deploy's canary fails at the 300-second deadline with `best=0`.

**Do not "fix" this by pointing the health check at `/health`.** That is exactly
the configuration #221 removed from climate-project, and the reason is written on
`HealthCheckPath` in the service template: `/health` opens no connection, so an
instance that has lost Postgres **passes it forever** and is never replaced.

In `services/tracking-api/src/ClimateTracking.Api/Program.cs`, beside the existing
`/health` map, mirroring `src/ClimateProject.Api/Program.cs:516`:

```csharp
app.MapGet("/ready", async (
    ClimateTrackingDbContext dbContext,
    ILoggerFactory loggerFactory,
    CancellationToken cancellationToken) =>
{
    try
    {
        await dbContext.Database.ExecuteSqlRawAsync("SELECT 1", cancellationToken);

        return Results.Ok(new ReadinessResponse(
            Service: "climate-tracking-api",
            Status: "ready",
            Database: "ok"));
    }
    catch (Exception exception)
    {
        loggerFactory
            .CreateLogger("ClimateTracking.Api.Readiness")
            .LogError(exception, "Readiness probe failed: database round-trip did not succeed.");

        return Results.Json(
            new ReadinessResponse(
                Service: "climate-tracking-api",
                Status: "not-ready",
                Database: "unreachable"),
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }
});

internal sealed record ReadinessResponse(string Service, string Status, string Database);
```

`ExecuteSqlRawAsync` needs `using Microsoft.EntityFrameworkCore;`, which
`Program.cs` already has. **It must not require authorization** — App Runner sends
no bearer token.

### 3.2 `GET /version` must report a 40-hex `commit`

`scripts/read-deployed-commit.sh` — the same reader `deploy-prod.yml` and
`deploy-drift.yml` use — requires a `.commit` field matching `^[0-9a-f]{40}$` and
**exits 1 on anything else**, including the literal `unknown`. That is not
defensive padding: `unknown` in production means an image built outside the CI path
is serving traffic, which is a finding, not a parse error.

Copy `src/ClimateProject.Api/BuildInfo.cs` to
`services/tracking-api/src/ClimateTracking.Api/BuildInfo.cs` (change the namespace
to `ClimateTracking.Api`), add to `ClimateTracking.Api.csproj`:

```xml
  <PropertyGroup>
    <CommitSha Condition="'$(CommitSha)' == ''">unknown</CommitSha>
    <BuildTimestamp Condition="'$(BuildTimestamp)' == ''">unknown</BuildTimestamp>
  </PropertyGroup>

  <ItemGroup>
    <AssemblyMetadata Include="CommitSha" Value="$(CommitSha)" />
    <AssemblyMetadata Include="BuildTimestamp" Value="$(BuildTimestamp)" />
  </ItemGroup>
```

and extend the existing `/version` response record with `Commit` and `BuiltAt`.
**The `Dockerfile` on this branch already passes `/p:CommitSha` and
`/p:BuildTimestamp`**, so nothing on the infra side changes when this lands.

### 3.3 Co-host the workers, or the service syncs nothing

`ClimateTracking.Api` does not reference `ClimateTracking.Workers`. Deployed as-is,
the service serves HTTP and syncs nothing: the four `*_cache` tables stay empty, so
every nodo and persona **name** in the plans list and in the new `.xlsx` export
renders blank, and no 30-day / 15-day / vencimiento notification is ever sent.

Add a `ProjectReference` from `ClimateTracking.Api` to `ClimateTracking.Workers`
and register both hosted services in `Program.cs`, mirroring the registration in
`ClimateTracking.Workers/Program.cs`:

```csharp
var cacheSyncIntervalMinutes = builder.Configuration.GetValue<double?>("CacheSyncIntervalMinutes") ?? 15;
builder.Services.AddSingleton<IHostedService>(sp => new CacheSyncWorker(
    sp.GetRequiredService<IServiceScopeFactory>(),
    sp.GetRequiredService<IClimateProjectClient>(),
    sp.GetRequiredService<ILogger<CacheSyncWorker>>(),
    TimeSpan.FromMinutes(cacheSyncIntervalMinutes)));
builder.Services.AddHostedService<DailySemaforoWorker>();
```

This is the deployment #275 chose for climate-project: the API image **is** the
scheduler, and `Dockerfile.workers` is kept unbuilt as the documented opt-out.

**A separate Workers service on App Runner is not an option that was rejected — it
is not available.** App Runner requires the container to listen on the configured
port and pass a health check; `ClimateTracking.Workers` is a `Host`, not a
`WebApplication`, so it never binds a port. The only alternatives to co-hosting are
ECS Fargate (a new IAM/VPC surface, days of work, a second pattern) or EventBridge
Scheduler calling an authenticated job route (a smaller source change than Fargate,
and the correct fallback if §6.4's idle-CPU measurement goes badly).

### 3.4 Recommended in the same PR: a design-time DbContext factory

Not required — the workflow works around it — but it removes a trap.
**Measured on this branch**, with no environment set:

```
$ dotnet dotnet-ef migrations list --project services/tracking-api/src/ClimateTracking.Infrastructure \
    --startup-project services/tracking-api/src/ClimateTracking.Api --no-build --no-connect
An error occurred while accessing the Microsoft.Extensions.Hosting services. ...
  Error: Missing ProcomerCompanyId configuration.
Unable to create a 'DbContext' of type 'ClimateTrackingDbContext'.
```

`ClimateTracking.Api/Program.cs` reads five configuration values before
`builder.Build()`, and EF's design-time host resolution executes everything up to
that point. Four are satisfied because `appsettings.json` ships non-null
placeholders (`""` passes a `?? throw`); `ProcomerCompanyId` is not, because #153
replaced its null check with `IsNullOrWhiteSpace`. With
`ProcomerCompanyId=00000000-0000-0000-0000-000000000000` set, the same command
lists both migrations. The workflow therefore sets that placeholder on its
migration step. An `IDesignTimeDbContextFactory<ClimateTrackingDbContext>` in
`ClimateTracking.Infrastructure` makes the whole class of problem go away, because
EF prefers it and never builds the host.

---

## 4. Step 2 — the database

`services/tracking-api` owns **eight tables and its own `__EFMigrationsHistory`**:
`ciclos_encuesta_cache`, `hallazgos_cache` (created then dropped),
`nodos_cache`, `personas_cache`, `planes_de_accion`, `semaforo_threshold_config`,
`bitacora_entries`, `notificaciones` — plus one seeded row and a GIN index on
`planes_de_accion.involucrados_external_ids`. Verified by scripting the history
locally: 141 lines, 8 `CREATE TABLE`, 2 `INSERT`, 3 `CREATE INDEX`, 1 `DROP TABLE`.

**HUMAN DECISION — where it lives.** Three options; the recommendation is D3.

- **D1, a second database in the existing Supabase project.** Supavisor's tenant is
  bound to the `postgres` database; routing a second one through the pooler is not
  a supported path. Rejected.
- **D2, a separate schema in the existing database.** Needs source changes
  (default schema, `MigrationsHistoryTable` placement), and the runtime
  `CREATE SEQUENCE` in `PlanesAccionEndpoints.GeneratePlanCodeAsync` would land in
  whatever `search_path` resolves to. It also puts the whole tracking workload on
  climate-project's connection budget. Possible, but it trades money for risk in
  the wrong direction.
- **D3, a new Supabase project (recommended).** Own pooler, own connection budget,
  own blast radius. Costs one more project on the plan. **It is also the only
  option under which a mistake in the tracking migration cannot touch the
  climate-project database** — which matters more than usual here, because that
  database has no PITR and no listed backups.

Whichever is chosen, the connection-budget arithmetic must be redone. Today
climate-project's worst case is 25 instances × `Maximum Pool Size` 10 = **250**
server connections (`infra/aws/README.md`, "Connection pooling and the connection
budget"). `ClimateTrackingDbContext` is registered with a bare
`options.UseNpgsql(connectionString)` — **there is no `DatabaseConnectionStringPolicy`
in the tracking service** — so Npgsql takes its driver default of **100 per
process**. At Max 1 instance that is 100 connections, a 40% increase on
climate-project's entire ceiling, against a pooler limit nobody has read.

Npgsql honours `Maximum Pool Size` written into the connection string, so this is
fixable **in the secret, with no code change**, and today that is the only place it
can be fixed:

```
Host=aws-0-us-east-1.pooler.supabase.com;Port=5432;Database=postgres;Username=postgres.<TRACKING_PROJECT_REF>;Password=<PASSWORD>;SSL Mode=Require;Trust Server Certificate=true;Maximum Pool Size=10
```

Port **5432** (session pooler), never 6543 and never `db.<ref>.supabase.co`. The
reasons are the two unrelated ones in `infra/aws/README.md`: 6543 is Supavisor
transaction mode, which fights Npgsql's client-side pool (that is #220, which cost
climate-project ~50% of its `/ready` probes); `db.<ref>.supabase.co` publishes an
AAAA record and no A record, so it is unroutable from IPv4-only GitHub runners.
**The tracking host has no `Database__RequireSessionPooler` equivalent, so here the
wrong port degrades silently the way it used to on climate-project.**

Then create the Secrets Manager entry, in account `747814092517`, `us-east-1`:

```bash
aws secretsmanager create-secret \
  --name climate-tracking-api/prod/database-connection-string \
  --description 'climate-tracking Postgres. Session pooler, port 5432. MUST carry Maximum Pool Size=10 (no DatabaseConnectionStringPolicy in this service).' \
  --secret-string 'Host=...;Port=5432;...;Maximum Pool Size=10' \
  --region us-east-1

# Read the ARN back — this is the value that goes into the GitHub variable.
aws secretsmanager describe-secret \
  --secret-id climate-tracking-api/prod/database-connection-string \
  --query ARN --output text --region us-east-1
```

**Turn PITR on for the tracking project while you are there**, and open the
question for the climate-project one. Measured 2026-08-24:
`supabase backups list --project-ref uleeeziiceduvmiftgby -o json` →
`{"backups": [], "pitr_enabled": false, "walg_enabled": true}`. Every delete in
this codebase is hard; `DailySemaforoWorker` writes on a schedule.

---

## 5. Step 3 — configuration, then the bootstrap stack, then the first dispatch

### 5.1 GitHub `production` environment

Already set, **shared with `deploy-prod.yml`, do not duplicate**:

| Name | Value (read back 2026-08-24) |
|---|---|
| `AWS_ACCOUNT_ID` (repo variable) | `747814092517` |
| `INTERNAL_API_KEY_SECRET_ARN` | `arn:aws:secretsmanager:us-east-1:747814092517:secret:climate-project-api/prod/InternalApiKey-rILWWK` |
| `TRACKING_JWT_SECRET_ARN` | `arn:aws:secretsmanager:us-east-1:747814092517:secret:climate-project-api/prod/tracking-jwt-secret-rtayFN` |

New, to add:

| Name | Kind | Value |
|---|---|---|
| `TRACKING_CORS_ALLOWED_ORIGIN` | variable | `https://climate.timsint.com` |
| `TRACKING_CORS_ADDITIONAL_ALLOWED_ORIGIN` | variable, optional | leave unset |
| `CLIMATE_PROJECT_BASE_URL` | variable | `https://bhgrdkd4gt.us-east-1.awsapprunner.com` |
| `PROCOMER_COMPANY_ID` | variable | **HUMAN INPUT**, see below |
| `TRACKING_DATABASE_CONNECTION_STRING_SECRET_ARN` | variable | the ARN from §4 |
| `TRACKING_MIGRATION_DATABASE_CONNECTION_STRING` | **secret** | the tracking session-pooler string |

```bash
gh variable set TRACKING_CORS_ALLOWED_ORIGIN --env production --body 'https://climate.timsint.com'
gh variable set CLIMATE_PROJECT_BASE_URL     --env production --body 'https://bhgrdkd4gt.us-east-1.awsapprunner.com'
gh variable set PROCOMER_COMPANY_ID          --env production --body '<GUID>'
gh variable set TRACKING_DATABASE_CONNECTION_STRING_SECRET_ARN --env production --body 'arn:aws:secretsmanager:...'
gh secret   set TRACKING_MIGRATION_DATABASE_CONNECTION_STRING  --env production
```

**`PROCOMER_COMPANY_ID` is not knowable from this repository.** It is the
climate-project `Company` GUID this deployment serves. Read it from the production
database:

```sql
SELECT id, name FROM companies ORDER BY name;
```

Getting it wrong has two distinct failure modes, and the preflight catches both:
blank makes the host refuse to start (which is the *correct* behaviour — a blank
tenant made `MatchingTenantRequirement` compare every caller against `""`, which
climate-project's company-less `super_admin`s **match**, handing every one of them
this tenant's whole API — #153); non-GUID boots fine and then 400s every
`/api/internal/{nodos,personas}` call, so the cache silently never fills.

### 5.2 The bootstrap stack — once, by hand, with production credentials

```bash
aws cloudformation deploy \
  --stack-name climate-tracking-api-bootstrap \
  --template-file infra/aws/climate-tracking-api-bootstrap.yml \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --region us-east-1 \
  --parameter-overrides \
    RepositoryName=climate-tracking-api \
    EnvironmentName=production \
    ResourceNameSuffix=prod \
    ImageTagPrefix=prod- \
    PeerApiStackName=climate-project-api-prod \
    GitHubRepository=TIMSInternational/organizational-climate-platform \
    GitHubBranch=main \
    GitHubOwnerId=305569681 \
    GitHubRepositoryId=1317724282
```

Re-derive the two numeric IDs rather than trusting them, if it has been a while:

```bash
gh api /repos/TIMSInternational/organizational-climate-platform --jq '{owner: .owner.id, repo: .id}'
gh api /repos/TIMSInternational/organizational-climate-platform/actions/oidc/customization/sub
```

The second returns the repository's `sub_claim_prefix` — the exact subject form
GitHub will mint, and the authoritative answer if the two disagree. Measured
2026-08-05 it returns `use_default: true` with the **ID-qualified** prefix, which is
why the trust policy carries four subs and why deleting the ID-qualified pair
breaks every deploy with a denial that reads like a credentials problem.

**This needs credentials for account `747814092517`.** The credentials available on
this machine are `arn:aws:iam::795965600143:user/Federico` — the **dev** account —
so this step could not be rehearsed here at all. Confirm afterwards:

```bash
aws cloudformation describe-stacks --stack-name climate-tracking-api-bootstrap \
  --region us-east-1 --query 'Stacks[0].Outputs'
```

### 5.3 First dispatch

```bash
gh workflow run deploy-tracking-prod.yml \
  --repo TIMSInternational/organizational-climate-platform \
  --ref main \
  -f confirm_destructive_migration=yes
```

**`=yes` is required on the first dispatch, and only the first.** Scripted from `0`,
the tracking history is 141 lines containing exactly one destructive statement:
`DROP TABLE hallazgos_cache;` at line 135, against a table
`CREATE TABLE hallazgos_cache` created at line 19 of the *same* script. It is
`20260801125946_DropHallazgosCache` undoing part of `20260729142701_InitialCreate`;
on a virgin database it destroys nothing that ever held a row. Verified locally on
this branch by generating the script — do not take it on trust, download the
`tracking-migration-sql` artifact from the failed run and confirm those are still
the only two lines involved.

Expected wall clock ≈ 20 minutes, from `deploy-prod.yml`'s measured 21–22.

---

## 6. Step 4 — verification, by measurement

A green workflow is necessary and not sufficient. Four of these are things the
workflow cannot check.

**6.1 The service answers, and answers as itself.**

```bash
BASE=https://<service-url-from-the-job-summary>
curl -sS "$BASE/version"          # commit must equal the deployed SHA
curl -sS "$BASE/ready"            # {"status":"ready","database":"ok"}
for i in $(seq 1 20); do curl -s -o /dev/null -w "%{http_code} " "$BASE/ready"; done; echo
```

Twenty, not one. #220's defect alternated 200/timeout at roughly 50%, so a single
green probe would have passed it about half the time.

**6.2 CORS actually works from the real origin.** This is the check that was
missing when climate-project's allowlist named the wrong Vercel URL for weeks:

```bash
curl -sS -i -X OPTIONS "$BASE/api/planes-accion" \
  -H "Origin: https://climate.timsint.com" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: authorization,content-type" | grep -i access-control
```

An `access-control-allow-origin: https://climate.timsint.com` header must come
back. **No header at all is the failure mode**, not an error.

**6.3 The cross-service call really is authorised.** This is #219's actual subject,
and until it is exercised the coupling is still untested:

```bash
# Watch the tracking service's App Runner log stream for one cache-sync tick.
# What you are looking for is the ABSENCE of `Cache sync failed for nodos`, and
# rows appearing:
#   SELECT count(*) FROM nodos_cache;      -- > 0
#   SELECT count(*) FROM personas_cache;   -- > 0
```

Zero rows with no error in the log means `ProcomerCompanyId` is wrong (the
`/api/internal` routes 400 on a non-GUID and return an empty list for a GUID with
no departments). A `401` in the log means the two services are on different
`InternalApiKey` values — which the deploy's identity preflight should have made
impossible, so if you see it, the preflight has a hole worth reporting.

**6.4 THE ONE I COULD NOT VERIFY AND THAT MOST NEEDS MEASURING.** App Runner
throttles an instance's CPU when it is not processing requests. The two workers are
`PeriodicTimer`s inside that instance. On a service nobody is using at 03:00 they
may fire late, or not at all. climate-project made the same bet in #275 and has
never verified it either.

```sql
-- Leave the service idle overnight, then:
SELECT max("UltimaSincronizacion") FROM nodos_cache;   -- should be < 15 min old
```

If it is hours stale, the answer is **not** a bigger instance — it is EventBridge
Scheduler calling an authenticated job route on the API, which forces a request and
therefore CPU.

**6.5 Whether a deploy is a rollover or a brief outage.** With `MaxSize: 1` it is
not established whether App Runner temporarily exceeds the ceiling during a rolling
deployment or briefly drops to zero healthy instances. **This is a guess, flagged as
one.** Watch the request metrics across the second deploy and write the answer into
the autoscaling comment in the service template.

---

## 7. Ordering — which side first, and what breaks out of order

**The short answer: climate-project does not need to move at all, and the web app
must move last.**

### O1 — climate-project first? No, and this was checked rather than assumed.

`git diff fc53936..origin/main` over `TrackingInternalEndpoints.cs`,
`InternalApiKeyFilter.cs`, `ClimateProject.Application/Tracking`,
`JwtTokenService.cs` and `TrackingTokenValidation.cs` is **empty**. The live
climate-project already serves the exact `/api/internal/*` contract and mints
exactly the tokens a tracking service built from `main` expects. So the tracking
service can be deployed today without touching production's API.

Two caveats. First, this is a fact about *these* commits and must be re-checked if
the deploy slips past further merges — rerun that diff. Second, `main` is already
**23 commits ahead** of what is live and `deploy-drift.yml`'s threshold is
`MAX_COMMITS_BEHIND: 20`, so the daily drift check will start failing at 13:00 UTC
regardless of anything here. That is a separate decision (dispatch `deploy-prod`,
or raise the threshold deliberately) and it should not be bundled into this one.

**If a future change *does* touch the internal contract, climate-project deploys
first.** The tracking service is the client; a client that ships ahead of its server
calls routes that do not exist yet, and `ClimateProjectClient` calls
`EnsureSuccessStatusCode()`, so a 404 becomes an exception inside `CacheSyncWorker`
— logged per entity type, silently syncing nothing.

### O2 — the web app must be LAST. This is the failure with a user-visible cost.

`web/src/features/tracking/api/config.ts` makes `VITE_TRACKING_API_BASE_URL` a
capability flag: a non-blank value turns the tracking module on, and
`navSections.workspacePlanItems` **swaps `/action-plans` out of the nav for the
tracking rows** (Federico's decision of 2026-08-21 — one place to manage plans
rather than two that disagree). The tracking pages themselves are *already in the
production bundle* (`06a1531`; Vercel deploys on every merge to `main`), dormant
only because the variable is unset.

So setting that variable before the service is verified healthy does two things at
once: it **takes a working screen away from the client** and it offers them a
module whose service is not serving. Set it only after §6.1 and §6.2 are green:

```bash
vercel env add VITE_TRACKING_API_BASE_URL production   # then redeploy
```

**Production scope only.** The tracking host binds `Cors:AllowedOrigins` as a plain
string array with no wildcard support — there is no `Cors:AllowedWildcardOrigins`
and no `CorsOriginMatcher` in that service — so a Vercel *preview* build with the
variable set would fail every tracking request at the preflight.

Also update `web/vercel.json`'s `Content-Security-Policy-Report-Only`: `connect-src`
currently names only `https://bhgrdkd4gt.us-east-1.awsapprunner.com`. It is
report-only, so it will not block anything today — which is exactly why it will be
forgotten before it is enforced.

**Rollback for O2 is fast and complete**: unset the Vercel variable and redeploy.
Action Plans comes back, the tracking rows go away. That asymmetry — the web change
is instantly reversible and the service deploy is not — is the reason the web
change goes last.

### O3 — migration before rollout, inside the workflow

The workflow applies EF migrations **before** the App Runner rollout, so the schema
is never behind the code that expects it. The accepted window is the same one
`deploy-prod.yml` documents: between the migration and the rollout, the *previous*
image runs against the *new* schema. For the first tracking deploy there is no
previous image, so the window is empty. For later ones, a migration that cannot
tolerate it needs expand/contract, not a change to the step's position.

### O4 — the summary table

| Sequence | Result |
|---|---|
| bootstrap → secrets → tracking deploy → verify → Vercel variable | correct |
| Vercel variable set **before** the tracking deploy | client loses Action Plans **and** gets a dead tracking module. Reverse by unsetting the variable and redeploying web. |
| tracking deployed with a **different** `InternalApiKey` ARN | every `/api/internal/*` call 401s, fail-closed, first seen whenever the first cross-service call happens. **Blocked by the identity preflight.** |
| tracking deployed with a **different** `TrackingJwtSecret` ARN | every authenticated tracking route 401s forever. **Blocked by the identity preflight.** |
| tracking migration string pointed at climate-project's database | 8 `CREATE TABLE` + 1 `DROP TABLE` in the live client database, which has no PITR. **Blocked by the same-database guard.** |
| tracking deployed without the workers co-hosted | service is healthy and green; caches never fill; every nodo/persona name is blank and no notification is ever sent. **Not blocked by anything — this is the quiet one.** |

---

## 8. Rotating `InternalApiKey` once both sides are live — #219 AC 4

**Two-sided. Never one.** The mechanism that decides the ordering: App Runner
resolves `RuntimeEnvironmentSecrets` ARNs at **instance start**, not at deploy
time. So `put-secret-value` alone changes nothing, and the mismatch window is
bounded by the two redeploys rather than by the secret write.

1. Generate: `openssl rand -hex 32`.
2. `aws secretsmanager put-secret-value --secret-id climate-project-api/prod/InternalApiKey --secret-string <new>`
   — one secret, both services, which is the whole point of #219 AC 1.
3. Dispatch `deploy-prod.yml`. ~21 min. It fails outright if the value is blank
   (`ValidateOnStart`, #189), so a botched write is loud.
4. Dispatch `deploy-tracking-prod.yml`. ~20 min.
5. Verify: one tracking→climate call returns 200, **or** the absence of repeated
   `401 "Invalid or missing internal API key."` in the climate App Runner log.

Between 3 and 4 (~20 minutes) `/api/internal/*` returns 401 per request,
fail-closed. What that costs, concretely: `CacheSyncWorker` logs one error per
entity type per 15-minute tick and syncs nothing — at most two missed ticks, and
the cache self-heals on the next good one. Plan creation still works, because the
hallazgo lookup swallows client failures (`ca7c9fd`). **User traffic is
unaffected.** The order of 3 and 4 does not matter for correctness — both
directions produce the same symmetric 401 window — but *both must happen*, and
nothing else should be dispatched in between.

`TrackingJwtSecret` is the same two-sided shape with a much larger blast radius: it
is one value doing three jobs and rotating it logs everyone out of **both** products
at once. See `docs/security/rotation-inventory.md` §A before touching it.

---

## 9. What only a human can decide or supply

1. **`PROCOMER_COMPANY_ID`** — the `Company` GUID. Not in this repository; read it
   from the production database (`SELECT id, name FROM companies`).
2. **Where the tracking database lives** — D3 (a new Supabase project) is
   recommended; it is a cost decision as much as a technical one.
3. **The tracking database password and connection string**, and the decision to
   write `Maximum Pool Size=10` into it. Nothing in the repository can set this.
4. **Production AWS credentials (`747814092517`)** to create the bootstrap stack and
   the Secrets Manager entry. This machine has only the dev account.
5. **Whether to turn PITR on** — for the tracking project, and separately for
   climate-project, whose PITR is measurably off with zero listed backups.
6. **Whether the tracking test suite is green**, before adding the CI job in §2.
   This lane could not run it.
7. **Whether the three source changes in §3 are acceptable in one PR**, and who owns
   them — `services/tracking-api` had two other lanes in it the night this was
   written.
8. **Whether `main` should be deployed to climate-project first** for its own sake.
   Not required by anything here (§7 O1), but production is 23 commits and five days
   behind and the drift check is about to start failing.
9. **Whether the `.xlsx` export has a UI at all.** `web/src/features/tracking/api/trackingApi.ts`
   has no download function as of 2026-08-24, so `GET /api/planes-accion/export`
   ships reachable only by URL. If a button is added, check whether
   `Content-Disposition` needs `WithExposedHeaders` on the tracking CORS policy for
   the browser to read the filename cross-origin — **unverified, and worth five
   minutes before the demo.**

---

## 10. What this branch could not verify

- **The bootstrap and service stacks have never been deployed.** They pass
  `cfn-lint 1.53.3` (the exact version CI pins) and the workflow passes
  `actionlint 1.7.12` (likewise), and both mirrored steps are byte-identical to
  `deploy-prod.yml`'s — checked by parsing both files and comparing the `env` and
  `run` values. None of that is a deploy.
- **The `MaxSize: 1` deployment behaviour** (§6.5) and **the idle-CPU behaviour of
  the workers** (§6.4). Both are stated as mechanisms with a measurement attached,
  not as facts.
- **The tracking test suite.** Not run here.
- **The `Timeout: 5` health-check figure** is inherited from climate-project, where
  it was justified against a measured 0.37s median and a 9.4s cold start. This
  service's EF model is smaller (6 entity types), so its cold start should be lower
   — the safe direction for a borrowed number, but still borrowed. Measure it and
  correct the comment rather than leaving it standing as local evidence.
