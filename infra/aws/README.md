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
| `DATABASE_CONNECTION_STRING_SECRET_ARN` | variable | Secrets Manager ARN (runtime; transaction pooler, 6543) |
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

| Endpoint | Host | Port | Mode | Usable for EF migrations? |
|---|---|---|---|---|
| Transaction pooler | `aws-0-<region>.pooler.supabase.com` | 6543 | multiplexes sessions across backends | **No** — see below |
| **Session pooler** | `aws-0-<region>.pooler.supabase.com` | **5432** | one dedicated backend per session | **Yes — use this** |
| "Direct connection" | `db.<project-ref>.supabase.co` | 5432 | straight to Postgres | Works locally, **never from CI** |

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
