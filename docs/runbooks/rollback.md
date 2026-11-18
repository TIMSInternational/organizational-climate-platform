# Rollback runbook — #159

**Status: MECHANISM BUILT, NOT YET REHEARSED.** Every command below is written out and
two of them are now executable by a dispatch rather than by a person remembering
thirteen CloudFormation parameters. None of them has been run. The blanks in
[§8 Measurements](#8-measurements) are what a rehearsal fills, and until they hold
numbers this is still a document rather than a capability — which is #159's own
distinction and the reason the issue exists.

[AMENDED 2026-11-18. **Still never run**: `gh run list --workflow rollback-prod.yml` → 0 runs,
and 0 for `rollback-rehearsal-staging.yml` and `deploy-staging.yml`. **Production moved on
2026-10-12** from account `747814092517` / us-east-1 to account `795965600143` / **us-east-2**;
every account, region and hostname below that is dated before 2026-10-12 is the old one, and the
amendments marked 2026-11-18 say where it matters. The procedure for the first production
rehearsal — `adcb81ca` and back to `074930f4` — is [§11](#11-the-first-production-rehearsal--procedure-2026-11-18).]

Rewritten 2026-08-24 against `origin/main` at `8f0eacc`. Every claim marked **measured**
was checked against the live system on that date and the command that checked it is
shown. Every claim marked **guess** is a guess and says so.

Companions: [`cutover.md`](./cutover.md) (largely void — see below),
[`legacy-dependencies.md`](./legacy-dependencies.md),
[`staging-provisioning.md`](./staging-provisioning.md), `infra/aws/README.md`.

---

## 0. What this document used to say, and why it was wrong

The previous revision described rollback as **reverting DNS to a warm legacy stack**,
with a TTL-lowering phase in `cutover.md` as its prerequisite. That framing is dead
twice over:

1. **There is no legacy stack to return to.** The Mongo→Postgres migration was dropped
   entirely on 2026-08-19 ([`docs/decisions/no-data-migration.md`](../decisions/no-data-migration.md)):
   the legacy database held mock data, so it was abandoned rather than migrated. The
   new platform is not a *replacement* running beside an old one — it is the only one,
   and it is already live and carrying real users. #157, the dry run that was meant to
   prove the rollback, was closed **not planned** for the same reason.
2. **Neither layer's rollback is a DNS operation.** `climate.timsint.com` resolves to
   Vercel's anycast address (`A 76.76.21.21`, TTL 1799 — measured with
   `dig +noall +answer climate.timsint.com @1.1.1.1`), so rolling the front end back
   means re-pointing a Vercel *alias*, which is instant and never touches DNS. The API
   still runs on its generated App Runner hostname ~~with no custom domain~~, so rolling it
   back is a stack update.
   [AMENDED 2026-09-16. `api.climate.timsint.com` has existed since 2026-09-14 — measured
   `dig +short api.climate.timsint.com @1.1.1.1` → `bhgrdkd4gt.us-east-1.awsapprunner.com.`,
   `/version` → `69193e40`, `/health` → `200`. **The paragraph's conclusion is unchanged and
   is now true for a second reason.** The custom domain is a CNAME onto the same App Runner
   service, so rolling the API back is still a stack update and still touches no DNS record;
   and the deployed web bundle does not resolve the custom domain at all — it names the
   generated hostname 84 times and `api.climate.timsint.com` zero times
   (`/assets/index-q-ElFsLd.js`, counted 2026-09-16), because `VITE_API_BASE_URL` is unset.] [AMENDED 2026-11-18. Since the 2026-10-12 move the CNAME target is
   `av3s7p9mkm.us-east-2.awsapprunner.com.` (`dig +short api.climate.timsint.com @1.1.1.1`), the
   `ServiceUrl` output of `climate-project-api-prod` in `795965600143`/us-east-2.] **No resolver cache is on the critical path of any rollback
   in this document.** The TTL phase in `cutover.md` is not wrong, it is simply not what
   makes rollback fast here.

What #159 actually asks for, in the world that exists: *when a deploy makes production
worse, how do we get back, how long does it take, what does it cost, and which parts
cannot be undone at all.*

---

## 1. Production as it stands right now (all measured 2026-08-24)

Read this before deciding anything. The rollback plan is shaped by a live asymmetry.

| | value | how it was read |
|---|---|---|
| API commit serving | `fc539367156b5c98cd794c22ab590fc2fe016bed` | `curl -sS https://bhgrdkd4gt.us-east-1.awsapprunner.com/version` |
| API image built | `2026-08-19T15:31:59Z` | same response |
| `origin/main` | `8f0eacc`, **23 commits ahead** | `git rev-list --count fc53936..origin/main` |
| Web production | deployed **minutes ago**, from main | `vercel list climate --prod` |
| Web canonical URL | `https://climate.timsint.com` | `vercel projects ls` |
| API CORS allows | `https://climate.timsint.com` (and **not** `web-one-green-86.vercel.app`) | `curl -X OPTIONS -H 'Origin: …'` |
| Pending EF migrations | exactly **one**: `20260819200824_AddQuestionRepositories` | `git diff --name-status fc53936 origin/main -- src/ClimateProject.Infrastructure/Migrations/` |
| `/ready` steady state | 14 of 14 probes 200, no gap > 2 s | `scripts/rollback-probe.sh <url> 8 1 2` |

### The asymmetry, and it is already causing a live defect

The web ships on every merge to main through Vercel's git integration
(`web/vercel.json`, no workflow involved). The API ships only when somebody dispatches
`deploy-prod.yml` by hand. **Production has therefore been running a front end 23
commits newer than its API for five days.**

That is not theoretical. Commit `0bba08c` added `QuestionLibraryEndpoints.cs` and
`1e9aeee` added the picker in the web app that calls it. Measured today:

```
$ curl -s -o /dev/null -w '%{http_code}\n' https://bhgrdkd4gt.us-east-1.awsapprunner.com/admin/question-library
404
$ curl -s -o /dev/null -w '%{http_code}\n' https://bhgrdkd4gt.us-east-1.awsapprunner.com/admin/users
401
```

`401` is a route that exists and wants a token. `404` is a route that is not there. The
live front end is calling an endpoint the live API does not serve.

**The operational consequence for this runbook:** the two halves must be rolled as a
*pair*, and the pair is currently already mismatched. Rolling the API back one image
while leaving the web at main widens the gap; rolling the web back to the deployment
that matches the API's commit closes it. §3.1 is therefore listed first, not because it
is less important, but because it is the faster and cheaper lever and is more often the
right one.

---

## 2. The four layers, and what "reversible" honestly means for each

| Layer | Mechanism | Reversible? | Time (see §3) |
|---|---|---|---|
| Web (Vercel) | promote a previous production deployment | **Yes, cleanly.** No rebuild, no DNS, ~20 production deployments retained | seconds |
| API (App Runner) | point the stack at a previous ECR image | **Yes**, for the last **40** `prod-*` images | minutes (§3.2) |
| Service config / secrets | CloudFormation parameters; Secrets Manager `AWSPREVIOUS` | **Yes**, but a secret change needs a *new rollout* to take effect | minutes |
| Database schema + data | EF Core migrations | **NO, not in general.** §4 | — |

Everything above the line is genuinely reversible. Everything below it is where this
document stops being reassuring, and §4 is the section that matters.

---

## 3. The procedure, layer by layer

### 3.1 Web — Vercel, seconds, no rebuild

**Measured:** the `climate` project retains at least 20 production deployments going
back 5 days, all `● Ready` (`vercel list climate --prod`). Promotion re-points the
alias at an existing build; it does not rebuild and it does not touch DNS.

```bash
# 1. See what is there. Note the age column and pick the deployment that corresponds
#    to the API commit you intend to be running.
vercel list climate --prod

# 2. Promote a previous one. Pass the DEPLOYMENT URL, not the project name: the URL
#    identifies the build unambiguously and does not depend on which directory the
#    command is run from. Default timeout is 3m; -y skips the confirmation prompt.
vercel rollback https://climate-<id>-federicos-projects-21f2ff63.vercel.app \
  --scope federicos-projects-21f2ff63 -y

# 3. Confirm it landed. This is the verification step, not the curl below.
vercel rollback status climate --scope federicos-projects-21f2ff63

# 4. Prove it from outside. There is no build stamp in the bundle (checked: no
#    VITE_COMMIT, no VERCEL_GIT_COMMIT_SHA anywhere under web/), so the only external
#    evidence is the asset hash changing and the broken behaviour stopping.
curl -s https://climate.timsint.com/ | grep -o 'assets/[^"]*\.js'
```

Verified 2026-08-24 that `vercel rollback` and `vercel rollback status` exist in the
installed CLI (50.22.1) and that the account is authenticated for scope
`federicos-projects-21f2ff63`. **Not verified: that a rollback actually succeeds** — that
would have changed production, which this pass did not do.

> **Gap worth closing before go-live, and it is small:** the web app carries no version
> stamp, so nothing can assert "the front end is at commit X" the way
> `scripts/read-deployed-commit.sh` does for the API. `deploy-drift.yml` therefore
> watches only half the system. A `VITE_COMMIT_SHA` fed from Vercel's
> `VERCEL_GIT_COMMIT_SHA` and surfaced on the System Health page would make a web
> rollback verifiable instead of inferred. Not built here — `web/src` belongs to another
> lane tonight.

**Auto-deploy is the hazard on the other side.** Once the web is rolled back, the *next
merge to main* redeploys it forward again, silently, with no dispatch. If the rollback
must hold for more than a few minutes, either freeze merges to main or disable the
Vercel git integration for the project — a console action, and a human decision (§9).

### 3.2 API — App Runner, minutes

The images are already built. Every `deploy-prod.yml` run tags
`prod-<full-40-char-sha>` alongside the mutable `prod-latest` and pushes both, and the
ECR lifecycle policy in `infra/aws/climate-project-api-bootstrap.yml` keeps **the 40
most recent `prod-*` images**. So:

> **The rollback horizon is the last 40 production deploys.** Past that the tag is
> expired and a "rollback" is a rebuild. Nobody has ever tested where that edge is; the
> rehearsal in §7 is what proves the second-newest image is still pullable at all.

> **Never roll back to `prod-latest`.** `ImageTagMutability: MUTABLE` and every deploy
> moves it, so it always names the newest build. Rolling back "to latest" gets you
> exactly what you already have, and it is the commonest way to spend five minutes
> proving nothing.

#### The path to use: dispatch `rollback-prod.yml`

New in this change (see §10). Dispatch-only, gated on typing the phrase
`roll back production`, and it requires a `reason` because a rollback with no recorded
trigger is an incident with no record.

```
gh workflow run rollback-prod.yml \
  --repo TIMSInternational/organizational-climate-platform \
  --ref main \
  -f target_sha=<40-hex> \
  -f confirm='roll back production' \
  -f reason='trigger T2: 5xx rate above threshold; decided by <name> at <time>'
```

It does exactly four things: report the migration delta it is **not** undoing, swap the
image via `scripts/rollback-api-image.sh`, gate on 20 consecutive `/ready` 200s, and
write the incident record into the job summary. It does **not** build, test, migrate, or
move `prod-latest`.

> `--ref main` is load-bearing: GitHub only offers `workflow_dispatch` workflows that
> exist on the default branch. Until this file is merged to `main`, the workflow is not
> dispatchable at all — which is the single most important thing to fix before relying
> on it.

#### Why not just re-dispatch `deploy-prod.yml` at the old commit

Three reasons, each independently sufficient:

1. It runs `dotnet test ClimateProject.slnx` and a full `docker build` first, to
   produce an image **that already exists in ECR**. `infra/aws/README.md` records
   19-minute deploys on the manual path; a workflow that also runs the whole test
   suite will not beat that. That is not a rollback, it is a rebuild with a rollback's
   name on it.
2. It runs `dotnet ef database update` before the rollout. Pointed at an older commit
   that applies the *older* migration set to a database already ahead of it, which is a
   no-op — and a no-op that quietly reinforces the false belief that the schema came
   back too.
3. It pushes the old image over `prod-latest`, destroying the record of what was most
   recently built.

#### The break-glass path, if the workflow is unavailable

Requires local credentials in account `747814092517`. Read §9 first — it is not
established that any human has them.

[AMENDED 2026-11-18. Production is account **`795965600143`, us-east-2** since 2026-10-12.
`scripts/rollback-api-image.sh` now defaults to `--region us-east-2` (it defaulted to us-east-1,
where no climate stack exists any more) and refuses credentials in any account other than
`795965600143` before its first stack or ECR call (`--account` overrides). Measured: this
workstation's default profile is `arn:aws:iam::795965600143:user/Federico`
(`aws sts get-caller-identity`) while its CLI default region is still us-east-1
(`aws configure list`) — the case the new default exists for. So a human with break-glass
credentials exists; an agent must not use them (CLAUDE.md, "Production is off limits").]

```bash
# Dry run first. Prints every parameter it will re-pass and refuses if the target image
# has aged out of ECR. Nothing changes without --execute.
./scripts/rollback-api-image.sh --stack climate-project-api-prod --target-sha <40-hex>

# Then:
./scripts/rollback-api-image.sh --stack climate-project-api-prod --target-sha <40-hex> --execute
```

The script re-passes **the live stack's current parameters**, overriding only
`ImageIdentifier`. That is deliberately the opposite of `deploy-prod.yml`'s rule, and
the distinction is worth holding on to:

- For a **deploy**, this repository is the source of truth. An omitted parameter makes
  the live configuration a function of invisible prior stack state, which is why that
  workflow passes all thirteen explicitly.
- For a **rollback**, the thing you are getting back to is *what was running five
  minutes ago*, not what main describes. Main may have changed a CORS origin or a
  secret ARN since; smuggling that in mid-incident turns a one-variable change into an
  unknown-variable change.

Consequence, stated so it is not discovered: **if a bad configuration is what you are
rolling back, this script faithfully preserves it.** Fix configuration by dispatching
the normal deploy with the repository variable corrected.

#### The path that is not a rollback

`aws apprunner start-deployment` re-pulls the *same* `ImageIdentifier`. Since prod's
identifier is an immutable `prod-<sha>` tag, it redeploys the thing you are trying to
escape. It is the right tool for "the rollout half-failed, try again"; it is the wrong
tool here and it looks like the right one.

`aws apprunner update-service --source-configuration …` does work and is marginally
faster to issue, but it leaves CloudFormation describing an image that is not running.
The drift is invisible to `describe-stacks` and self-heals only on the next deploy that
changes the parameter. If you use it, you **must** follow with an
`aws cloudformation deploy` naming the same image so the stack matches reality.

#### How long it takes

Only one component of this is provable from the repository:

| component | value | basis |
|---|---|---|
| health gate on the new instances | **60 s minimum** | `HealthyThreshold: 3` × `Interval: 20` in `infra/aws/climate-project-api-prod-service.yml`. A hard floor: App Runner will not call an instance healthy sooner. |
| first-probe cold start | ~9.4 s | measured in #220 — EF model build plus the first pooled connection |
| CloudFormation change-set + execute overhead | 30–60 s | **guess** |
| ECR pull + container start on 0.25 vCPU / 0.5 GB | 30–90 s | **guess** |
| **total, command issued → old image serving** | **3–7 minutes** | **GUESS.** This number exists to be replaced by §7's measurement. Do not quote it to anyone as fact. |

I could not measure any of this: the AWS credentials available in this environment are
for account `795965600143`, not the production account `747814092517`, and
`aws apprunner list-services` returns `SubscriptionRequiredException` there. Every
App Runner runtime claim in this section comes from the templates and the workflow
comments, not from the live service.

[AMENDED 2026-11-18. Now measurable, read-only, from `795965600143`/us-east-2. App Runner's five
most recent `UPDATE_SERVICE` operations took 2m28s–2m41s each (`aws apprunner list-operations
--region us-east-2 --service-arn …/climate-project-api-prod/93676dfce5c941cd9ce43caf671c9918`,
2026-11-15 to 2026-11-18). The `Deploy App Runner service stack` step of `deploy-prod.yml` — the
same `aws cloudformation deploy` an image swap runs — took 3m07s (run 43967002998), 3m38s
(43954676280) and 3m09s (44232791073), and the readiness canary after it 1m36s–1m39s. These are
deploys, not rollbacks; §11.5 turns them into the rehearsal's expectation. The service runs
**1 vCPU / 2 GB, 2–4 instances** (`describe-service`, `describe-auto-scaling-configuration`:
`climate-project-api-prod-as` MinSize 2, MaxSize 4), not 0.25 vCPU / 0.5 GB.]

#### What happens to in-flight requests

**Unverified, and deliberately not asserted.** App Runner documents deployments as
zero-downtime and does not publish a connection-drain timeout, so the only honest
answer this project can give is a measured one. `scripts/rollback-probe.sh` is the
instrument that produces it: run it before and across a swap and it reports the longest
consecutive failure run and the failures falling within ±15 s of the moment `/version`
flips.

It measures *availability continuity* for short requests. It does **not** see a
long-running request severed mid-flight — a report export or a bulk import. To test
that, start one by hand immediately before the swap and watch whether it completes.

### 3.3 Service configuration and secrets

CloudFormation parameters (CORS origins, CPU/memory, secret ARNs) roll back the same
way: change the repository variable, re-run `deploy-prod.yml`. Note the
`CorsAdditionalAllowedOrigin` trap already documented in `infra/aws/README.md` —
omitting it *keeps* the previous value, so removing an origin requires passing it
explicitly empty.

Secrets Manager values roll back with `put-secret-value` restoring `AWSPREVIOUS` (this
is how #220's pooler port was made reversible). **But the secret is injected into the
container at instance start**, via `RuntimeEnvironmentSecrets`. Changing the secret
alone changes nothing that is running: it needs a new rollout — an image swap or
`aws apprunner start-deployment` — before any instance reads the new value. Budget the
same minutes as §3.2.

Two secrets are one-way in the sense that matters:

- **`TrackingJwtSecret`** — rotating it invalidates every issued token. Every logged-in
  user is signed out. Reversible mechanically, but the user-visible effect is not.
- **`InternalApiKey`** — must be wired on **both** sides in the same change (#219).
  Rolling one side back alone gives per-request `401`s on `/api/internal/*` that read
  as an authentication bug in new code rather than a configuration coupling.

### 3.4 `services/tracking-api` — there is nothing to roll back, and that is the problem

Verified today:

```
$ grep -rn "services/" .github/workflows/      # no matches
$ grep -rn "tracking" .github/workflows/*.yml  # no matches
$ grep -n "ClimateTracking" ClimateProject.slnx # no matches
```

The tracking service has **its own solution** (`services/tracking-api/ClimateTracking.slnx`)
which **no CI job builds**, **no Dockerfile packages** (`find . -iname 'Dockerfile*'`
returns only the root `Dockerfile` and `Dockerfile.workers`), and **no workflow
deploys**. `git log -S'ClimateTracking' -- .github/workflows/ci.yml` returns nothing:
it has never been in CI.

Issue #219's premise — *"`services/tracking-api/` is built and tested in CI but deployed
nowhere"* — is half wrong and should be corrected: it is neither built in CI nor
deployed.

The Procomer `.xlsx` export merged as `fab4c40` (#386) yesterday lives in that service.
It has no production path, so it also has no rollback: there is nothing to roll back
*to* and nothing to roll back *from*. For a client whose acceptance criterion 7 is that
export, "we can roll it back" is not the risk — "it cannot ship at all" is. That belongs
in the go-live plan, not this one, but a rollback runbook that omitted it would be
lying by silence.

---

## 4. The database — the section that decides whether any of the above is safe

`deploy-prod.yml` applies EF Core migrations **before** the App Runner rollout. Rolling
the image back therefore leaves the database at the **newer** schema. Schema and code
have come apart, and they do not reconverge on their own.

### 4.1 Always run this first, and again before the next deploy

```bash
# What the commit you are rolling back TO knows about:
git ls-tree -r --name-only <target-sha> src/ClimateProject.Infrastructure/Migrations/ \
  | grep -E '/[0-9]{14}_.*\.cs$' | grep -v Designer | xargs -n1 basename | sort

# What the database has actually applied. Session pooler, port 5432 -- never 6543
# (transaction mode breaks the session-scoped advisory lock EF takes), never
# db.<project-ref>.supabase.co (IPv6-only, unroutable from CI).
psql "$MIGRATION_CONN" -At \
  -c 'SELECT "MigrationId" FROM "__EFMigrationsHistory" ORDER BY "MigrationId";'
```

(EF's default history table; no custom one is configured anywhere in
`src/ClimateProject.Infrastructure`.) `rollback-prod.yml` prints the *file* delta
automatically — it has no database credentials, deliberately — and the staging rehearsal
in §7 runs the full version against a real database.

**Right now that delta is exactly one migration**, `20260819200824_AddQuestionRepositories`,
and it is purely additive: 29 `CreateTable`/`CreateIndex`/`AddColumn` statements and zero
`DROP`/`TRUNCATE` in its `Up()`. So today a code-only rollback of the API is safe with
respect to schema. That is a fact about today, not a property of this repository.

### 4.2 Three states, and only one of them is fine

1. **Schema ahead, delta additive** → **safe, leave it applied.** Old code does not
   select a column it has never heard of. Take no action.
2. **Schema ahead, delta rewrites or removes data** → **not safe, and not mechanically
   fixable.** The rolled-back code will read values it rejects or columns that are gone.
   This is a per-migration judgement, made by a human, with the migration file open.
3. **You are considering running `Down()`** → almost always wrong. §4.3.

### 4.3 `Down()` is a development tool. It is not a production rollback mechanism here

Every claim below is from the migration file named. This is not a general worry about
EF; it is what these specific `Down()` methods do:

| Migration | What `Down()` actually does | Verdict |
|---|---|---|
| `20260819200824_AddQuestionRepositories` | drops **7 tables** (`question_bank_items`, `question_library_items`, `question_categories`, four child tables) | Every question-library row authored since is destroyed |
| `20260806003034_NormaliseDemographicsIntoTables` | drops `user_demographics` and `user_invitation_demographics`, restores the jsonb columns as **NULL** — its own comment refuses to re-encode, because "a faithful reverse would be a fiction" | **Total loss of every user's demographics** |
| `20260806004726_MakeUserCompanyIdNullable` | backfills NULL `company_id` with `Guid.Empty`, which is not a real `companies.Id`, so the FK rejects it | **The `Down()` fails and leaves the migration half-applied.** A `Down()` that cannot run is worse than none |
| `20260817190504_DropCommentPromptDefaults` | writes the default literal over **every** NULL prompt | **Fabricates** data rather than losing it — a deliberately-blank prompt silently becomes "Please explain your answer:" |
| `20260804002058_RenameOpenTextQuestionTypeToOpenEnded` | maps every `open_ended` back to `open_text`, including rows never touched by `Up()` | Lossy by design, and its own comment says so |
| `20260804200923_LockDownPostgrestRoles` | **intentionally empty**, with a comment explaining that a faithful inverse would re-grant CRUD to `anon`/`authenticated` and disable RLS — reintroducing the CRITICAL vulnerability `Up()` closed | The right call, and the honest one: this migration is **irreversible by design**. A `dotnet ef database update` to a point before it will silently leave the lockdown in place |

Six of the most interesting `Down()` methods in this repository destroy data, fabricate
data, fail outright, or decline to reverse at all. There is no seventh that quietly
works. Note the last row's second-order effect in particular: because that `Down()` is a
no-op, reverting *past* it succeeds while leaving the schema not actually reverted — so
even `dotnet ef database update <old-migration>` returning `0` proves nothing about
where the database now is.

**The rule: do not run `Down()` against production.** If a schema change genuinely has
to be undone, the correct instrument is a **new forward migration** that expresses the
undo explicitly, reviewed like any other change, with its data effects stated.

### 4.4 The corruption trap — this is the one that bites the *next* deploy

Suppose the history table is left ahead (fine, per §4.2 case 1), and someone then cuts a
hotfix branch from the older commit and adds a **new** migration on it. EF scaffolds
that migration against the older model snapshot — one that does not contain the
still-applied newer migrations — and computes "pending" as *files minus history*. The
next `deploy-prod.yml` dispatch then runs `dotnet ef database update` and applies DDL
generated against a schema that is not the one in the database. Depending on the overlap
it fails mid-workflow or, worse, succeeds and leaves the schema wrong.

> **Never author a new migration from a branch whose `Migrations/` set is behind
> `__EFMigrationsHistory`.** Run §4.1 first, every time. A rollback that forgets an
> applied migration corrupts the *next* deploy, not the rollback itself — which is why
> this has to be a written step and not a memory.

### 4.5 The backup that has to exist, because the recovery lever does not

**Standing risk, and I could not verify it.** The claim on record is that Supabase
point-in-time recovery is **off** with zero restorable backups. [AMENDED 2026-11-18. Answered:
PITR is off (`supabase backups list`, 2026-09-28) and decision B replaced it — a `pg_dump` to
`s3://climate-project-db-backups-795965600143-us-east-2/climate/` every 6 hours
(`docs/decisions/database-backups.md`). Newest object at this writing:
`climate/2026/11/18/climate-20261118T013417Z.dump`, 3,255,303 bytes (`aws s3 ls`). The restore
drill is in `docs/runbooks/backup-restore-verification.md`.] The Supabase MCP server
available in this session is bound to project `lzhfnjfsdwdywwnlqgqq`, whose schema is the
TIMS ATS product (`candidates`, `vacancies`, `assessment_results`, Quartz tables) — **it
is not the climate project's database**, so nothing here could read the real project's
backup configuration. Treating PITR as absent is the safe assumption and it is what the
rest of this section assumes; **verifying it is a human task (§9), and it is the single
highest-value one in this document.**

If PITR is off, then:

- there is no "restore the database" lever at all, at any price;
- `Down()` is not merely unwise, it is unrecoverable;
- and the scheduled jobs are deleting rows *right now*. `WorkerJobs.RetentionCleanup`
  and `WorkerJobs.SurveyDraftRetention` both issue hard deletes
  (`ExecuteDeleteAsync` / `RemoveRange` in `RetentionCleanupJob.cs` and
  `SurveyDraftRetentionJob.cs`), on defaults of 365 days for terminal notifications and
  90 days for unaccepted invitations. The workers were confirmed running in production
  on 2026-08-19 (`cutover.md` gate A1).

**So this is a required step, not a nice-to-have:**

```bash
# BEFORE any deploy that carries a migration. Session pooler, port 5432.
# Logical, data-only, of the tables the migration touches. Costs one command.
pg_dump "$MIGRATION_CONN" --data-only --no-owner --no-privileges \
  --table=public.questions --table=public.microclimate_questions \
  -f "pre-deploy-$(date -u +%Y%m%dT%H%M%SZ).sql"
```

For a migration whose blast radius is not obvious, dump the whole database instead of
guessing the table list. It is a survey product for a few hundred employees; the dump is
small and the alternative is having nothing.

---

## 5. Trigger criteria — agreed in advance, by a named person

Deciding whether to roll back *during* an incident, without pre-agreed thresholds, goes
badly — that is #159's own framing and it is right. The thresholds below are **proposals
with their reasoning**; each needs a human to ratify or replace it (§9).

| # | Trigger | Proposed threshold | Why this number | Measurable today? |
|---|---|---|---|---|
| T1 | `/ready` failing | ≥ 3 consecutive non-200 from an external prober at 10 s spacing, **and** App Runner has already replaced an instance twice in 10 minutes | The service template gives an instance ~100 s of continuous failure (`UnhealthyThreshold: 5` × `Interval: 20`) before App Runner replaces it. A human trigger faster than that fights the platform's own self-healing. This one fires only after self-healing has been given its chance and failed. | Partly — `scripts/rollback-probe.sh` does the probing; the replacement count needs App Runner console access |
| T2 | 5xx rate | > 2 % of requests in any 5-minute window | Base rate should be ~0 for a survey tool serving a few hundred employees. 2 % is above one flaky client and below the point users start telling each other. | **NO — nothing measures this. #158 is open.** |
| T3 | Authentication | 3 distinct users failing to log in with valid credentials inside 10 minutes | Auth is the only total-outage surface: a respondent who cannot log in can do nothing at all. Three users rules out one person's bad password. | **NO — #158** |
| T4 | Route missing | any endpoint the deployed web bundle calls returning 404 | This is *today's* live defect (§1) and it is invisible to every health check the project has: `/ready` is 200 throughout. | Only by hand today |
| T5 | Suspected data loss | **any** credible report of missing responses | Roll back first, investigate second. With no PITR (§4.5), every additional minute of running is more rows a delete job can take. This is the one trigger with no threshold, on purpose. | Human report only |
| T6 | Client-visible during a demo/UAT window | decision owner's judgement | For a 16 Nov government go-live, "correct but broken in front of the client" is a different cost function than the same defect at 3am | Human |

**T2 and T3 cannot be evaluated today.** That is not a gap in this runbook, it is #158
(monitoring, open) surfacing as a hard dependency: a trigger nobody can measure is a
trigger nobody will pull. Along with #156 (§7), that makes two open issues on the
critical path of #159.

**Decision owner (one name, reachable for the whole watch period): `____`**
**Backup owner, and the hours each covers: `____`**
No rollback is executed without one of them saying so, and `rollback-prod.yml`'s
`reason` input is where that decision gets recorded.

---

## 6. The point of no return

The old framing — one moment, past which you cannot return to the legacy stack — does
not apply: there is no legacy stack. In the world that exists there are **three
independent one-way doors**, and each closes on its own schedule.

| # | The door | Closes when | Can a rollback reopen it? |
|---|---|---|---|
| PONR-1 | **A non-additive migration commits.** A rewrite, a narrowed nullability, a dropped column. | the moment `dotnet ef database update` finishes that statement | **No.** §4.3 shows why `Down()` is not the answer. Recovery is the §4.5 dump or nothing |
| PONR-2 | **A hard-deleting job runs on the new code.** `retention-cleanup`, `survey-draft-retention`, GDPR `SubjectErasure`; and `survey-lifecycle` mutates live survey statuses | the moment the job's tick commits | **No.** Rolling the image back does not resurrect a deleted row |
| PONR-3 | **An email leaves the process.** Invitations and reminders — and since #368 `sent` is recorded only after a provider accepts the message, so a recorded send really left | the moment the provider accepts | **No.** You cannot unsend an invitation carrying a token an older API will reject |

For an **additive** migration, PONR-1 never arrives: the old image simply never touches
the new objects, and the rows written into them survive a code rollback intact and are
waiting when you roll forward again. **That is the property that makes a code rollback
cheap, and it is a property of the migration, not of the platform.**

Which gives the rule that should govern every deploy between now and 16 November:

> **No migration goes to production non-additively unless the team has explicitly
> decided to give up the ability to roll code back across it, and written that down.**

Expand/contract, in other words — deploy tolerant code first, migrate second — and
`deploy-prod.yml`'s `confirm_destructive_migration` gate is already the place where that
decision is forced into the open. Treat a `yes` there as *"we are closing PONR-1
today"*, not as a checkbox.

---

## 7. The rehearsal — what a human actually executes

An untested rollback plan is a document. This is the part that makes it a capability.

### 7.1 Against staging — the safe version. **BLOCKED ON #156.**

There is no staging environment as of 2026-08-24: #156 is open, the `staging` GitHub
environment does not exist, and neither do `climate-project-api-staging-bootstrap` or
`climate-project-api-staging`. `docs/runbooks/staging-provisioning.md` is the procedure.

Once it exists:

```
gh workflow run rollback-rehearsal-staging.yml --ref main
```

It refuses with a readable message if staging is absent, so the dependency is executable
rather than a footnote. A green run **proves** — and this list is the acceptance
criterion, not a description:

1. The previous image is still pullable from ECR (the 40-image horizon, never tested).
2. **The operator's credentials can actually perform the stack update.** See §9 — this
   is the claim most likely to be false.
3. How long the swap takes, measured.
4. What it costs in failed requests, measured, against a measured 60-second baseline.
5. That the `__EFMigrationsHistory` check runs and reports a real answer, against a real
   database with real credentials.
6. That the environment comes back afterwards (it rolls forward again by default).

Two consecutive clean runs before #159 is closed. The second one is what catches the
step that only worked because someone had a terminal open.

### 7.2 Rehearsing without staging — a human decision, not a default

If 16 November arrives with #156 still open, the choice is between an unrehearsed
rollback plan and a rehearsal against production. Neither is good. If production is
chosen:

- pick a genuinely quiet window and announce it;
- take the §4.5 dump first, even though a code-only rollback should not need it;
- roll `fc53936` → the previous `prod-<sha>` → back to `fc53936`, with
  `scripts/rollback-probe.sh` running across both swaps;
- expect two full swaps' worth of exposure, so budget twice the §3.2 estimate.

**This is Federico's call and nobody else's.** It is written down so the option is
visible, not because it is recommended.

[AMENDED 2026-11-18. §11 is this option written out for today's pair, `adcb81ca` ↔ `074930f4`,
with preconditions, commands, what to watch, durations and abort criteria. Staging still does
not exist: `aws cloudformation describe-stacks --region us-east-2` lists no
`climate-project-api-staging*` stack.]

### 7.3 The five-minute version, runnable today, against nothing

Cheap and worth doing this week, because it catches the failures that are about people
and access rather than about AWS:

```bash
# Does the person who would run this have credentials in 747814092517 at all?
aws sts get-caller-identity

# Can they see the stack and the images?
aws cloudformation describe-stacks --stack-name climate-project-api-prod --region us-east-1 --query 'Stacks[0].StackStatus'
aws ecr describe-images --repository-name climate-project-api --region us-east-1 \
  --query 'reverse(sort_by(imageDetails,&imagePushedAt))[:5].{pushed:imagePushedAt,tags:imageTags}' --output table

# The dry run. Changes nothing, and fails loudly if the target image has expired.
./scripts/rollback-api-image.sh --stack climate-project-api-prod --target-sha <previous-40-hex>
```

[AMENDED 2026-11-18. The two `--region us-east-1` commands above name the region production left
on 2026-10-12. Today's are `--region us-east-2`, in account `795965600143`; they are written out
in §11.2 (P8).]

If the first command fails, stop reading and go to §9 — everything downstream of it is
hypothetical.

---

## 8. Measurements

Fill from §7. Until these hold numbers, §3.2's timings are guesses and are labelled as
such throughout.

### 8.0 Steady-state baseline — measured 2026-09-01, production on `4b21c0a`

The first half of §7.3 has now been run. `scripts/rollback-probe.sh` makes **zero AWS
calls**, so the probe needs no production credentials — it was run from a machine holding
only `795965600143`, which cannot see App Runner at all. Only the three `aws` commands in
§7.3 still require `747814092517` (H1).

[AMENDED 2026-11-18. Since the 2026-10-12 move `795965600143` **is** the production account:
`aws apprunner list-services --region us-east-2` lists `climate-project-api-prod`, RUNNING.]

`scripts/rollback-probe.sh <url> 90 1.0 2` — deliberately light, ~2 req/s:

| | value |
|---|---|
| requests / non-200 | **56 / 0** |
| longest consecutive failure run | **0 s** |
| `/ready` latency mean | **2.22 s** |
| min / max | **1.41 s / 5.46 s** |
| distribution | 42 in 1–2 s · 7 in 3–4 s · 5 in 4–5 s · **2 in 5–6 s** |

**The steady state costs zero failed requests.** That is the number a rehearsal is
compared against, and without it a rollback that costs four failures means nothing.

### 8.1 The health-check margin this exposed — read before rehearsing

`HealthCheckConfiguration` on the prod service is `Interval: 20`, **`Timeout: 5`**,
`HealthyThreshold: 3`, `UnhealthyThreshold: 5`. The baseline above puts **2 of 56 probes
(3.6%) past that 5 s timeout**, at a measured max of 5.46 s.

At steady state this is absorbed by design, and is not an incident: marking an instance
unhealthy needs 5 consecutive failures at a 20 s interval — 100 seconds of sustained
slowness, not a sporadic 3.6%.

**It matters during a rollback.** The replacement instance cold-starts, and #220 measured
a **9.4 s** cold-start `/ready` — roughly twice the timeout — while `HealthyThreshold: 3`
means it must pass three consecutive checks before it serves. So a rollback that appears
to stall in health checks for a minute or more is the **expected** behaviour of this
configuration, not a failed rollback. Do not abort it on that signal alone; abort on the
§5 triggers.



| | Rehearsal 1 | Rehearsal 2 |
|---|---|---|
| Date / environment | `____` | `____` |
| Who executed it | `____` | `____` |
| Rolled back from → to | `____` | `____` |
| **Command issued → old image serving** | `____` s | `____` s |
| Steady-state baseline: requests / non-200 | `____` | `____` |
| Across the swap: requests / non-200 | `____` | `____` |
| Longest consecutive failure run | `____` s | `____` s |
| Long-running request severed? (§3.2) | `____` | `____` |
| Roll-forward wall clock | `____` s | `____` s |
| Migration delta the check reported | `____` | `____` |
| What surprised us | `____` | `____` |
| Runbook updated in the same change | `____` | `____` |

---

## 9. What only a human can decide or supply

Ordered by how much of this document collapses without it.

| # | The thing | Why it blocks | Owner |
|---|---|---|---|
| H1 | **Does any human hold credentials in AWS account `747814092517` that can update `climate-project-api-prod`?** [AMENDED 2026-11-18: the account is now `795965600143` (us-east-2), and yes — the workstation's default profile is the IAM user `Federico` there (`aws sts get-caller-identity`).] The only principal proven to have `cloudformation:UpdateStack` on it is the GitHub OIDC role `climate-project-github-deploy-prod`, assumable only from Actions. The credentials in this environment are for `795965600143` and cannot see App Runner at all. | If the answer is no, the break-glass path in §3.2 does not exist, and every rollback depends on GitHub Actions being available. Test it with §7.3's first command — it takes ten seconds. | `____` |
| H2 | **Is Supabase PITR on for the climate project, and are there restorable backups?** [AMENDED 2026-11-18: PITR off; decision B's S3 dumps every 6 hours are the backups — `docs/decisions/database-backups.md`.] Unverifiable from here (§4.5). | Decides whether §4.5's `pg_dump` is a belt-and-braces habit or the *only* recovery lever in existence. Also decides how frightening PONR-1 and PONR-2 are. | `____` |
| H3 | ~~**Merge `rollback-prod.yml` to `main`.**~~ **DONE** — it is on `main` (verified 2026-09-01), so `workflow_dispatch` offers it. It has still **never been run**: that is H10. | `workflow_dispatch` workflows are only offered from the default branch. On a feature branch it is inert. | ✅ |
| H4 | **Ratify or replace the §5 thresholds, and name the decision owner and their backup.** | A threshold nobody agreed to will not be pulled at 3am. | `____` |
| H5 | **#156, staging.** | §7.1's rehearsal has nowhere to run. Also blocks any future rehearsal being repeatable. | `____` |
| H6 | **#158, monitoring.** | T2 and T3 are unmeasurable without it. Two of six triggers are decorative until it lands. | `____` |
| H7 | **Provision the tracking database and decide `PROCOMER_COMPANY_ID` (§3.4).** **CORRECTED 2026-09-01: "No CI, no Dockerfile, no deploy" is now false on all three counts** — `ci.yml` gates `tracking-build-and-test` (163 tests, added in #410), `services/tracking-api/Dockerfile` exists, and `deploy-tracking-prod.yml` ran on 2026-08-27, failing at its credential-free preflight. **#219's `InternalApiKey` wiring is already correct**: both services read the same `INTERNAL_API_KEY_SECRET_ARN`, and the preflight refuses an empty or malformed one, so the two-sided coupling cannot be broken silently. What remains is three config values, two of which are one task (the database does not exist). | Still a "can it ship at all" question — but a provisioning one, not an engineering one. | `____` |
| H10 | **Rehearse the rollback (#159).** [AMENDED 2026-11-18: still 0 runs of all three. §11 is the procedure for a production rehearsal of `adcb81ca` ↔ `074930f4`, whose delta holds 0 migrations.] `rollback-prod.yml`, `deploy-staging.yml` and `rollback-rehearsal-staging.yml` have **zero runs between them** (verified 2026-09-01). **The 2026-09-01 release is the most forgiving moment this will ever have**: its only migration, `AddReportShares`, is a pure `CreateTable`, so the previous image (`98f6a4b`) runs unchanged against the new schema, and this workflow is image-only by design. | An untested recovery path is not a recovery path. The conditions will not be this benign for the next release. | `____` |
| H8 | **Decide the Vercel auto-deploy posture during an incident (§3.1).** Merges to main silently roll the web forward again. | A web rollback that a merge undoes is not a rollback. | `____` |
| H9 | ~~**Close the API/web version gap.**~~ **CLOSED 2026-09-01** — the nine-PR merge queue landed and `deploy-prod` shipped it: prod and `main` are both `4b21c0a`, so the gap is zero and `deploy-drift` is green for the first time since 2026-08-28. Re-open this row the moment drift reappears; it is a recurring condition, not a one-time fix. | Every rollback in this document is harder while the two halves are decoupled. | ✅ |

---

## 10. What this change added, and what it deliberately did not touch

**New files:**

- `scripts/rollback-api-image.sh` — the mechanism. Dry-run by default; refuses a short
  SHA, an unknown stack name, or an image that has aged out of ECR.
- `scripts/rollback-probe.sh` — the instrument. Measures availability across a swap and
  the failures inside the ±15 s window around it.
- `.github/workflows/rollback-prod.yml` — **dispatch-only, and it changes production
  when dispatched.** It has never been run. It reuses the existing
  `climate-project-github-deploy-prod` role and the `deploy-prod` concurrency group; no
  IAM or infrastructure change was required.
- `.github/workflows/rollback-rehearsal-staging.yml` — staging-only by construction:
  every stack name is a literal and the role it assumes reaches only staging.

**Deliberately unchanged:** `deploy-prod.yml`, `deploy-staging.yml`, `deploy-drift.yml`,
`ci.yml`, the CloudFormation templates, and all application source. Nothing about what
an existing dispatch does has been altered.

Verified before commit: `actionlint` clean across all workflows, `shellcheck` clean on
both scripts, and `scripts/verify-prod-deploy-invariants.py` still passes.
`scripts/rollback-probe.sh` was self-tested for 8 seconds against the live API — 14 of
14 probes returned 200 — which is the only part of this change that has been exercised
against anything real.

---

## 11. The first production rehearsal — procedure, 2026-11-18

**Written 2026-11-18 against `origin/main` at `074930f4`. Not executed.** It changes production
twice, so **the user dispatches it; an agent does not** (CLAUDE.md, "Production is off limits").
Every value marked *measured* was read on 2026-11-18, read-only, with the command shown. This is
§7.2's option made concrete; §7.1 (staging) is still blocked — no `climate-project-api-staging*`
stack exists in `795965600143`/us-east-2.

### 11.1 The pair, and why it is the gentlest pair there will be

| | roll back TO | roll forward TO (what serves now) |
|---|---|---|
| commit | `adcb81cabc3a67ded6dd8f6a21453ccc1eb1b3b1` | `074930f4cbb00fadd98548ae568137ca5ac6b66b` |
| ECR tag (repo `climate-project-api`, us-east-2) | `prod-adcb81ca…`, pushed 2026-11-16T22:39:27Z, digest `sha256:6dc7bd42…` | `prod-074930f4…` and `prod-latest`, pushed 2026-11-18T04:24:12Z, digest `sha256:bbe77395…` |
| built by | `deploy-prod` run 43967002998 | `deploy-prod` run 44232791073 |

Measured with `aws ecr describe-images --region us-east-2 --repository-name climate-project-api
--image-ids imageTag=<tag>`. The stack names `…:prod-074930f4…` as its `ImageIdentifier`, and
`/version` reports `074930f4…` (`describe-stacks`; `curl https://api.climate.timsint.com/version`).

- **No schema in the way.** `git diff --name-only adcb81ca 074930f4` → 16 files, **0** under
  `src/ClimateProject.Infrastructure/Migrations/`; the newest migration at both commits is
  `20261116025141_TwoFactorSignIn`. The workflow's delta step will print "No migration delta".
- **No stack change rides along.** `infra/aws/climate-project-api-prod-service.yml` is not among
  the 16 files, and the script re-passes the live stack's 20 parameters (all 20 of the
  template's, `describe-stacks`), so `ImageIdentifier` is the only value that moves.
- **What the API loses for the window**: `Anthropic` 13.9.0 → 12.60.0, `Anthropic.Bedrock` 1.0.3 →
  0.14.1, `Microsoft.OpenApi` 2.13.1 → 2.13.0 (csproj diff), and the SDK-13 form of the intake
  request in `ClaudeIntakeMappingModel.cs` (`92474486`) — that is, exactly the code that served
  production from 2026-11-16T22:42Z to 2026-11-18T04:27Z. No scheduler, mail, GDPR or survey code
  is in the range, so §6's PONR-2 and PONR-3 behave identically on both images.
- **The web needs nothing.** The web files in the range are `SemaforoChip.tsx` (an icon rename,
  `c1f52211`), its tests and `package.json`/lock; none calls an endpoint the older API lacks. The
  web stays on Vercel's current deployment throughout. Do not roll it.
- **The horizon is not close.** 41 tagged images are in the repository and `adcb81ca` is the
  second newest; the lifecycle keeps 40 `prod-*` (`aws ecr get-lifecycle-policy`). Its "untagged
  after 7 days" rule does not reach an image index's children: the untagged children pushed with
  `prod-5018ff32` on 2026-10-20 are still there 29 days later (`describe-images`).
- **`deploy-drift` stays green.** `adcb81ca` is 14 commits behind `074930f4`
  (`git log --oneline adcb81ca..074930f4 | wc -l`) and its ancestor; the threshold is 20
  (`deploy-drift.yml:43`).

### 11.2 Preconditions — any "no" means do not dispatch

| # | Check | How (read-only) | Must be |
|---|---|---|---|
| P1 | **No survey is live**, and none starts or closes in the next two hours | The user, in the admin console. An agent cannot check this without signing in to production, which it must not do | none |
| P2 | **The user dispatches**, and names the decision owner in `reason` | — | a person |
| P3 | Production serves `074930f4` | `curl -sS https://api.climate.timsint.com/version` | `"commit":"074930f4cbb00fadd98548ae568137ca5ac6b66b"` |
| P4 | Nothing that runs in the API or shapes its stack changed on main since | `git fetch -q origin && git diff --name-only 074930f4cbb00fadd98548ae568137ca5ac6b66b origin/main -- src/ infra/aws/ Dockerfile` | prints nothing |
| P5 | Nothing queued in the `deploy-prod` concurrency group | `gh run list --workflow deploy-prod.yml --limit 3` and `gh run list --workflow rollback-prod.yml --limit 3` | no `queued` or `in_progress` |
| P6 | No alarm already firing | `aws cloudwatch describe-alarms --region us-east-2 --state-value ALARM --query 'MetricAlarms[].AlarmName'` | `[]` (all 27 were `OK` at writing) |
| P7 | A backup younger than 12 hours | `aws s3 ls s3://climate-project-db-backups-795965600143-us-east-2/climate/$(date -u +%Y/%m/%d)/` | a key from today; if not, the user dispatches `gh workflow run db-backup.yml --ref main` and waits for green |
| P8 | Optional, from a laptop in `795965600143`: the dry run the workflow also does first | `./scripts/rollback-api-image.sh --stack climate-project-api-prod --target-sha adcb81cabc3a67ded6dd8f6a21453ccc1eb1b3b1` | ends `DRY RUN complete. Nothing was changed.` |

Two notes on P4. The workflow deploys **main's** copy of the service template and reports the
migration delta against **main**, so a merged-but-undeployed change under `src/` or `infra/aws/`
would ride along or distort the delta — hence "nothing under those paths", not "main equals
`074930f4`". And the `recovery-drills` branch that added this section changes no API code: it
adds the script's account guard, its us-east-2 default for laptop runs, and the workflow's
before-swap record. If it is not merged, main's copies still target production correctly
(`rollback-prod.yml` passes `--region us-east-2` to the script explicitly); if it is, P4 still
holds, because it touches nothing under `src/`, `infra/aws/` or the `Dockerfile`.

The production environment has **no required reviewer** (`gh api
repos/TIMSInternational/organizational-climate-platform/environments/production` → a
`branch_policy` rule only), so a dispatch runs the moment it is sent. The `confirm` phrase is the
only gate.

### 11.3 The commands

Start one probe per swap, each in its own terminal and directory, a minute before its dispatch.
It makes zero AWS calls; 2 workers at 1 s is the load of the 2026-09-01 baseline in §8.0; and its
summary measures around the LAST commit flip it saw, hence one probe per swap:

```bash
scripts/rollback-probe.sh https://api.climate.timsint.com 600 1.0 2 ~/rollback-rehearsal-1-back
```

**Step 1 — roll back to `adcb81ca`** (the user):

```bash
gh workflow run rollback-prod.yml \
  --repo TIMSInternational/organizational-climate-platform \
  --ref main \
  -f target_sha=adcb81cabc3a67ded6dd8f6a21453ccc1eb1b3b1 \
  -f confirm='roll back production' \
  -f reason='REHEARSAL 1 (#159, rollback.md §11): planned, no trigger met; decided by <name> at <UTC>'
gh run list --workflow rollback-prod.yml --limit 1        # note the run id
gh run watch <run-id> --exit-status
```

**Hold** on `adcb81ca` until the synthetic probe has logged it once (it runs every 15 minutes, so
at most about 15 minutes; §11.4). Then start the second probe:

```bash
scripts/rollback-probe.sh https://api.climate.timsint.com 600 1.0 2 ~/rollback-rehearsal-1-forward
```

**Step 2 — roll forward to `074930f4`**, through the same workflow, because the image exists: no
35-minute test run (`Test API` ran 03:47:08 → 04:22:43 in run 44232791073), no rebuild, and
`prod-latest` is not moved:

```bash
gh workflow run rollback-prod.yml \
  --repo TIMSInternational/organizational-climate-platform \
  --ref main \
  -f target_sha=074930f4cbb00fadd98548ae568137ca5ac6b66b \
  -f confirm='roll back production' \
  -f reason='REHEARSAL 1 (#159, rollback.md §11): roll FORWARD to the deployed commit; decided by <name> at <UTC>'
gh run list --workflow rollback-prod.yml --limit 1
gh run watch <run-id> --exit-status
```

The `confirm` phrase is the same in both directions: it is a literal in `rollback-prod.yml`.

### 11.4 What to watch

| Signal | Command | Expected |
|---|---|---|
| The run | `gh run watch <id> --exit-status`, then its job summary | green; "No migration delta"; the record names the commit serving before the swap and the target |
| `/version` | `while sleep 10; do printf '%s ' "$(date -u +%T)"; curl -sS --max-time 10 https://api.climate.timsint.com/version \| jq -r .commit; done` | flips once per step (`074930f4…` → `adcb81ca…`, then back); never `null` or empty for more than one sample |
| `/ready` | `curl -sS -w ' %{http_code}\n' https://api.climate.timsint.com/ready` | `200`, body `"status":"ready","database":"ok"`, throughout |
| Synthetic probe | `aws logs filter-log-events --region us-east-2 --log-group-name /aws/lambda/climate-project-api-prod-synthetic-probe --start-time $(( ($(date +%s) - 1800) * 1000 )) --filter-pattern '"running:"' --query 'events[].message' --output text` | each 15-minute tick logs `running: <commit> built <time>`; the first after step 1 names `adcb81ca…`, the first after step 2 `074930f4…`. The log group is measured (`describe-log-groups`); this command has not been run |
| Alarms | `aws cloudwatch describe-alarms --region us-east-2 --state-value ALARM --query 'MetricAlarms[].AlarmName'` | `[]` before, during, and for 30 minutes after step 2 |
| App Runner | `aws apprunner list-operations --region us-east-2 --service-arn arn:aws:apprunner:us-east-2:795965600143:service/climate-project-api-prod/93676dfce5c941cd9ce43caf671c9918 --max-results 2` | the newest `UPDATE_SERVICE` is `SUCCEEDED` |
| The two probes | their summaries | requests, non-200, longest gap — for §8 |

The alarms a bad swap would trip, as configured (`describe-alarms`, 2026-11-18):
`…-5xx-elevated` at ≥ 20 5xx in 300 s; `…-readiness-failing` at ≥ 3 in 300 s;
`…-instance-replacement-loop` at ≥ 3 in 900 s; `…-synthetic-probe-api-down` on any failed probe
in an 1800 s period (missing data breaches); `…-synthetic-probe-api-slow` on an average above
2500 ms in 2 of 2 periods of 1800 s. A slow first health check on the new instances is expected,
not a failure (§8.1).

### 11.5 How long it should take

Built from the three most recent deploys (the 2026-11-18 amendment in §3.2). There has never been
a rollback to measure.

| Part | Basis | Expect |
|---|---|---|
| queue, checkout (full history), phrase, delta, credentials, dry run | deploy-prod's checkout took 3–6 s at depth 1; the rest is a few API calls | under 1 min |
| `aws cloudformation deploy` of the image swap | deploy-prod's same step: 3m07s, 3m38s, 3m09s; App Runner `UPDATE_SERVICE` 2m28s–2m41s | 3–4 min |
| the script's `/version` wait | CloudFormation returns after App Runner's operation completes | seconds |
| readiness canary, 20 consecutive 200s at 5 s | 1m36s, 1m38s, 1m39s | about 1m40s |
| **one dispatch** | | **about 5–7 minutes** |
| **the whole rehearsal** | two dispatches, a hold of up to 15 min, 30 min of alarm watch | about 30 min hands-on, 60 min to close |

### 11.6 Abort criteria

| If | Then |
|---|---|
| The run fails before `Roll back` (phrase, SHA, delta, credentials, dry run) | Nothing changed. Read the log and stop the rehearsal. |
| The delta step reports **any** migration | Stop. It contradicts §11.1, so main moved (P4). Do not continue. |
| The dry run says the tag is not in ECR | Stop. §11.1's horizon measurement is wrong. |
| `Roll back` fails inside CloudFormation | CloudFormation restores the previous `ImageIdentifier`. Confirm `/version` is still `074930f4…`; stop; record. |
| The script's `/version` wait (600 s) or the canary (300 s) fails | Read `/version`. Whatever it says, **run step 2 now**: `074930f4` is the known-good image. |
| During the hold: an alarm in `ALARM`, `/ready` non-200 on 3 consecutive 10-s samples, any user-reported error, or anyone about to open a survey | **Run step 2 now.** Do not wait out the hold. |
| Step 2 itself fails | `gh workflow run deploy-prod.yml --ref main` rebuilds and redeploys main (run 44232791073 took 42m45s end to end). Tell the decision owner meanwhile. |

### 11.7 Afterwards

- Fill §8's "Rehearsal 1" column: date, who, `074930f4 → adcb81ca → 074930f4`, both run ids, the
  `Total wall clock` line from each run's `Roll back` log, both probe summaries, "0 migrations"
  from the delta step, and what surprised you.
- Confirm the end state is the start state: `/version` → `074930f4…`; the stack's
  `ImageIdentifier` → `…:prod-074930f4…` (`aws cloudformation describe-stacks --region us-east-2
  --stack-name climate-project-api-prod --query
  "Stacks[0].Parameters[?ParameterKey=='ImageIdentifier'].ParameterValue"`); `prod-latest` still on
  digest `sha256:bbe77395…`; alarms `OK` 30 minutes after step 2.
- §7.1 asks for two clean runs before #159 closes. The second is a separate decision.
