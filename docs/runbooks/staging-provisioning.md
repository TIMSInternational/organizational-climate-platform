# Staging provisioning runbook — #156

**Status: repo side DONE, console side NOT STARTED.** Every artifact staging needs from
this repository exists on `feat/156-staging-scaffold`: the two CloudFormation templates
are environment-parameterised (production defaults render the live prod stacks
byte-identically — proven by rendered diff, recorded in that branch's commit message),
`.github/workflows/deploy-staging.yml` mirrors the prod deploy including its canary, and
`scripts/verify-prod-deploy-invariants.py` fails CI if the two deploys ever drift apart.
What remains is console work that only a human with write access can do. This document
is that work, in order, each step with the probe that proves it took.

Grounded in console state read on **2026-08-15**: GitHub environments are `Preview` and
`production` only (`gh api repos/TIMSInternational/organizational-climate-platform/environments`);
the DEV AWS account `795965600143` has **no GitHub OIDC provider**
(`aws iam list-open-id-connect-providers` → `[]`); the Supabase project is
`lzhfnjfsdwdywwnlqgqq` with **zero branches**; the Vercel team runs the web app as
project `climate` (production URL `https://web-one-green-86.vercel.app`).

Nothing in this runbook touches production. The staging deploy role's trust policy and
permissions are scoped so that even a misdispatched staging workflow cannot reach the
prod stack — that is a property of the bootstrap template, not of care taken on the day.

---

## Two decisions before any clicks

### Decision box 1 — which AWS account hosts staging

| | Option A: DEV account `795965600143` | Option B: prod account `747814092517` |
|---|---|---|
| Isolation | **Full** — separate IAM, quotas, billing, blast radius | Shared account; the staging role is IAM-scoped away from prod, but quotas, billing and console access are shared |
| Extra setup | **Create the GitHub OIDC provider** (step 4a — verified absent 2026-08-15) | None — the provider exists (prod deploys depend on it) |
| ECR repository name | `climate-project-api-staging` (default would also be free, but keep names unambiguous) | `climate-project-api-staging` (**required** — the default collides with the prod repo) |
| Who can already see it | Federico's CLI is authenticated here today | Console/CLI access is the production credential set |

Either way, the workflow itself only needs `AWS_ACCOUNT_ID` set on the `staging` GitHub
environment — nothing else in the repo changes with this decision.

Approximate steady cost of the staging App Runner service (us-east-1 public pricing,
verify in the calculator): ~$2.60/mo provisioned memory while idle
(0.5 GB × $0.007/GB-hr) plus $0.064/vCPU-hr + $0.007/GB-hr while serving requests —
under ~$15/mo for a service that mostly sits idle. ECR storage ~$0.10/GB-month.

> **Decide:** account `____________`  date `________`  by `________`

### Decision box 2 — may real employee responses be copied into staging?

This is a privacy decision, not a technical one, so it is presented as options with
consequences rather than a recommendation. The facts that make it matter: survey
responses are anonymous by design (no user id on an anonymous response), **but**
open-ended free-text answers can identify their author in ways no schema prevents, and
department + demographic fields at small N can re-identify — the anonymity floor of 5
exists in the product precisely because of this. A full copy also carries the real
`users` table: names, emails, and bcrypt password hashes. Staging is by definition the
weaker environment — more shared logins, test credentials written into docs, laxer
rotation — so whatever is copied there should be assumed more exposed than in prod.

| Option | What it means | Consequences |
|---|---|---|
| **A — never** | Staging data is EF-migrated schema + synthetic seed only | Safest. Staging rehearses logic and deploys, not data-scale realism. Anyone may hold staging credentials. |
| **B — scrubbed subset** | Copy structure-preserving data with free text and PII scrubbed | Requires a scrubbing tool that **does not exist in this repo today**; reliably scrubbing names out of open-ended answers is the hard, unsolved part. Do not pick this imagining the tool is a small task. |
| **C — full copy** | Production rows copied as-is (e.g. via `pg_dump`/restore or the `tools/ClimateProject.DataMigration` path) | Maximum realism. Every staging credential holder can read employees' verbatim survey comments; a staging leak is a production-data leak; real emails + password hashes live in the weaker environment. |

Note for option A/B: a Supabase **branch does not clone production rows** — branches are
reseeded from migrations/seed only ("data isn't migrated between branches", Supabase
branching docs, read 2026-08-15) — so choosing a branch in step 2 does not by itself
decide this box; copying data is always a separate, deliberate act.

> **Decide:** option `____`  date `________`  by `________`

---

## Step 1 — create the GitHub `staging` environment

The environment does not exist (verified 2026-08-15), and `deploy-staging.yml` refuses
to do anything useful without it: its first step fails in seconds naming each missing
value. The repo is public, so environments are available on the current plan.

```
gh api --method PUT repos/TIMSInternational/organizational-climate-platform/environments/staging
```

(Settings path: repo → Settings → Environments → New environment → `staging`.)

Then create its variables and one secret. The ARNs and origins come from steps 2–5, so
either do this step last-but-one, or create the environment now and fill values as they
are produced — the preflight check makes a premature dispatch loud, not dangerous.

| Name | Kind | Value comes from |
|---|---|---|
| `AWS_ACCOUNT_ID` | variable | Decision box 1 |
| `CORS_ALLOWED_ORIGIN` | variable | Step 5 (staging Vercel URL, `https://` + domain, no trailing slash) |
| `CORS_ALLOWED_WILDCARD_ORIGIN` | variable | Step 5 (preview pattern, must contain `*`) |
| `CORS_ADDITIONAL_ALLOWED_ORIGIN` | variable, optional | leave unset unless a second exact origin exists |
| `CORS_ADDITIONAL_ALLOWED_WILDCARD_ORIGIN` | variable, optional | leave unset; an empty **wildcard** would fail the host at startup, and the template drops unset slots entirely (#160) |
| `TRACKING_JWT_SECRET_ARN` | variable | Step 3 |
| `DATABASE_CONNECTION_STRING_SECRET_ARN` | variable | Step 3 |
| `INTERNAL_API_KEY_SECRET_ARN` | variable | Step 3 |
| `MIGRATION_DATABASE_CONNECTION_STRING` | **secret** | Step 2 (session pooler, port 5432 — the guards reject 6543 and `db.<ref>.supabase.co` by name) |

```
gh variable set AWS_ACCOUNT_ID --env staging --repo TIMSInternational/organizational-climate-platform --body "<account id>"
# ...same shape for each variable above...
gh secret set MIGRATION_DATABASE_CONNECTION_STRING --env staging --repo TIMSInternational/organizational-climate-platform
# (paste the value at the prompt; do not put it in shell history with --body)
```

**Verify:** `gh api repos/TIMSInternational/organizational-climate-platform/environments --jq '.environments[].name'`
lists `staging`; `gh variable list --env staging` and `gh secret list --env staging`
show every row of the table above (secrets show names only, which is all that is needed).

## Step 2 — the staging database (Supabase)

The app uses Supabase as plain Postgres — it does its own auth (bcrypt in its own
`users` table) and its schema arrives exclusively via EF Core migrations, which the
deploy workflow applies **before** rollout. So do not hand-create any schema; an empty
database plus a green deploy is the correct end state.

| | Option A: separate Supabase project | Option B: persistent branch on `lzhfnjfsdwdywwnlqgqq` |
|---|---|---|
| Isolation | Full: own pooler, own dashboard, own credentials | Same dashboard and org; branch has own connection strings, but branch controls (merge/reset/delete) live one click from production's |
| Cost | Micro compute ≈ **$10/mo** (billed per project; the org's $10/mo compute credit applies to projects but is single and presumably consumed by prod) | **$0.01344/hr ≈ $9.81/mo** while it exists (Micro); **not** covered by Spend Cap; compute credits do **not** apply to branch compute (Supabase docs, 2026-08-15) |
| Fit for this repo | Clean — it is just another Postgres | Awkward: branching's migration/seed machinery expects a `supabase/` directory this repo does not have; the branch would simply be an empty Postgres the EF migrations then fill — workable, but you pay branch semantics (auto-pause, reset-from-seed on recreate) for nothing |
| Region | **us-east-1**, same as everything else | inherits |

Costs are the same order either way; the meaningful difference is isolation and the
misclick surface. Both are ~$120/yr; killing it is one console action in both cases.

Whichever is chosen, record TWO connection strings, both pointing at the **session
pooler** (the same host, **port 5432**, username `postgres.<project-ref>` — never 6543,
and never `db.<ref>.supabase.co`, which is IPv6-only and unreachable from GitHub
Actions; the full argument is in `infra/aws/README.md`):

- runtime string → Secrets Manager (step 3)
- migration string → the `MIGRATION_DATABASE_CONNECTION_STRING` secret (step 1)

They may be identical values; they stay two entries because they live in two stores.

**Verify:** from a workstation, `psql "<session-pooler string>" -c 'select 1;'` returns
one row. (From CI this is proven later by the deploy's migration step.)

## Step 3 — Secrets Manager entries in the chosen account

Three secrets, named to mirror prod's convention (`docs/security/rotation-inventory.md`):

| Name | Value |
|---|---|
| `climate-project-api/staging/tracking-jwt-secret` | **Fresh random value — never prod's.** Sharing the signing key would let staging-minted tokens authenticate against prod and vice versa. |
| `climate-project-api/staging/database-connection-string` | The runtime session-pooler string from step 2 (port 5432). May carry its own `Maximum Pool Size`; if absent the app applies its default of 10. |
| `climate-project-api/staging/internal-api-key` | Fresh random value. Only shared with a *staging* climate-tracking, if and when one exists. |

```
aws secretsmanager create-secret --name climate-project-api/staging/tracking-jwt-secret --secret-string "$(openssl rand -base64 48)"
# database-connection-string and internal-api-key likewise; paste connection string via console or file://, not shell history
```

Copy each resulting ARN into the step-1 variables (`TRACKING_JWT_SECRET_ARN`,
`DATABASE_CONNECTION_STRING_SECRET_ARN`, `INTERNAL_API_KEY_SECRET_ARN`).

**Verify:** `aws secretsmanager describe-secret --secret-id <name>` returns metadata for
each (never `get-secret-value` in a shared terminal). If any is wrong or missing, the
service fails at startup by design (#189: `ValidateOnStart`) and the deploy's canary
rejects the rollout — the failure is loud and early, not a degraded staging.

## Step 4 — bootstrap stack (deploy role, ECR, App Runner access role)

### 4a — only if Decision 1 chose the DEV account: create the GitHub OIDC provider

Verified absent on 2026-08-15, and nothing can assume a web-identity role without it:

```
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

(The CLI requires a thumbprint argument; AWS validates GitHub's OIDC certificates
against trusted root CAs regardless, so the value is required-but-not-relied-upon. The
console path — IAM → Identity providers → Add provider → OpenID Connect — needs no
thumbprint at all.)

**Verify:** `aws iam list-open-id-connect-providers` now shows one entry ending
`oidc-provider/token.actions.githubusercontent.com`.

### 4b — deploy the staging bootstrap stack

The stack name is load-bearing: `deploy-staging.yml` reads outputs from exactly
`climate-project-api-staging-bootstrap`.

```
aws cloudformation deploy \
  --stack-name climate-project-api-staging-bootstrap \
  --template-file infra/aws/climate-project-api-bootstrap.yml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    RepositoryName=climate-project-api-staging \
    EnvironmentName=staging \
    ResourceNameSuffix=staging \
    ImageTagPrefix=staging-
```

This is the SAME template file as production's bootstrap — the staging values above are
what make it render staging names, an `environment:staging` trust policy, and IAM
permissions that reach only the `climate-project-api-staging` stack/service/instance
role. Run it with credentials for the chosen account (it must be run by a human or a
role with IAM-create rights; the GitHub deploy roles deliberately cannot create roles
beyond the instance role).

**Verify:**

```
aws cloudformation describe-stacks --stack-name climate-project-api-staging-bootstrap \
  --query 'Stacks[0].Outputs' --output table
aws iam get-role --role-name climate-project-github-deploy-staging \
  --query 'Role.AssumeRolePolicyDocument.Statement[].Condition' --output json
```

Four outputs present, and the trust conditions include the two `environment:staging`
subs (ID-qualified and name-based) — not `environment:production`.

## Step 5 — Vercel staging project for web

On the same team as `climate`. Create project `climate-staging` importing this
repository: root directory `web`, framework Vite (`npm run build`), same as `climate`.
A second Vercel project itself costs nothing; usage is billed as usual.

Environment variables on `climate-staging` (Production scope):

| Name | Value |
|---|---|
| `VITE_API_BASE_URL` | the staging App Runner URL — **known only after step 6**, so set a placeholder now and return here |
| `VITE_GOOGLE_CLIENT_ID` | optional; omit and the Google button is simply not rendered. If set, the staging origin must also be added to the Google OAuth client's authorized origins (Google Cloud console). |

Then fill the step-1 CORS variables from what Vercel assigned:

- `CORS_ALLOWED_ORIGIN` = `https://<assigned domain>` (e.g. `https://climate-staging.vercel.app` — use what the dashboard actually shows)
- `CORS_ALLOWED_WILDCARD_ORIGIN` = `https://*.vercel.app` (or a tighter project-scoped pattern; it must contain `*`)

**Verify:** the project's Production deployment serves the app shell (login page
renders; API calls will fail until step 7 — that is expected).

## Step 6 — first staging deploy

Everything from steps 1–5 is now in place, so:

```
gh workflow run deploy-staging.yml --repo TIMSInternational/organizational-climate-platform --ref main
```

The workflow order is: preflight (names any missing config in seconds) → tests → image
build/push (`staging-<sha>`) → EF migrations against the staging DB (the empty database
gets its entire schema here) → CloudFormation deploy of the service stack
`climate-project-api-staging` from `infra/aws/climate-project-api-prod-service.yml`
with `EnvironmentName=staging AspNetCoreEnvironment=Staging` → **20-consecutive**
`/ready` canary → deployed-commit assertion.

**Verify:** the run is green end to end; then from any machine:

```
curl -s https://<staging-apprunner-host>/version
```

reports the dispatched commit SHA and `"environment": "Staging"` — the honest label is
the point of the `AspNetCoreEnvironment` parameter. Read the host from the stack's
`ServiceUrl` output (`aws cloudformation describe-stacks --stack-name climate-project-api-staging`).

## Step 7 — wire web to API and smoke

1. Set `VITE_API_BASE_URL` on `climate-staging` to `https://<staging-apprunner-host>`
   and redeploy the Vercel project (Vite inlines env at build time — a redeploy is
   required, not optional).
2. Log in on the staging web URL; watch the browser console for CORS errors (there
   should be none — if there are, the `CORS_ALLOWED_ORIGIN` value and the actual origin
   disagree, usually a trailing slash or `www`).
3. If Decision 2 chose synthetic data: seed it now via the app/API as admin.

**Verify:** an end-to-end action (create survey → respond → see results) works against
staging, and prod's `/version` still reports the same commit it did this morning —
staging provisioning must be a no-op for production.

---

## Deliberately out of scope, so nobody waits for it

- **Drift monitoring for staging.** `deploy-drift.yml` watches production only. If
  staging later deserves one, the `PROD_API_BASE_URL`-style override pattern is the
  template.
- **A custom domain for staging.** The App Runner and Vercel generated hostnames are
  enough for a rehearsal environment.
- **`Database__RequireSessionPooler` stays `"false"`,** same as prod (the README's
  "Arming the guard" step 3 remains open). Staging is in fact the right place to
  rehearse flipping it to `"true"` before prod does — but that is that ratchet's
  runbook, not this one.
- **Copying any production data.** Whatever Decision box 2 says, the copy itself is a
  separate, deliberate operation with its own review — this runbook provisions the
  environment, empty.
