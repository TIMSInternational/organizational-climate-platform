# Staging provisioning runbook — #156

**Status: repo side DONE and MERGED. Console side PART DONE 2026-09-02 — AWS and GitHub are
provisioned; the database is blocked on a purchase decision. See "Provisioning status" below.** Every artifact staging
needs from this repository is now on `main` (commit `3856acf`): the two CloudFormation templates
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

## Provisioning status — 2026-09-02

Both decisions are made and **steps 1, 3 (partial) and 4 are done**. What remains is one
purchase decision and the steps that depend on it.

| Step | State | Evidence |
|---|---|---|
| 1 — GitHub `staging` environment | **DONE** | environment exists; `AWS_ACCOUNT_ID`, `TRACKING_JWT_SECRET_ARN`, `INTERNAL_API_KEY_SECRET_ARN` set |
| 2 — staging database | **BLOCKED** — see below | — |
| 3 — Secrets Manager | **2 of 3 DONE** | `tracking-jwt-secret` and `internal-api-key` created with fresh random values in `795965600143`; `database-connection-string` waits on step 2 |
| 4a — GitHub OIDC provider (dev account) | **DONE** | `arn:aws:iam::795965600143:oidc-provider/token.actions.githubusercontent.com` |
| 4b — bootstrap stack | **DONE** | `climate-project-api-staging-bootstrap`, four outputs present, trust policy scoped to `environment:staging` |
| 5, 7, 8 — Vercel, web wiring, first user | **NOT STARTED**, and not required by #159 | the rollback rehearsal exercises the API path only |
| 6 — first staging deploy | waits on step 2 | |

### What step 2 is blocked on, precisely

**The NexaDev organization (`lbxqfmlcxervtttrspjv`) already holds two active projects** —
`tims-ats` and `organizational-climate-platform`. That is exactly the free-plan cap this runbook
warns about two paragraphs below, and it is now live rather than hypothetical.

So creating a staging project is a **purchase decision, not a click**:

- If the org is on **Free**, a third project is refused outright.
- If the org is on **Pro**, it succeeds and starts a **$10/mo** Micro-compute charge on an
  organization that also bills a different client's product (`tims-ats`).

Either way it needs an owner who can commit that spend. The alternative in the table below —
a persistent branch on the climate platform's own project — costs about the same
(~$9.81/mo), is not covered by the Spend Cap, and puts branch controls one click from
production's.

**Nothing else is waiting on anything else.** The moment a staging connection string exists:
create `climate-project-api/staging/database-connection-string`, set
`DATABASE_CONNECTION_STRING_SECRET_ARN` and the `MIGRATION_DATABASE_CONNECTION_STRING` secret,
and `deploy-staging` can run.

### A correction to this document

Option B below named `lzhfnjfsdwdywwnlqgqq` as the project to branch. **That is the `tims-ats`
project, not this one** — a different client's product. The climate platform is
`uleeeziiceduvmiftgby`. Corrected in the table; recorded here because acting on the old value
would have branched the wrong product.

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

**Monthly cost, at verified rates.** Every rate below was read from the AWS Price List
API on **2026-08-24** for `us-east-1` — not from the pricing calculator, and not from
memory. The two "not incurred" rows are the ones people usually forget to check:

| Line item | Verified rate | Staging assumption | $/mo |
|---|---|---|---|
| App Runner provisioned memory | $0.007 /GB-hr | 0.5 GB, billed continuously at `MinSize` 1 | **$2.56** |
| App Runner active vCPU | $0.064 /vCPU-hr | 0.25 vCPU, billed only while requests are processed — see caveat | $0.00–$11.68 |
| App Runner auto-deployment pipeline | $1.00 /pipeline/mo | **not incurred** — the template sets `AutoDeploymentsEnabled: false` | $0.00 |
| App Runner build minutes | $0.005 /min | **not incurred** — we push prebuilt images to ECR; this charge is for source-based builds | $0.00 |
| Secrets Manager secrets | $0.40 /secret/mo | the 3 staging secrets from step 3 | **$1.20** |
| Secrets Manager API requests | $0.05 /10k requests | read at instance start, not per request | ~$0.00 |
| ECR storage | $0.10 /GB-mo | ~2–4 GB once the 40-image lifecycle cap settles (base layers dedupe across tags) | $0.20–$0.40 |
| Supabase Micro compute | $10 /mo | one staging project or branch (step 2) | **$10.00** |
| Vercel `climate-staging` | $0 | a second project adds no fee; usage bills to the team plan | $0.00 |
| | | | **≈ $14–$26/mo** |

