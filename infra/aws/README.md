# climate-project-api — AWS deployment

This directory holds the CloudFormation templates that stand up `climate-project-api` in AWS. This README is the runbook for deploying it — read it before touching production.

## Architecture overview

Deployment is split into two CloudFormation stacks. `climate-project-api-bootstrap.yml` provisions the long-lived, rarely-changed foundation: an ECR repository for API images, the `AppRunnerEcrAccessRole` App Runner uses to pull those images, and the `GitHubDeployRole` that GitHub Actions assumes via OIDC to run deploys. `climate-project-api-prod-service.yml` provisions the App Runner service itself and is deployed on every release, taking the image URI and the ECR access role ARN (both read from the bootstrap stack's outputs) as parameters. In steady state: bootstrap stack once (or whenever the deploy role's permissions change), service stack on every deploy.

As of #156 both templates are **environment-parameterised**: the same two files also provision staging (`.github/workflows/deploy-staging.yml`, and the console side in [`docs/runbooks/staging-provisioning.md`](../../docs/runbooks/staging-provisioning.md)). Every default is production's value, so deploying either template with defaults renders exactly the stacks that were live before the parameterisation — the "prod" in the service template's *filename* is historical and kept because runbooks and the live stack reference it. Everything below this line describes **production**; staging differs only in the parameter values the staging workflow and runbook pass.

## Automated path (preferred)

```
gh workflow run deploy-prod.yml --repo TIMSInternational/organizational-climate-platform --ref main
```

This runs `.github/workflows/deploy-prod.yml`, which verifies its configuration is complete, tests the API, builds and pushes the image to ECR (stamping the commit SHA and build timestamp into the image, reported by `/version`), **applies EF Core migrations**, deploys the service stack passing **every template parameter explicitly**, gates on **20 consecutive** `/ready` probes (which round-trip Postgres, unlike the static `/health`), and finally asserts the live `/version` reports the commit the run just built.

Two things watch it from outside a deploy:

