# climate-project-api — AWS deployment

This directory holds the CloudFormation templates that stand up `climate-project-api` in AWS. This README is the runbook for deploying it — read it before touching production.

## Architecture overview

Deployment is split into two CloudFormation stacks. `climate-project-api-bootstrap.yml` provisions the long-lived, rarely-changed foundation: an ECR repository for API images, the `AppRunnerEcrAccessRole` App Runner uses to pull those images, and the `GitHubDeployRole` that GitHub Actions assumes via OIDC to run deploys. `climate-project-api-prod-service.yml` provisions the App Runner service itself and is deployed on every release, taking the image URI and the ECR access role ARN (both read from the bootstrap stack's outputs) as parameters. In steady state: bootstrap stack once (or whenever the deploy role's permissions change), service stack on every deploy.

## Automated path (preferred)

```
gh workflow run deploy-prod.yml --repo TIMSInternational/organizational-climate-platform --ref main
```

This runs `.github/workflows/deploy-prod.yml`, which verifies its configuration is complete, tests the API, builds and pushes the image to ECR (stamping the commit SHA and build timestamp into the image, reported by `/version`), **applies EF Core migrations**, deploys the service stack passing **all 11 template parameters explicitly**, gates on `/ready` (which round-trips Postgres, unlike the static `/health`), and finally asserts the live `/version` reports the commit the run just built.

### Configuration the automated path requires

Set these on the `production` GitHub environment before the first dispatch. The workflow's
first step fails in seconds if any is empty, rather than surfacing an opaque CloudFormation
error minutes in:

| Name | Kind | Notes |
|---|---|---|
| `AWS_ACCOUNT_ID` | variable | `747814092517` |
| `CORS_ALLOWED_ORIGIN` | variable | Exact production frontend origin |
| `CORS_ALLOWED_WILDCARD_ORIGIN` | variable | Vercel preview pattern |
| `TRACKING_JWT_SECRET_ARN` | variable | Secrets Manager ARN |
| `DATABASE_CONNECTION_STRING_SECRET_ARN` | variable | Secrets Manager ARN (runtime). The secret it points at currently holds a **port 6543** string, which is **wrong** — see "Connection pooling" below. It should be the session pooler, 5432, same as the migration string. |
| `INTERNAL_API_KEY_SECRET_ARN` | variable | Secrets Manager ARN |
| `MIGRATION_DATABASE_CONNECTION_STRING` | **secret** | **Session pooler: the same host as the runtime string, port 5432, username `postgres.<project-ref>`.** Not 6543, and **not** `db.<project-ref>.supabase.co` — that host is IPv6-only and unreachable from GitHub Actions. See below. |

Passing every parameter explicitly is deliberate. `aws cloudformation deploy` reuses a
parameter's **previous stack value** when omitted — it does not fall back to the template
default — so the previous 3-of-11 invocation made the deployed configuration a function of
invisible prior stack state rather than of this repository.

#### The migration connection string is the session pooler, not the "direct connection"

This is the one value most likely to be filled in wrongly, because the Supabase dashboard
presents the wrong answer prominently and earlier revisions of this file recommended it.

Supabase exposes the database three ways. Two of them are the **same pooler host** on two
ports, distinguished only by mode:

| Endpoint | Host | Port | Mode | For EF migrations? | For the runtime service? |
|---|---|---|---|---|---|
| Transaction pooler | `aws-0-<region>.pooler.supabase.com` | 6543 | multiplexes sessions across backends | **No** — see below | **No** — see "Connection pooling" below (#220) |
| **Session pooler** | `aws-0-<region>.pooler.supabase.com` | **5432** | one dedicated backend per session | **Yes — use this** | **Yes — use this** |
| "Direct connection" | `db.<project-ref>.supabase.co` | 5432 | straight to Postgres | Works locally, **never from CI** | Works locally, **never from CI** |

Both connection strings therefore want the **same endpoint**: the session pooler on 5432.
They stay two separate values only because they live in two different secret stores and can
carry different pool settings, not because they point anywhere different.

Both failure modes are guarded in `deploy-prod.yml`, and they fail for unrelated reasons:

- **Port 6543 is wrong for a semantic reason.** Supavisor's transaction mode hands a
  different backend to each statement, which breaks the *session-scoped* advisory lock EF
  Core takes to serialise concurrent migration runs, and breaks the multi-statement
  transactions the migrations themselves run in.
- **`db.<project-ref>.supabase.co` is wrong for a routing reason.** That host publishes an
  **AAAA record and no A record — it is IPv6-only** — and GitHub Actions runners have no
  IPv6 address. It is therefore unroutable from this workflow no matter how correct the
  credentials are. Measured 2026-08-04: `dig +short A db.<project-ref>.supabase.co` returns
  nothing, `dig +short AAAA` returns an address, and the pooler host returns three IPv4
  addresses. It is a perfectly good target from a developer workstation on an IPv6-capable
  network, which is why the mistake survives casual testing.

The practical recipe: **take the runtime connection string and change the port from 6543 to
5432.** The username is already in the `postgres.<project-ref>` form the pooler requires, and
the password is the same. Do not switch hosts.

Why this mattered enough to write down: the workflow's preflight is an **emptiness check, not
a validity check**, so a plausible-but-wrong value passes it and fails much later. Pointing at
the IPv6-only host would have failed at connect with a *timeout*, which reads like a transient
network fault rather than a misconfigured secret — so the guard rejects that host by name and
explains why, rather than letting the run hang. Tracking issue: #212.

**Status as of 2026-08-03.** The account-wide GitHub Actions billing block described in earlier
revisions of this file is **resolved** — workflows execute again. `CI` now runs on every PR and
every push to `main`, and its .NET job passes. Two things are still unverified, so do not yet
treat the automated deploy as proven:

- **`deploy-prod.yml` has never had a successful run.** It is `workflow_dispatch`-only and was
  never dispatched while billing was blocked. Every production deploy to date went through the
  manual path below.
- **The OIDC trust relationship has not been confirmed against the live account.** The
  `GitHubRepository` parameter default in `climate-project-api-bootstrap.yml` was updated to
  `TIMSInternational/organizational-climate-platform` after the repo rename, but a
  CloudFormation parameter **default only applies when the parameter is not supplied** — the
  deployed stack retains the value it was last deployed with, which predates the rename. If the
  live `climate-project-github-deploy-prod` role still trusts
  `repo:TIMSInternational/climate-project-api:*`, the first dispatched deploy fails at
  `configure-aws-credentials` with a `sts:AssumeRoleWithWebIdentity` denial. Verify before
  dispatching:

  ```
  aws iam get-role --role-name climate-project-github-deploy-prod \
    --query 'Role.AssumeRolePolicyDocument.Statement[].Condition' --output json
  ```

  Both `sub` entries must name `organizational-climate-platform`. If they name the old repo,
  redeploy the bootstrap stack with `GitHubRepository` passed explicitly:

  ```
  aws cloudformation deploy \
    --stack-name climate-project-api-bootstrap \
    --template-file infra/aws/climate-project-api-bootstrap.yml \
    --capabilities CAPABILITY_NAMED_IAM \
    --no-fail-on-empty-changeset \
    --parameter-overrides GitHubRepository=TIMSInternational/organizational-climate-platform
  ```

  This check requires credentials for the production account (`AWS_ACCOUNT_ID` repo variable,
  `747814092517`). Note that the resource names in the table below are **live infrastructure
  identifiers** and still use the pre-rename `climate-project-api` prefix deliberately —
  renaming them orphans the deployed stacks. Only the GitHub repository reference changed.

Tracking issue: https://github.com/TIMSInternational/organizational-climate-platform/issues/68

## Connection pooling and the connection budget

Two separate things went wrong here, and they are easy to conflate because they share a
symptom. Tracking issue: #220.

### Symptom

`/ready` — which round-trips Postgres — alternated **200, timeout, 200, timeout** across ten
consecutive probes of the live service: five of ten hung. `/health` returned 200 on every
probe throughout, because `/health` is a static literal that opens no connection. Anything
gating on `/health` therefore called this service healthy while half its database-touching
requests were hanging. This is the same class of blind spot #189 fixed at startup, appearing
again at steady state.

### Cause 1 — the runtime string points at the transaction pooler (**still open**, owner-gated)

Port 6543 is Supavisor's **transaction** pooler. Transaction mode assigns a different backend
to each statement. That is right for short-lived serverless clients that connect, run one
statement and disconnect; it is wrong for a long-running ASP.NET Core service, whose Npgsql
client-side pool holds connections open across statements and expects session state to persist
between them. The two pooling models fight, and the visible result is intermittent hangs.

The fix is to change that connection string's port from **6543 to 5432** — the session pooler.
Same host, same password, same `postgres.<project-ref>` username; **only the port changes**,
exactly as for the migration string described above. The value lives in **AWS Secrets Manager**
as `climate-project-api/prod/database-connection-string`, so it cannot be fixed by any change
to this repository and needs someone with write access to that secret.

Until it is fixed, the API logs a **startup warning** naming #220 whenever it sees port 6543
(`DatabaseConnectionStringPolicy`, wired up in `src/ClimateProject.Api/Program.cs`). It is
deliberately a warning rather than a hard startup failure: the live secret still says 6543, and
a hard guard shipped today would stop production booting on the next deploy — converting an
intermittently-slow service into a fully-down one, to complain about a value that deploy cannot
change. **Once the secret is flipped and a deploy comes up green, harden the warning into a
throw** so the port cannot silently regress. The `TODO(#220)` in `Program.cs` marks the spot.

### Cause 2 — the pool was unbounded (**fixed in this repository**)

Nothing set Npgsql's `Maximum Pool Size`, so it took the driver default of **100 per
instance**. Pools are per-process, and `climate-project-api-prod-service.yml` sets no
`AutoScalingConfigurationArn`, so the service runs on App Runner's **default autoscaling
configuration**: `MinSize` 1, `MaxSize` **25**. Worst-case demand is therefore
`instances x pool size` with nothing else bounding it:

| Instances (App Runner) | Max pool size (Npgsql) | Worst-case server connections |
|---|---|---|
| 1 (`MinSize`, idle) | 100 (old default) | 100 |
| 25 (`MaxSize`, peak) | 100 (old default) | **2500** |
| 1 (`MinSize`, idle) | **10 (current)** | 10 |
| 25 (`MaxSize`, peak) | **10 (current)** | **250** |

2500 is far past what a Supabase pooler will accept on any small plan, so at even moderate
scale-out the service would exhaust the pooler and new connections would queue until they timed
out — the same symptom as cause 1, from an unrelated direction. `DatabaseConnectionStringPolicy`
now applies a `Maximum Pool Size` of **10**, bringing peak demand to **250**.

**Confirm the actual ceiling before trusting the bottom row.** Supabase's pooler client limit
varies by compute size and is not a fixed published constant; read it from the project's
dashboard (Database → Connection pooling) or `SHOW max_connections`. 250 is chosen to sit under
the smallest plausible configured limit with headroom for migrations, `psql` sessions and the
Supabase dashboard's own connections, which also draw on the same budget.

Three knobs move these numbers, and changing any one requires rechecking the others:

- **Pool size** — `DatabaseConnectionStringPolicy.DefaultMaxPoolSize`
  (`src/ClimateProject.Infrastructure/Persistence/DatabaseConnectionStringPolicy.cs`). A unit
  test asserts the `25 x DefaultMaxPoolSize <= 250` budget, so raising it fails the build until
  this section is revisited.
- **Instance ceiling** — currently App Runner's implicit default of 25. Adding an explicit
  `AWS::AppRunner::AutoScalingConfiguration` with a smaller `MaxSize` would buy room for a
  larger pool, and would make the ceiling visible in the template instead of implied by an
  AWS default.
- **Supabase plan** — a larger compute size raises the ceiling itself.

The pool size can also be overridden **without a code change**: if the Secrets Manager
connection string specifies `Maximum Pool Size` itself, that value is honoured and the default
is not applied. That is deliberate, so the pool can be retuned in an incident without a
redeploy. Both behaviours are unit-tested.

## Manual path (what actually deployed the currently-live service)

Used as a workaround while GitHub Actions is billing-blocked. Requires local AWS CLI access with permissions to read the bootstrap stack, push to ECR, and deploy the service stack (or the `climate-project-github-deploy-prod` role, if assumable locally).

1. **Read bootstrap outputs** (ECR repository URI and the App Runner ECR access role ARN):

   ```
   aws cloudformation describe-stacks \
     --stack-name climate-project-api-bootstrap \
     --region us-east-1
   ```

   Take `EcrRepositoryUri` and `AppRunnerEcrAccessRoleArn` from `Stacks[0].Outputs`.

2. **Authenticate Docker to ECR**:

   ```
   aws ecr get-login-password --region us-east-1 \
     | docker login --username AWS --password-stdin <ecr-registry>
   ```

3. **Build the image.**

   > **Apple Silicon / ARM hosts: `--platform linux/amd64` is REQUIRED.** Docker on Apple Silicon builds `linux/arm64` images by default. App Runner only runs `linux/amd64`. An image built without this flag pushes and deploys "successfully" but the App Runner service then fails to start (or crash-loops) — this cost two 19-minute failed deploys during initial rollout before the cause was identified. Always pass the flag explicitly, even on machines that are currently x86, so the command is portable:

   ```
   docker build --platform linux/amd64 -t <ecr-uri>:<tag> .
   ```

4. **Push to ECR**:

   ```
   docker push <ecr-uri>:<tag>
   ```

5. **Deploy the service stack**:

   ```
   aws cloudformation deploy \
     --stack-name climate-project-api-prod \
     --template-file infra/aws/climate-project-api-prod-service.yml \
     --capabilities CAPABILITY_NAMED_IAM \
     --no-fail-on-empty-changeset \
     --parameter-overrides \
       ServiceName=climate-project-api-prod \
       ImageIdentifier=<ecr-uri>:<tag> \
       EcrAccessRoleArn=<AppRunnerEcrAccessRoleArn from step 1>
   ```

   > `CorsAllowedOrigin`, `CorsAllowedWildcardOrigin`, `TrackingJwtSecretArn`,
   > `DatabaseConnectionStringSecretArn` and `InternalApiKeySecretArn` have no CloudFormation
   > default and aren't in the command above — `aws cloudformation deploy` reuses each
   > parameter's previous value on a stack **update** when it's omitted, so this is safe once
   > every one of them has already been supplied at least once. On the **first** deploy after
   > a new no-default parameter is introduced (like `InternalApiKeySecretArn`, added for the
   > `/api/internal/*` routes), it must be passed explicitly that one time or the deploy fails
   > with a missing-parameter error. Create an `InternalApiKey` secret in Secrets
   > Manager first (same shared value climate-tracking's `INTERNAL_API_KEY` config points
   > at), then add `InternalApiKeySecretArn=<that-secret-arn>` to the command above for that
   > first run.
   >
   > **As of #189 the consequence of getting this wrong is worse than it used to be.** The
   > host now validates `InternalApiKey` and the connection string at startup
   > (`.ValidateOnStart()`). An unset value therefore means the service **does not boot**,
   > fails its App Runner health check, and the deploy fails outright. It no longer degrades
   > to per-request 500s on `/api/internal/*`. Prefer the automated path, which passes every
   > parameter explicitly and refuses to start if any is missing.

6. Confirm the service is healthy by checking the `ServiceUrl` stack output and hitting `/health`.

## Stack and resource name reference

| Resource | Name |
|---|---|
| Bootstrap stack | `climate-project-api-bootstrap` |
| Service stack | `climate-project-api-prod` |
| App Runner ECR access role | `climate-project-apprunner-ecr-access-prod` |
| GitHub OIDC deploy role | `climate-project-github-deploy-prod` |
| Live production URL | https://bhgrdkd4gt.us-east-1.awsapprunner.com |