Two honest caveats, because the vCPU row is the only volatile line:

- **I am guessing whether App Runner health-check probes bill as active vCPU, and the
  guess is worth $11/mo.** The service is probed every 20 seconds forever
  (`Interval: 20` in the service template). If probes count as "actively processing
  requests" then 0.25 vCPU is billed essentially continuously —
  0.25 × $0.064 × 730 = **$11.68/mo** — and staging lands near $26 rather than $14.
  AWS documents CPU as billed while actively processing requests without saying which
  side of that line a health check falls on. **Settle it by reading the first month's
  Cost Explorer line for `USE1-AppRunner-vCPU-hours`**; do not budget on either figure
  until you have.
- The $2.56 memory row is a **floor, not an estimate.** It is charged for as long as the
  service exists, whether or not anyone opens staging all month. Pausing the App Runner
  service stops it; deleting the stack stops it and the ECR line too.

Neither figure is large. It is written down because a recurring charge needs a named
owner before it starts rather than after.

> **DECIDED:** account **`795965600143` (Option A, the DEV account)**  date `2026-09-02`  by `Federico`
>
> Chosen for full isolation. Step 4a was required and has been done.

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

> **DECIDED:** option **`A` — never; synthetic seed only**  date `2026-09-02`  by `Federico`
>
> No production rows are copied to staging, now or later. Any change to this is a new privacy
> decision and belongs in this box, not in a script.

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