- **`.github/workflows/deploy-drift.yml`** runs daily and fails if the live `/version` commit has fallen more than 20 commits, or 14 days, behind `main` — the "all green, all stale" failure this project has hit twice (#158). It reuses `scripts/read-deployed-commit.sh`, the same reader the deploy's own assertion uses. Point it at a new hostname by setting the `PROD_API_BASE_URL` repository variable; it falls back to the App Runner URL at the bottom of this file.
- **`scripts/verify-prod-deploy-invariants.py`**, in CI's `deploy-path-lint` job, pins the properties of these two files that a linter cannot see: that the App Runner health check probes `/ready` rather than a literal, that the canary counts *consecutive* successes, and that the optional second CORS origin is droppable rather than empty. Each check is also run against a deliberately broken copy, so a check that has silently stopped looking at anything fails as loudly as a real regression.

### Configuration the automated path requires

Set these on the `production` GitHub environment before the first dispatch. The workflow's
first step fails in seconds if any is empty, rather than surfacing an opaque CloudFormation
error minutes in:

| Name | Kind | Notes |
|---|---|---|
| `AWS_ACCOUNT_ID` | variable | `747814092517` |
| `CORS_ALLOWED_ORIGIN` | variable | Exact production frontend origin |
| `CORS_ALLOWED_WILDCARD_ORIGIN` | variable | Vercel preview pattern |
| `CORS_ADDITIONAL_ALLOWED_ORIGIN` | variable, **optional** | A *second* exact origin, for the custom domain of #160. Leave unset and nothing is wired; the template drops the index-1 variable entirely rather than binding an empty origin. |
| `CORS_ADDITIONAL_ALLOWED_WILDCARD_ORIGIN` | variable, **optional** | A *second* wildcard pattern. Same rule, and here it is load-bearing: an empty wildcard pattern fails the host at startup, because `CorsOriginMatcher` rejects a pattern with no `*`. |
| `TRACKING_JWT_SECRET_ARN` | variable | Secrets Manager ARN |
| `DATABASE_CONNECTION_STRING_SECRET_ARN` | variable | Secrets Manager ARN (runtime). The secret it points at holds a **port 5432** (session pooler) string, same endpoint as the migration string — corrected 2026-08-10, closing #220. Only step 3 of "Arming the guard" is outstanding: `Database__RequireSessionPooler` is still `"false"`, so a regression to 6543 would warn rather than refuse to boot. |
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

**Status as of 2026-08-05.** The account-wide GitHub Actions billing block described in earlier
revisions of this file is **resolved** — workflows execute again. `CI` now runs on every PR and
every push to `main`, and its .NET job passes. One thing is still unproven:

- **`deploy-prod.yml` has never had a successful run — in fact it has never run at all, zero
  dispatches, lifetime.** It is `workflow_dispatch`-only and was never dispatched while billing
  was blocked. Every production deploy to date went through the manual path below.

The OIDC trust relationship, by contrast, **has now been read back from the live account** and
is correct. What earlier revisions of this file warned about was not what was actually wrong.

### The OIDC subject claim is ID-qualified (this is what broke the first deploy)

Earlier revisions of this file warned that the live `climate-project-github-deploy-prod` role
"may still trust the pre-rename repo `climate-project-api`", on the reasoning that a
CloudFormation parameter default only applies when the parameter is not supplied. That warning
was **checked against IAM on 2026-08-05 and disproven** — no entry in the live trust policy
names the old repository. The real cause was different, and more interesting.

GitHub now issues OIDC tokens whose `sub` claim carries an **ID-qualified** subject prefix:

```
repo:OWNER@<ownerId>/REPO@<repoId>:ref:refs/heads/main
```

not the bare `repo:OWNER/REPO:...` form that AWS's own documentation still shows. A trust policy
carrying only the name-based form can therefore **never match any token this repository
presents**, no matter how correct the repository name in it is. That, not a stale repo name, is
what failed the first production deploy at `sts:AssumeRoleWithWebIdentity` — and it is a failure
that looks identical to a credentials or permissions problem from the workflow log.

The live role was fixed by hand and trusts **four** subs:

```
repo:TIMSInternational@305569681/organizational-climate-platform@1317724282:ref:refs/heads/main
repo:TIMSInternational@305569681/organizational-climate-platform@1317724282:environment:production
repo:TIMSInternational/organizational-climate-platform:ref:refs/heads/main
repo:TIMSInternational/organizational-climate-platform:environment:production
```

**`climate-project-api-bootstrap.yml` now emits all four.** Until 2026-08-05 it emitted only the
name-based pair, which made the template *more dangerous than a stale one*: redeploying the
bootstrap stack would have quietly deleted the two ID-qualified entries and broken deploys
again, with no error at deploy time and a denial on the next dispatch. If you are reading a
checkout from before that fix, do not redeploy the bootstrap stack.

The numeric IDs live in two parameters, `GitHubOwnerId` (`305569681`) and `GitHubRepositoryId`
(`1317724282`). Both are **immutable** — they survive an org rename, a repository rename and a
transfer within the org — so the ID-qualified form also permanently removes the repo-rename
fragility the warning above was worried about. Re-derive them with either of:

```
gh api /repos/TIMSInternational/organizational-climate-platform --jq '{owner: .owner.id, repo: .id}'
gh api /repos/TIMSInternational/organizational-climate-platform/actions/oidc/customization/sub
```

The second returns the repository's `sub_claim_prefix`, i.e. the exact subject form GitHub will
mint — the authoritative answer if the two ever disagree. Measured 2026-08-05 it returns
`{"use_default": true, "use_immutable_subject": false, "sub_claim_prefix":
"repo:TIMSInternational@305569681/organizational-climate-platform@1317724282"}`. Note
`use_default: true`: the ID-qualified prefix is **GitHub's default**, not a customization
someone applied to this repository and not something that can be turned off here — which is why
a policy written from AWS's documented example could never have matched.

To read the live policy back:

```
aws iam get-role --role-name climate-project-github-deploy-prod \
  --query 'Role.AssumeRolePolicyDocument.Statement[].Condition' --output json
```

This requires credentials for the production account (`AWS_ACCOUNT_ID` repo variable,
`747814092517`). `scripts/verify-oidc-trust-subs.py` asserts, credential-free and on every PR
via the `deploy-path-lint` CI job, that the template still renders exactly those four subs; if
you change the trust policy on purpose, update the expected set there in the same commit.

Note that the resource names in the table below are **live infrastructure identifiers** and
still use the pre-rename `climate-project-api` prefix deliberately — renaming them orphans the
deployed stacks. Only the GitHub repository reference changed.

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

### Cause 1 — the runtime string pointed at the transaction pooler (**fixed 2026-08-10**)

Port 6543 is Supavisor's **transaction** pooler. Transaction mode assigns a different backend
to each statement. That is right for short-lived serverless clients that connect, run one
statement and disconnect; it is wrong for a long-running ASP.NET Core service, whose Npgsql
client-side pool holds connections open across statements and expects session state to persist
between them. The two pooling models fight, and the visible result is intermittent hangs.

The fix was to change that connection string's port from **6543 to 5432** — the session pooler.
Same host, same password, same `postgres.<project-ref>` username; **only the port changed**,
exactly as for the migration string described above. The value lives in **AWS Secrets Manager**
as `climate-project-api/prod/database-connection-string`, so no change to this repository could
have done it; it needed someone with write access to that secret.

**Done on 2026-08-10** (secret version `f22f6c08`, AWSCURRENT; the 6543 value is retained as
AWSPREVIOUS, so rolling back is a `put-secret-value` plus a redeploy). Verified by measurement
rather than by deploy status: **20 of 20 consecutive `/ready` probes returned 200**, median
~0.37s, and the transaction-pooler warning is **absent** from the App Runner log stream. #220
closed 2026-08-11.

The API still logs a **startup warning** naming #220 whenever it sees port 6543
(`DatabaseConnectionStringPolicy`, wired up in `src/ClimateProject.Api/Program.cs`). It remains
a warning rather than a hard failure only because step 3 below has not been taken.

#### Arming the guard: `Database:RequireSessionPooler`

Whether that warning is a warning or a **startup failure** is a per-deployment setting,
`Database:RequireSessionPooler`, in the same conditional shape as `GoogleAuth:Required`
(see `src/ClimateProject.Api/Infrastructure/StartupOptions.cs`). It is passed to App Runner as
the environment variable `Database__RequireSessionPooler` from
`infra/aws/climate-project-api-prod-service.yml`, where it is currently `"false"`.

The flag can only ever **escalate** the warning to a failure. There is no value of it that
silences the warning, so it is a ratchet rather than a mute button —
`DecideTransactionPoolerAction` never returns `None` for a transaction-pooler port, and a unit
test pins that.

Do these in order. Steps 1–2 need someone with write access to the secret; only step 3 is a
change to this repository. **All three are done — the guard is armed.**

1. ✅ **Flip the secret** — done 2026-08-10. `climate-project-api/prod/database-connection-string`
   moved from port 6543 to **5432**; host, username and password unchanged.
2. ✅ **Redeploy and verify** — done 2026-08-10. **20 of 20 consecutive** `/ready` probes
   returned 200, and the `TRANSACTION pooler` warning is **gone** from the App Runner logs. The
   defect alternates, so one green probe would have proved nothing; the absent warning is the
   stronger of the two signals, because it is the app reporting what value it actually read.
3. ✅ **Arm the guard** — done 2026-08-17, in its own commit and its own rollout as step 2's
   change specified. `Database__RequireSessionPooler` is `"true"` in
   `infra/aws/climate-project-api-prod-service.yml`: a connection string on 6543 now fails
   startup instead of logging, so the port cannot regress silently.

Two notes for whoever takes step 3, neither of which changes the order above:

- The **live stack does not carry this variable at all.** `climate-project-api-prod` was last
  updated 2026-08-05, before #298 added it, and the app defaults the flag to `false` when the
  variable is absent — so today's behaviour is correct by accident of the default. The deploy
  that flips it to `"true"` is also the first deploy that introduces it.
- That deploy can now **fail closed**, which is new and is the point. Since #221 the App Runner
  health check probes `/ready`, so a service that refuses to boot fails its health check and
  the rollout is rejected rather than reported successful. Before #221 the note here was the
  opposite warning: a bad flip would have passed a static `/health` and had to be caught by
  probing.

Doing step 3 before step 1 breaks the deploy — that is the whole reason the flag exists. Steps 1
and 3 are therefore two separate changes, never one: a CloudFormation deploy cannot write a
Secrets Manager value, so there is no way to move the secret and the flag together.

Each step's signal is pinned by a test in
`tests/ClimateProject.IntegrationTests/StartupValidationTests.cs`:

- `Transaction_pooler_port_warns_at_startup_when_session_pooler_is_not_required` and
  `Session_pooler_port_emits_no_transaction_pooler_warning` are what make step 2's log check
  meaningful — the first pins that the warning is emitted on 6543 (naming `TRANSACTION pooler`
  and #220, with `Port`/`ExpectedPort` as structured properties), the second that it stops on
  5432. Without them, "the warning is gone" could be true because the warning no longer exists.
- `Session_pooler_port_starts_cleanly_with_the_guard_armed` is what makes step 3 safe to take:
  it proves that once the port is right, arming the flag changes nothing about whether the host
  starts.

**Not covered by any of this:** nothing in the deploy pipeline inspects the runtime secret. The
`grep -qE '(^|[^0-9])6543([^0-9]|$)'` guard in `deploy-prod.yml` reads only
`MIGRATION_DATABASE_CONNECTION_STRING`, the GitHub Actions secret used for `dotnet ef database
update` — the runtime string is delivered straight from Secrets Manager to App Runner and never
passes through the workflow. Step 3 is therefore the only thing that would catch a regression
of the runtime port, which is why it should not be skipped once steps 1–2 are done.

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

## Health checks: `/health` is liveness, `/ready` is readiness

Two endpoints, two questions, and collapsing them back into one is the mistake to avoid:

| | asks | touches the database | who polls it |
|---|---|---|---|
| `/health` | is the process up? | **no** — a static literal | nothing automated; a human, and `GET /` redirects to it |
| `/ready` | can this instance serve? | **yes** — `SELECT 1` | App Runner's health check, and the deploy canary |

The App Runner health check points at **`/ready`** (#221). It used to point at `/health`, which
was defended on the grounds that a database-dependent probe lets a Postgres blip tear down a
healthy container. That is a real mechanism, but the trade was the wrong way round: `/health`
opens no connection, so an instance that has lost its database **passes forever** and is never
replaced or drained. The deploy canary catches a broken *rollout*, once; nothing caught an
instance that degraded afterwards.

The blip case is answered by the thresholds instead of by the path. In
`climate-project-api-prod-service.yml`:

| setting | value | why |
|---|---|---|
| `Interval` | 20 (App Runner's maximum) | every probe is now a real query, from every instance; at `MaxSize` 25 that is 1.25 queries/second against the connection budget above |
| `Timeout` | 5 | ~13× the 0.37s median measured in #220. The failure it must catch is a 30s hang, not slowness, so a tighter timeout only improves detection |
| `UnhealthyThreshold` | 5 | ~100s of **continuous** failure before replacement — long enough that a Supavisor failover does not start a churn |
| `HealthyThreshold` | 3 | at 1, a ~50%-intermittent instance is declared healthy on its first lucky 200. Costs 60s per rollout; 20 (the canary's bar) would cost 400s |

The thing to keep hold of when retuning any of them: **replacing an instance does not fix a
database outage.** A fresh instance fails the same probe, so thresholds tight enough to react
to a blip convert a slow database into a replacement loop.

`scripts/verify-prod-deploy-invariants.py` pins the path, the ranges, and the ~100s window, and
fails CI if a later edit quietly restores `/health` or a single-probe `HealthyThreshold`.

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
   > `CorsAdditionalAllowedOrigin` and `CorsAdditionalAllowedWildcardOrigin` **do** have a
   > default (`""`), so omitting them never fails a deploy. The catch is the other direction:
   > the same reuse rule means omitting them cannot **remove** an origin either. To take one
   > out of the allowlist, pass it explicitly empty — `CorsAdditionalAllowedOrigin=` — which
   > the CLI sends as an empty `ParameterValue` rather than `UsePreviousValue`, and the
   > template's condition then drops the environment variable entirely.
   >
   > **As of #189 the consequence of getting this wrong is worse than it used to be.** The
   > host now validates `InternalApiKey` and the connection string at startup
   > (`.ValidateOnStart()`). An unset value therefore means the service **does not boot**,
   > fails its App Runner health check, and the deploy fails outright. It no longer degrades
   > to per-request 500s on `/api/internal/*`. Prefer the automated path, which passes every
   > parameter explicitly and refuses to start if any is missing.

6. Confirm the service is healthy by checking the `ServiceUrl` stack output and hitting
   **`/ready`, not `/health`** — and hitting it **20+ times consecutively**, which is what the
   automated path's canary does. `/health` is a static literal and answers 200 from an instance
   that cannot reach Postgres at all; a single `/ready` 200 proves little, because #220's
   defect alternated. See "Health checks" above.

## Stack and resource name reference

| Resource | Production | Staging (#156, once provisioned) |
|---|---|---|
| Bootstrap stack | `climate-project-api-bootstrap` | `climate-project-api-staging-bootstrap` |
| Service stack | `climate-project-api-prod` | `climate-project-api-staging` |
| ECR repository | `climate-project-api` | `climate-project-api-staging` |
| App Runner ECR access role | `climate-project-apprunner-ecr-access-prod` | `climate-project-apprunner-ecr-access-staging` |
| GitHub OIDC deploy role | `climate-project-github-deploy-prod` | `climate-project-github-deploy-staging` |
| Live URL | https://bhgrdkd4gt.us-east-1.awsapprunner.com | — (created by the first staging deploy) |

The staging names are what `deploy-staging.yml` hardcodes and what the bootstrap
template renders from its staging parameter set; which AWS *account* they land in is a
decision recorded in `docs/runbooks/staging-provisioning.md`, not here.
