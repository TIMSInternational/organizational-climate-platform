# Cutover rollback runbook — #159

**Status: UNTESTED.** An untested rollback plan is a document, not a capability (#159's
own words). It becomes a capability when it is practised from the dry-run state during
#157 and the blanks at the bottom hold measured values. Grounded in repository state at
`origin/main` commit `1219dc6` (2026-08-15).

Companion: [`cutover.md`](./cutover.md). The TTL lowering in its Phase B is what makes
the DNS half of this document fast; skipping it does not break rollback, it makes
rollback *slow* exactly when speed matters.

---

## What "roll back" means, layer by layer

"Roll back" is four different operations with four different reversibility properties.
Conflating them is how a rollback makes things worse.

| Layer | Mechanism | Reversible? |
|---|---|---|
| DNS | Revert records to pre-cutover targets | **REVERSIBLE** — bounded by TTL |
| App Runner service | Redeploy a previous image tag | **REVERSIBLE** — images persist in ECR |
| Database schema | EF migrations history vs. checkout — check, then decide | **PARTIALLY** — additive yes, rewrites lossy |
| Data written after the flip | Pre-decided handling (below) | **NOT REVERSIBLE** — this is the point of no return |

### 1. DNS — REVERSIBLE, speed bounded by TTL

Revert every record changed in `cutover.md` D6 to the pre-cutover targets recorded in
its Phase B1 table. Nothing on the legacy side needs to change: the legacy Vercel deploy
and MongoDB Atlas were left running and untouched (that is why #162 forbids
decommissioning on the day, and why #165 is a separate, later phase).

The revert propagates at the speed of the TTL clients cached — **nothing server-side
can evict a resolver's cache**. With Phase B done, that is ≤ 300 seconds. If Phase B
was skipped, clients keep hitting the new stack for up to the old TTL (potentially a
day), during which they continue **writing to Postgres** — which widens the very data
loss this rollback is trying to contain. That is the sense in which a long TTL quietly
ruins the rollback.

Verify: `dig +noall +answer <record> @8.8.8.8` and `@1.1.1.1` return legacy targets;
legacy access logs show traffic returning (also the evidence #163 wants).

### 2. App Runner service — REVERSIBLE

Not needed to return to the *legacy* stack (it does not run on App Runner). This is for
the adjacent case: rolling the **new** API back to a previous build without abandoning
cutover.

`deploy-prod.yml` tags every image `prod-<full-commit-sha>` and pushes it alongside
`prod-latest` ("Build and push API image" step), so previous builds persist in ECR.
Rollback is a stack update pointing `ImageIdentifier` at the previous SHA's tag:

```
aws cloudformation deploy \
  --stack-name climate-project-api-prod \
  --template-file infra/aws/climate-project-api-prod-service.yml \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides ServiceName=climate-project-api-prod \
    ImageIdentifier=<ecr-uri>:prod-<previous-sha> \
    ... (every other parameter, explicitly)
```

Pass **all** parameters, exactly as the workflow does — `aws cloudformation deploy`
reuses a parameter's previous stack value when omitted, which made deployed
configuration a function of invisible prior state before the workflow was fixed (comment
on the "Deploy App Runner service stack" step; `infra/aws/README.md`). Use the
workflow's parameter list as the checklist.

Verify: `curl -sSf "$API/version" | jq -r .commit` reports the previous SHA
(`src/ClimateProject.Api/Program.cs:501`), then 20 consecutive `/ready` 200s (the #220
defect alternates; one probe proves nothing — `infra/aws/README.md`).

**This rolls back code only. It never rolls back schema** — which is the next section,
and skipping it is the trap.

### 3. Database schema — CHECK FIRST, every time

`deploy-prod.yml` applies EF Core migrations as a workflow step ("Apply EF Core
migrations"), **before** the service rollout. Rolling the service image back therefore
leaves the database at the *newer* schema: schema and code versions have come apart, and
they do not reconverge on their own.

**How to check — run this before any rollback, and again before the next deploy:**

```
# 1. The migrations the commit you are rolling back TO knows about:
git checkout <target-sha>
git ls-files 'src/ClimateProject.Infrastructure/Migrations/*.cs' | grep -v Designer

# 2. The migrations the database has applied (session pooler, port 5432 — never 6543,
#    never db.<project-ref>.supabase.co from an IPv4-only host; both are rejected by
#    name in deploy-prod.yml's migration step, for the reasons documented there):
psql "$MIGRATION_CONN" -c 'SELECT "MigrationId" FROM "__EFMigrationsHistory" ORDER BY "MigrationId";'
```

(The history table is EF's default `__EFMigrationsHistory` — no custom history table is
configured anywhere in `src/ClimateProject.Infrastructure`.)

Every `MigrationId` present in the database but absent from the target commit is schema
the rolled-back code has never seen. Then decide, per migration:

- **Additive** (new table, new nullable column, new index): safe to leave applied. Old
  code does not select what it does not know. Most of this repo's migrations are in
  this class — e.g. `20260810180421_AddSurveyDraftExpiresAtIndex`.
- **Rewrites/renames**: not safe to leave. Example already in the tree:
  `20260804002058_RenameOpenTextQuestionTypeToOpenEnded` rewrites
  `microclimate_questions.type` rows to a value pre-migration code fails validation on.
  Its `Down` exists but is **deliberately lossy** (its own comment: rows authored as
  `open_ended` after the migration are indistinguishable from renamed ones and all map
  back). Reverting a rewrite is a decision about data, not a mechanical step.

To revert schema explicitly:

```
dotnet ef database update <LastCommonMigrationId> \
  --project src/ClimateProject.Infrastructure \
  --startup-project src/ClimateProject.Api
```

Run this **from the newer checkout** — the one that contains the migrations being
reverted. The older checkout does not have their `Down` methods and cannot revert them.

**The corruption trap this section exists to prevent:** suppose the history table is
left ahead (fine so far), and someone then cuts a hotfix branch from the *older* commit
and adds a **new** migration on it. EF scaffolds that migration against the older
snapshot — one that does not contain the still-applied newer migrations — and computes
"pending" as *files minus history*. The next `deploy-prod.yml` dispatch then runs
`dotnet ef database update` (after tests, before rollout) and applies DDL generated
against a schema that is not the one in the database. Depending on the overlap this
fails the deploy mid-workflow or, worse, succeeds and leaves the schema wrong. **The
rule: never author a new migration from a branch whose `Migrations/` set is behind
`__EFMigrationsHistory`. Run the check above first, always.** A rollback that forgets an
applied migration corrupts the *next* deploy, not the rollback itself — which is why the
check has to be a written step and not a memory.

### 4. The legacy application — REVERSIBLE while it stays warm

- The legacy Vercel deploy and MongoDB Atlas are untouched by cutover: the ETL **reads**
  Mongo and **writes** Postgres (`docs/superpowers/specs/2026-08-03-mongo-to-postgres-etl-design.md`);
  D1's write-freeze is a config state, not a data change. Unfreezing legacy writes
  restores the pre-cutover world exactly — *minus whatever was written to the new stack
  after the flip* (next section).
- Keep the legacy stack deployable and its data intact until #165 — decommissioning is
  deliberately a separate, later phase (#159, #162).
- **Redeploy hazard:** if a rollback requires redeploying the legacy app, deploy only
  from the retired repo's current HEAD. Its history holds a live malware sample at
  `40fc19a`; any checkout from before removal commit `81363af` (2026-07-29) carries a
  `tailwind.config.js` payload that executes on build
  (`docs/security/rotation-inventory.md`, "Related";
  `docs/security/2026-07-30-tailwind-payload-analysis.md`).

### 5. Data written after the flip — **NOT REVERSIBLE. This is the ETL cutover moment.**

Up to and including `cutover.md` D5, rollback is free: DNS never moved, users never
touched the new stack, and abandoning the loaded Postgres data costs nothing (the ETL
is re-runnable; Mongo was never modified).

**The point of no return is the first real user write to the new stack after D6.**
From that moment, returning to legacy discards those writes — survey responses,
action-plan updates, notifications state — unless the pre-decided handling below
applies. There is no mechanism in either stack that ports Postgres writes back to
Mongo; anything of that kind would be new engineering, decided and built before the
day, never improvised during an incident.

#159 requires this decided **in advance** and written down. Options:

| Option | Cost | Decision |
|---|---|---|
| (a) Read-only window: new stack serves reads but rejects writes for the first `____` after the flip; rollback inside it loses nothing | Users cannot submit during the window | ☐ |
| (b) Forward-port: tooling exports post-flip Postgres writes back to Mongo on rollback | Tooling that does not exist at `1219dc6`; must be built and tested before the day | ☐ |
| (c) Accept the loss: rollback inside the watch period discards post-flip writes, announced in the maintenance comms | Real user data lost, bounded by trigger speed | ☐ |

**Chosen option: `____` Decided by: `____` Date: `____`**

**Formal point of no return** (past this, roll forward only — fix on the new stack, do
not return to legacy): `____` (e.g. "T+4h after D6, or the moment option (a)'s
read-only window is lifted, whichever comes first"). Owner who can call it: `____`

---

## Trigger criteria — agree BEFORE the window (#159: deciding during an incident goes badly)

Rolling back is a decision made against pre-agreed thresholds by a named owner, not a
mood. Suggested rows below are grounded in known failure modes; thresholds are blanks
because they are the owner's call, not this document's.

| Trigger | Threshold | Measured how | Roll back? | Owner |
|---|---|---|---|---|
| `/ready` failing post-flip | `____` consecutive non-200s | C2-style probe loop | `____` | `____` |
| Login failure rate through the real domain | `____` | `____` (monitoring, #158) | `____` | `____` |
| Tracking dashboards empty (silent identity failure — the #155 mode: GUID fallback in `TrackingIdentifiers.ExternalPersonaId`, no error anywhere) | any confirmed orphaned record | D4's resolution check re-run | `____` | `____` |
| Reconciliation error discovered post-flip | any content mismatch | data-quality report / user report | `____` | `____` |
| Error rate on writes | `____` | `____` | `____` | `____` |

**Rollback decision owner (one name, reachable for the whole watch period): `____`**

---

## The procedure, in order

| # | Step | Reversible? | Measured duration |
|---|---|---|---|
| R1 | Owner declares rollback, notes the trigger met and the time | — | `____` |
| R2 | Stop new-stack writes (per the chosen post-flip option; mechanism `____` — e.g. maintenance flag / `aws apprunner pause-service`, **console state**, verify in the dry run) | yes | `____` |
| R3 | Revert DNS to the Phase B1 targets | yes | `____` |
| R4 | Unfreeze legacy writes (undo `cutover.md` D1) | yes | `____` |
| R5 | Verify legacy serving: smoke-test login + a write through the real domain; legacy access logs showing traffic | — | `____` |
| R6 | Revert `services/tracking-api` config if D7 had run (`ClimateProjectBaseUrl`, `ProcomerCompanyId` back to C5's recorded baseline) and redeploy it | yes | `____` |
| R7 | Execute the post-flip-writes decision (nothing to do under (a) inside the window; run the port under (b); record the loss under (c)) | **no** | `____` |
| R8 | Run the §3 schema check and file the result with the incident notes, so the next deploy is not the second incident | — | `____` |
| R9 | Post-mortem before any second cutover attempt | — | — |

Total measured rollback time (R1–R7): `____` — this number must comfortably fit inside
the watch period, or the watch period is theatre.

---

## Practice record (#157 / #159 acceptance criteria)

| | Practice 1 | Practice 2 |
|---|---|---|
| Date | `____` | `____` |
| From what state (post-D2 / post-D6 simulated) | `____` | `____` |
| Total time R1–R7 | `____` | `____` |
| What failed / surprised | `____` | `____` |
| Legacy confirmed still deployable | `____` | `____` |
| Doc updated | `____` | `____` |