| | Option A: separate Supabase project | Option B: persistent branch on `uleeeziiceduvmiftgby` |
|---|---|---|
| Isolation | Full: own pooler, own dashboard, own credentials | Same dashboard and org; branch has own connection strings, but branch controls (merge/reset/delete) live one click from production's |
| Cost | Micro compute ≈ **$10/mo** (billed per project; the org's $10/mo compute credit applies to projects but is single and presumably consumed by prod) | **$0.01344/hr ≈ $9.81/mo** while it exists (Micro); **not** covered by Spend Cap; compute credits do **not** apply to branch compute (Supabase docs, 2026-08-15) |
| Fit for this repo | Clean — it is just another Postgres | Awkward: branching's migration/seed machinery expects a `supabase/` directory this repo does not have; the branch would simply be an empty Postgres the EF migrations then fill — workable, but you pay branch semantics (auto-pause, reset-from-seed on recreate) for nothing |
| Region | **us-east-1**, same as everything else | inherits |

Costs are the same order either way; the meaningful difference is isolation and the
misclick surface. Both are ~$120/yr; killing it is one console action in both cases.

**The free-tier project cap — check this before you click "New project".** #156's own
body warns about it, and it has been hit on this account before. Supabase's Free plan
allows **two active projects per organization**, so if the org is on Free and already has
two, creating a staging project fails outright; the fix is to delete a dead project or
move the org to Pro. There is a second, nastier edge: a Free-plan project **pauses after
about a week of inactivity** and needs a manual restore. Staging is used in bursts — a
week around the ETL dry run, a week around cutover — which is precisely the pattern that
trips it, and a paused staging database fails `/ready`, which fails the deploy canary,
which reads as a broken deploy rather than a paused database. *(I am reporting the
two-project cap and the ~7-day pause from general knowledge of the Free plan, not from a
reading of this org's billing page — confirm both on the plan page before relying on
them.)* The **$10/mo Micro compute** line in the cost table above is the paid answer to
both, and is why that table budgets staging as a paid project rather than a free one.

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

### 5a — turn OFF Vercel Deployment Protection

**Vercel turns Deployment Protection on by default for new projects**, and #156's body
calls this out for a reason. With it on, every request to `climate-staging` — including
from a browser already logged in to Vercel, and including `curl` — is answered with a
**302 to a Vercel SSO login** instead of the app. It does not present as a protection
setting; it presents as a broken deployment, and it will be misdiagnosed as a bad build
or a bad CORS origin for an hour before anyone thinks to check a toggle.

Settings → Deployment Protection → set **Vercel Authentication** to **Disabled** for
Production (and for Preview too, if preview URLs are to be shared with the client).

**Verify from a terminal, not a browser** — an authenticated browser session masks
exactly this failure:

```
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://<staging-domain>/
```

`200` with an empty redirect URL means protection is off. A `302` toward
`vercel.com/sso-api...` means it is still on.

> Leaving it **on** is a defensible choice — staging will hold logins you would rather
> not expose — but then it has to be a *deliberate* choice, and step 7's smoke test must
> be run from an authenticated browser session. What must not happen is discovering it by
> accident at the moment someone is trying to demo.

### 5b — `web/vercel.json` hardcodes PRODUCTION's API host, and staging inherits it

**Found 2026-08-24; not previously recorded anywhere.** `web/vercel.json` sits at the
`web/` root, so **every Vercel project that imports this repository with root directory
`web/` gets it — `climate-staging` included.** It contains:

```
"Content-Security-Policy-Report-Only":
  "... connect-src 'self' https://bhgrdkd4gt.us-east-1.awsapprunner.com; ..."
```

That host is **production's** App Runner service. Vercel does not interpolate environment
variables into `vercel.json` headers, so this cannot be made per-environment by setting a
variable on `climate-staging`; it is a literal shipped to whichever project builds the
file.

Today the damage is cosmetic, because the header is
`Content-Security-Policy-**Report-Only**`: nothing is blocked, but staging's browser
console fills with a CSP violation for every call staging makes to its own API. That
noise is not free — it is the same console step 7.2 asks you to watch for CORS errors.

The damage if the header is ever promoted to an enforcing `Content-Security-Policy` — a
natural pre-go-live hardening step, and one this project is likely to take — is not
cosmetic, and it fails in the backwards direction: staging's front end would be
**blocked from reaching staging's API** while remaining **permitted to reach
production's**.

**This was not fixed here: `web/` is owned by another lane and was not edited.** The fix
is a human choice between two shapes:

1. **Move the CSP out of `vercel.json`**, emitting it from the app or from a per-project
   Vercel header override so the API origin can vary by environment. Correct; larger.
2. **Widen `connect-src` to list both hosts.** One line, works immediately, but it
   permanently grants every environment permission to talk to production's API. Fine
   under a Report-Only header; think harder before doing it under an enforcing one.

Either way, note that `web/.env.example` also defines `VITE_TRACKING_API_BASE_URL`: if the
tracking service is ever wired to the web app (step 9), its host needs a `connect-src`
entry too, in every environment.

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
3. **You cannot "log in as admin" yet — there is no admin, and no way to make one
   through the product.** Go to step 8 before attempting anything in the product; then
   return here.

**Verify:** an end-to-end action (create survey → respond → see results) works against
staging, and prod's `/version` still reports the same commit it did this morning —
staging provisioning must be a no-op for production.

## Step 8 — bootstrap the first user (staging is UNREACHABLE without this)

**Found 2026-08-24, and it is a hard blocker on two of #156's acceptance criteria**
— "staging API, database and frontend all reachable", and "usable as the target for the
ETL dry run". The earlier revision of step 7.3 ("seed it now via the app/API as admin")
is **not executable as written**: you cannot act as an admin, because a freshly
EF-migrated staging database contains no admin and the product offers no way to create
one.

The chicken-and-egg, each half verified in source on 2026-08-24:

- **No migration seeds any data.**
  `grep -rln "InsertData" src/ClimateProject.Infrastructure/Migrations/*.cs` returns
  nothing. A migrated database is entirely empty — zero companies, zero users.
- **No host-side bootstrap exists.** Nothing in `src/ClimateProject.Api/Program.cs`
  seeds or ensures a first user.
- **`POST /api/auth/signup` cannot be the way in, and fails twice over.** It resolves a
  company by email domain first —
  `db.Companies.FirstOrDefaultAsync(c => c.EmailDomain == domain)`
  (`src/ClimateProject.Api/Endpoints/AuthEndpoints.cs:134`) — and returns **404** when
  there is none, which on an empty database is always. And even on success it always
  mints `Role = Roles.Employee` (same file, lines 148 and 230). It can never produce an
  administrator.
- **Creating a company requires an authenticated administrator**, which is the thing you
  do not have.

So the first user must be made **outside the product**, with SQL against the staging
database. The recipe below deliberately does **not** hand-write a bcrypt hash: it lets
the application hash the password on its own signup path and only corrects the role
afterwards, so there is no second copy of the hashing parameters to get wrong.

> **Two schema facts that bite anyone writing this SQL from memory**, both read from
> `src/ClimateProject.Infrastructure/Migrations/ClimateProjectDbContextModelSnapshot.cs`:
> **table names are snake_case (`companies`, `users`) while column names are quoted
> PascalCase (`"Id"`, `"Name"`, `"Role"`).** Unquoted `Id` folds to lowercase `id` and
> errors.

**8.1 — insert exactly one company**, carrying the email domain you intend to sign up
under:

```
psql "<staging session-pooler string>" <<'SQL'
INSERT INTO companies ("Id", "Name", "EmailDomain", "CreatedAt")
VALUES (gen_random_uuid(), 'TIMS Staging', 'timsint.com', now());
SQL
```

Only `"Name"` is `IsRequired` on this entity; `"Country"`, `"Industry"`, `"Size"` and
`"SubscriptionTier"` are nullable and are omitted on purpose, so the row is visibly a
bootstrap artifact rather than something pretending to be real.

**8.2 — sign up through the running staging API**, so the password is hashed by the same
code that will later verify it:

```
curl -sS -X POST https://<staging-apprunner-host>/api/auth/signup \
  -H 'content-type: application/json' \
  -d '{"email":"staging-admin@timsint.com","name":"Staging Admin","password":"<fresh password>"}'
```

The domain after the `@` must equal the `"EmailDomain"` inserted in 8.1, or this returns
404 with the "no company for domain" message.

**8.3 — promote that one row to `super_admin`:**

```
psql "<staging session-pooler string>" <<'SQL'
UPDATE users SET "Role" = 'super_admin', "UpdatedAt" = now()
WHERE "Email" = 'staging-admin@timsint.com';
SQL
```

`'super_admin'` is the literal wire value of `Roles.SuperAdmin`
(`src/ClimateProject.Application/Auth/Roles.cs:5`); the five valid values are
`super_admin`, `company_admin`, `leader`, `supervisor`, `employee`. A typo here does not
error — it produces a user with an unrecognised role and a confusing spray of 403s.

Nothing needs to touch `"SecurityStamp"` (it defaults to `gen_random_uuid()` in the
database) or `"SearchVector"` (a computed column).

**8.4 — log in on the staging web URL as that user.** From here the rest is reachable
through the product: departments, demographic fields, surveys, and the bulk import that
creates the remaining population.

**Verify:** `POST /api/auth/login` with those credentials returns a token, and the
staging front end renders admin navigation rather than employee navigation.

> **The isolation check, and this is the criterion #156 is strictest about.** The
> password chosen in 8.2 must not be one that exists in production, and the
> `climate-project-api/staging/*` secrets from step 3 must be freshly generated — never
> copies of production's. The danger with `tracking-jwt-secret` is concrete, not
> theoretical: a shared signing key means a token minted by staging **verifies in
> production**, which turns "somebody has a staging login" into "somebody has a
> production login". Step 3 states this; step 8 is where it is easiest to violate, by
> reaching for a password you already know.

**8.5 — populate beyond the first user.** With an admin in hand, Decision box 2 option A
(synthetic only) is reachable entirely through the product's own APIs: create departments
and demographic fields, then use the bulk import (`src/ClimateProject.Api/Endpoints/BulkImportEndpoints.cs`)
to create the population, then create and run a survey.

**CORRECTED 2026-09-05. This step used to say "there is no seed script in this repository
… budget it as real work". Two exist, and they already do this job.** `CLAUDE.md` names
both as the sanctioned way to seed:

| Script | Fills | Host argument |
|---|---|---|
| `scripts/seed-local.mjs` | the **tracking** module — nodos, personas, action plans in all three semáforo states | `--api` (default `http://127.0.0.1:5080`), `--tracking` (default `http://localhost:5091`), plus `--email` / `--password` |
| `scripts/seed-surveys.mjs` | the **climate** side — three closed waves with real per-department scores, one open survey, a distribution and a template | `--api` (same default) |

Neither is local-only. Every request in both goes through one helper whose URL is built
from `${API}` / `${TRACKING}`; `grep -n '127\.0\.0\.1\|localhost'` over the two files
returns **only the `parseArgs` defaults and the usage comments** — no hardcoded host in any
call site. So pointing them at staging is `--api https://<staging-host>`, not a rewrite.

They also already satisfy Decision box 2 option A on their own terms: both create every row
**through the endpoints the UI calls**, never by `INSERT`, which is the property that makes
the seeded data a shape the application can actually produce. And `seed-local.mjs` is
idempotent by design — plans carry a marker in the description and are matched on it before
anything is created — so a re-run does not pile up duplicates.

**What is genuinely left here, and it is smaller than a script:**

1. **Neither has ever been run against a non-localhost origin.** Origin-agnostic by reading
   is not the same as exercised over TLS against a remote host; expect the first run to be
   the test. `seed-surveys.mjs` signs in as twenty-four respondents and is paced by the
   **20/min auth rate limit**, so budget ~2 minutes and do not assume a stall is a hang.
2. **The tracking half has no staging target.** `--tracking` needs a deployed tracking
   service, and there is none in any environment (Step 9). Until then `seed-local.mjs`'s
   tracking rows cannot be seeded anywhere but a local stack.
3. **The account arguments must change.** Both default to `@acme.test` / `Local1234!`,
   which are local-stack credentials. Staging gets its own — and per step 3, never a
   password reused from production.

Two things are known to make a synthetic seed *look* successful while leaving every
dashboard empty, and both are worth re-deriving before seeding rather than after:
responses must clear the **anonymity floor of 5** per reporting group before results
render at all, and respondents must be **authenticated** for a department to be attached
to their response — an anonymous response carries no user id by design, so a population
seeded as anonymous respondents yields surveys that have responses and a climate map with
nothing on it.

## Step 9 — the parity gap this runbook cannot close: `services/tracking-api`

**Staging cannot honestly claim "production parity" while this is true — though the reason
is that *production* has no parity with the repository either.**

**CORRECTED 2026-09-05. The table below used to read "no deployment path to any
environment at all", verified 2026-08-24. Every artifact it listed as missing was created
two days later**, by `8463027a` (`infra(219): a production deployment path for
services/tracking-api`, 2026-08-26). The gap is real but it is no longer an authoring gap:

| Artifact | 2026-08-24 | Now | The check |
|---|---|---|---|
| Deploy workflow | No | **`deploy-tracking-prod.yml`** | `grep -rln "tracking-api\|ClimateTracking" .github/workflows/*.yml` → `ci.yml`, `deploy-tracking-prod.yml` |
| Dockerfile | No | **`services/tracking-api/Dockerfile`** | `find . -name "Dockerfile*"` → also `./Dockerfile`, `./Dockerfile.workers` |
| CloudFormation | No | **`climate-tracking-api-bootstrap.yml` + `climate-tracking-api-prod-service.yml`** | both in `infra/aws/` — the "sibling template" option below, taken |

`services/tracking-api` is a second .NET service with its own solution
(`ClimateTracking.slnx`), five projects and its own test suite.

**What is still true, and it is now a provisioning gap rather than a missing artifact.**
The service is deployed in **no** environment. `deploy-tracking-prod.yml` has exactly
**one lifetime run** — `2026-08-27T21:21:19Z`, conclusion **failure** — and it failed at its
**third step, `Verify deploy configuration is present`**, the first gate in the file.
**Thirteen of the fourteen steps after it are recorded as `skipped`**, including
`Test tracking API`, `Build and push tracking API image` and `Apply EF Core migrations`;
the fourteenth, `Upload the migration SQL`, is an always-run artifact step that succeeded
with nothing to upload. Nothing was compiled, built or deployed — the run never got past
checking that its configuration existed. So the blocker is **values, not code**: see
`project_tracking_deploy_blockers` and #219.

The consequence is unchanged and still current: a Procomer `.xlsx` export has merged into
that service and therefore ships to nobody.

**Two of the three artifacts this section asked for now exist. What remains:**

1. ~~`services/tracking-api/Dockerfile`~~ — **done**, `8463027a`
2. ~~a CloudFormation service stack~~ — **done**, `8463027a`, as a sibling template pair
   rather than by further parameterising `climate-project-api-prod-service.yml`
3. **`deploy-tracking-staging.yml` does not exist** — only the prod counterpart does. And
   the acceptance condition this list attached to it is **unmet even for prod**:
   `scripts/verify-prod-deploy-invariants.py` pins `deploy-prod.yml` and
   `deploy-staging.yml` **only** (`WORKFLOW`, `STAGING_WORKFLOW`, lines 79–80). No
   invariant guards `deploy-tracking-prod.yml`, so its preflight, canary and
   deployed-commit assertion can drift from the pair they were written to mirror and
   `deploy-path-lint` will stay green. That is the same shape as the defect where the
   tracking Docker build sat broken on `main` under a green CI, because only a deploy job
   ever builds that image.

> **#157's ETL dry run is no longer a reason for any of this.** #157 and #155 are both
> **CLOSED / not planned** — there is no data migration (`no-data-migration.md`). The
> earlier text here cited the dry run as the thing this gap blocked; it blocks nothing of
> the sort, and #156's own acceptance criterion 5 ("usable as the target for the ETL dry
> run") is dead for the same reason.

**One constraint that must not be discovered late.** #219 records that when the tracking
service is first deployed, **`InternalApiKey` must be wired on BOTH sides in the same
change**. For staging that means `climate-project-api/staging/internal-api-key` (step 3)
and the tracking service's `INTERNAL_API_KEY` must carry the **same value**, set in **one**
operation. A half-wired pair does not degrade gracefully: since #189 the API validates
`InternalApiKey` at startup under `ValidateOnStart`, and `/api/internal/*`
(`src/ClimateProject.Api/Endpoints/TrackingInternalEndpoints.cs`) rejects a mismatched
caller — so the result is a service that either refuses to boot or 401s every internal
call, discovered at the canary rather than at the desk.

**File this as its own issue.** Folding it into #156 would mean #156 never closes, and
#157 is already waiting on #156.

---

## Deliberately out of scope, so nobody waits for it

- **Drift monitoring for staging.** `deploy-drift.yml` watches production only. If
  staging later deserves one, the `PROD_API_BASE_URL`-style override pattern is the
  template.
- **A custom domain for staging.** The App Runner and Vercel generated hostnames are
  enough for a rehearsal environment.
- ~~**`Database__RequireSessionPooler` stays `"false"`, same as prod.**~~
  **CORRECTED 2026-08-24 — this bullet was stale, and wrong in both halves.** Production
  armed the guard on 2026-08-17 (commit `966c054`), and the flag is **not a parameter**:
  it is hardcoded `Value: "true"` in
  `infra/aws/climate-project-api-prod-service.yml`, the same file the staging deploy
  renders. **Staging therefore inherits `"true"` on its very first deploy**, and there
  is nothing left to rehearse. What is left is a trap: if step 2's staging connection
  string is on port **6543**, the service throws inside `ValidateOnStart`, never answers
  `/ready`, and step 6's canary fails the deploy five minutes later with no obvious
  cause. Avoiding it is step 2's "port 5432, never 6543" instruction, which is now
  load-bearing rather than advisory. Nothing about staging can un-arm the flag short of
  editing the shared template — which would un-arm production at the same time.
- **Copying any production data.** Whatever Decision box 2 says, the copy itself is a
  separate, deliberate operation with its own review — this runbook provisions the
  environment, empty.
