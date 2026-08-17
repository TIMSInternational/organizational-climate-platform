# Production cutover runbook — #157 (dry run) / #162 (the day)

**Status: TEMPLATE — no dry run has been executed.** Every `____` below is a blank the
first dry run against staging (#157) fills with a **measured** value, so the run records
data instead of prose. #157's own acceptance criteria require two consecutive clean runs
and this runbook updated with real timings; #162 requires an explicit human go-ahead on
the day. Grounded in repository state at `origin/main` commit `1219dc6` (2026-08-15) —
re-verify any cited claim if you are reading this much later, since this repo's docs have
gone stale before.

Companions:

- [`rollback.md`](./rollback.md) — what "roll back" means per layer, and the one moment
  that is not reversible. Read it **before** the window opens, not during an incident.
- [`legacy-dependencies.md`](./legacy-dependencies.md) — everything still pointing at the
  legacy stack, row by row, with what replaces it.

Claims below that depend on console state (Vercel, AWS, Supabase, Google Cloud, the DNS
host) are marked as such; nothing in this repository can verify them.

---

## Phase A — prerequisite gates (weeks before)

Every gate must be green before a cutover **date** is even chosen. Status column reflects
commit `1219dc6`; update it as gates close.

| # | Gate | Tracking | Status at `1219dc6` |
|---|---|---|---|
| A1 | Worker hosting decided **and deployed** | #275 | **OPEN — hard gate, see below** |
| A2 | ETL tool built, reconciliation harness included | #154 | **Tool does not exist in the repo** (no `tools/` project; design only) |
| A3 | Staging environment with production parity | #156 | Open |
| A4 | Monitoring/alerting live, worker heartbeats scraped | #158 | Open — `WorkerHeartbeats` exists, nothing scrapes it (#275 notes this) |
| A5 | Rollback tested, not just written | #159 | Open — [`rollback.md`](./rollback.md) is untested until #157 practises it |
| A6 | Secret rotation | #70 | **NOT STARTED** per `docs/security/rotation-inventory.md` |
| A7 | Runtime DB secret on session pooler (5432) and guard armed | #220 | **Live secret still says 6543** per `infra/aws/README.md` ("Arming the guard") |
| A8 | Production email actually configured | — | **Not configured**, see A8 below |
| A9 | `deploy-prod.yml` has at least one successful dispatch | — | **Zero dispatches, lifetime**, per `infra/aws/README.md` ("Status as of 2026-08-05") |
| A10 | UAT complete | #161 | Open (requires #100 invitations working) |

### A1 — Worker hosting decision (#275): an explicit prerequisite gate

This is a gate, not a task, because cutting over without it produces a **silent** outage:
the legacy Vercel cron (`climate-project/vercel.json`) runs `/api/cron/send-reminders`
every 15 minutes in production today, and its replacement has never executed anywhere.

The facts, each verifiable in this repo:

- `.github/workflows/deploy-prod.yml` builds only the root `Dockerfile` (the API image).
  `Dockerfile.workers` exists at the repo root and is referenced by **no workflow**.
- `ClimateProject.Api.csproj` has no `ProjectReference` to `ClimateProject.Workers`, so
  the API host cannot run the jobs incidentally.
- `infra/aws/` defines exactly one service (`climate-project-api-prod-service.yml`).
- Therefore every job in `WorkerJobs.All`
  (`src/ClimateProject.Application/Scheduling/WorkerJobs.cs`) — `notification-dispatch`,
  `invitation-reminders`, `digests`, `scheduled-reports`, `survey-draft-retention`,
  `retention-cleanup` — has **never run in production**.

#275 offers two fixes (second service vs. co-host in the API); either is correct — the
advisory-lease design in `docs/superpowers/specs/2026-08-06-scheduling-design.md` makes it
an operational choice. What this gate requires is that one is **chosen, recorded in
`docs/decisions/`, deployed, and evidenced by a heartbeat log line in production** —
#275's own acceptance criteria. Code existing is not the gate; a log line is.

**Exit criterion:** a structured heartbeat line from each of the six jobs observed in
production logs. `____` (date observed, who verified)

### A2 — ETL tool (#154)

Design is settled in `docs/superpowers/specs/2026-08-03-mongo-to-postgres-etl-design.md`
(deterministic v5 GUIDs, idempotent upserts, dependency-ordered load, three-layer
reconciliation), but at `1219dc6` **no `tools/ClimateProject.DataMigration` project
exists** — searching the repo for `DataMigration` finds only doc comments. The design
also records blockers that are not the ETL's to solve: #58/#113 (question collections
have no target schema), and the #195 language-attribution rules for five collections.
`Response`/`QuestionResponse` must load **after** #195's options migration (see the
design's addendum §3).

**Exit criterion:** tool exists, `--dry-run`/`--collections`/`--resume`/`--report-path`
flags work, reconciliation harness (sub-issue G) built alongside, and a full run against
a production snapshot completes on staging.

### A7 — database secret on the session pooler, guard armed (#220)

**Done in full as of 2026-08-17** — secret flipped and verified 2026-08-10, and
`Database__RequireSessionPooler` armed `"true"` in the template. Kept for the record:

Do this **before cutover week**, not during. While the runtime secret points at port
6543, `/ready` alternates 200/timeout on the live service (measured in
`infra/aws/README.md`, "Connection pooling"), which turns every canary in Phase C and D
into noise — you cannot distinguish "cutover broke something" from the pre-existing
defect. The ordered fix (flip the secret → verify 20+ consecutive `/ready` 200s and the
`TRANSACTION pooler` warning gone from App Runner logs → set
`Database__RequireSessionPooler` to `"true"` in
`infra/aws/climate-project-api-prod-service.yml`) is written down under "Arming the
guard" in `infra/aws/README.md`. Steps 1–2 need write access to the Secrets Manager
value `climate-project-api/prod/database-connection-string` (console state).

### A8 — production email

The new stack has a real SMTP sender (`SmtpEmailTransport`, registered at
`src/ClimateProject.Api/Program.cs:348`), but delivery falls back to logging stubs when
`EmailOptions` is unconfigured (`Program.cs` factory around lines 360–366, announced by
a startup WARNING). `infra/aws/climate-project-api-prod-service.yml` passes **no
`Email__*` environment variables**, so production email today is the stub: nothing
sends. The legacy stack sends mail via Brevo SMTP (per
`docs/security/rotation-inventory.md` row E, citing legacy `ENV_VARIABLES.md`).
Cutover with A8 open means invitations and reminders silently stop.

**Exit criterion:** email configuration delivered to the App Runner service (mechanism:
`____`), a real invitation email received in an inbox from the production service, and
the startup stub-warning absent from logs. `____` (date, who verified)

---

## Phase B — DNS TTL lowering (DAYS before — hard scheduling constraint)

**Why days before:** rollback (see `rollback.md`) is a DNS revert, and a revert
propagates no faster than the TTL that was on the record **when clients cached it**. A
86400-second TTL means up to 24 hours of users pinned to the new stack after you have
"rolled back" — the long TTL quietly ruins the rollback while everything else works.
Lowering the TTL is itself subject to the *old* TTL: resolvers keep serving the cached
record (with the old TTL) until it expires. So the lowering must precede the window by
**at least the longest current TTL, with margin**.

Today production runs on generated hostnames — an App Runner `*.awsapprunner.com` URL
and `organizational-climate-platform.vercel.app` (#160; `README.md:75-76`). The
customer-facing domain and its DNS host appear nowhere in this repository:
**UNVERIFIED-NEEDS-CONSOLE** — see `legacy-dependencies.md` row 9. Enumerate before you
lower.

| Step | Action | Blank to fill |
|---|---|---|
| B1 | Enumerate every DNS record involved (apex, `www`, API subdomain, anything mail-related) at the DNS host | records: `____` current TTLs: `____` |
| B2 | At **T minus `____` (≥ the longest TTL found in B1, and no less than 3 days)**: lower every record's TTL to ≤ 300 s | date done: `____` by: `____` |
| B3 | Verify with `dig +noall +answer <record>` from at least two public resolvers (`@8.8.8.8`, `@1.1.1.1`) that the served TTL is ≤ 300 | date: `____` output kept where: `____` |
| B4 | Update `CORS_ALLOWED_ORIGIN` (GitHub `production` environment variable → `CorsAllowedOrigin` stack parameter, `deploy-prod.yml` / `infra/aws/climate-project-api-prod-service.yml`) to the final customer domain and redeploy, **before** any user resolves to the new stack | date: `____` deploy run: `____` |
| B5 | Confirm the Google OAuth client's authorized JavaScript origins / redirect URIs include the final domain (the web flow redirects back to `<origin>/auth/loading` — `web/src/auth/googleOAuth.ts`, `GOOGLE_REDIRECT_PATH`). Google Cloud console: **UNVERIFIED-NEEDS-CONSOLE** | date: `____` |

---

## Phase C — pre-flight checks (cutover day, before freezing legacy writes)

Run in order. Any failure is a **no-go**; do not improvise fixes inside the window.

Let `API` be the live API base URL (today
`https://bhgrdkd4gt.us-east-1.awsapprunner.com`, per `infra/aws/README.md`; the custom
domain after #160).

### C1 — `/version` drift check

```
curl -sSf "$API/version" | jq -r .commit
```

Must equal the commit you intend to serve (normally `origin/main` HEAD). `/version`
reports the commit the running image was built from
(`src/ClimateProject.Api/Program.cs:501`); `deploy-prod.yml`'s final step asserts this
at deploy time precisely because production once sat **156 commits behind main
unnoticed** (comment on the "Verify deployed commit matches this run" step). If it does
not match, the fix is a deploy, and the cutover date moves.

- Expected commit: `____` Reported: `____` Duration: `____`

### C2 — `/ready` canary

```
for i in $(seq 1 20); do curl -s -o /dev/null -w "%{http_code}\n" "$API/ready"; sleep 3; done
```

**All 20 must be 200.** Twenty and not one, because the known #220 failure mode
*alternates* — `infra/aws/README.md` records five timeouts in ten probes on the live
service, and "one green probe proves nothing." `/ready` round-trips Postgres with a real
`SELECT 1` (`src/ClimateProject.Api/Program.cs:468`); `/health` is a static literal and
proves nothing about the database.

- 20/20 green: `____` Duration: `____`

### C3 — migrations at head, and the #155 index gate: **index before ETL**

```
# What the deployed commit contains:
git ls-files 'src/ClimateProject.Infrastructure/Migrations/*.cs' | grep -v Designer

# What the database has (session pooler, port 5432):
psql "$MIGRATION_CONN" -c 'SELECT "MigrationId" FROM "__EFMigrationsHistory" ORDER BY "MigrationId";'
```

The two lists must match — migrations are applied by `deploy-prod.yml` as a workflow
step ("Apply EF Core migrations"), so a matching list is evidence the deploy path ran,
not an assumption.

This check is also the **ordering gate for the identity backfill**: migration
`20260801012028_AddPersonaExternalIdUniqueIndex` creates the **unique** filtered index
`IX_users_persona_external_id` on `users.persona_external_id`. It must exist **before**
the ETL runs, never after, because of an asymmetry in how the two failure modes present:

- `TrackingIdentifiers.ExternalPersonaId`
  (`src/ClimateProject.Application/Tracking/TrackingIdentifiers.cs:9`) falls back to the
  fresh Postgres GUID when `PersonaExternalId` is null — so a **missed or wrong backfill
  is silent**: `/api/internal/personas` happily returns GUIDs, and every existing
  tracking record (`PlanDeAccion.NodoExternalId`, `LiderExternalId`,
  `UsuarioExternalId` in `services/tracking-api`) dangles, presenting as empty
  dashboards with no error (#155).
- The unique index converts the one detectable variant — two users claiming the same
  legacy `_id` — into a **loud insert failure during the load**, where it is cheap,
  instead of a quiet corruption discovered from a dashboard.

So the order is fixed: **deploy (which applies migrations, including the index) → then
ETL (which backfills `PersonaExternalId` / `LegacyExternalId`)**. Running the ETL
against a database without the index forfeits the only loud failure this class of bug
has.

- Lists match: `____` `IX_users_persona_external_id` present (`\di+ IX_users_persona_external_id`): `____` Duration: `____`

### C4 — worker heartbeats (A1's evidence, re-checked on the day)

All six job names from `WorkerJobs.All` seen emitting heartbeat lines in production
logs within the last hour. The scheduling design logs a heartbeat on **every** tick
including no-op ticks, so absence is meaningful.

- Six seen: `____` Duration: `____`

### C5 — tracking service configuration read back

`services/tracking-api` reads `ProcomerCompanyId`, `ClimateProjectBaseUrl`,
`ClimateProjectInternalApiKey` (`services/tracking-api/src/ClimateTracking.Api/appsettings.json:13-15`
and `.../ClimateTracking.Workers/appsettings.json:10-12` — empty in the repo; the real
values are per-deployment, **console state**). Record what production currently holds so
D7 is an edit against a known baseline, not a guess:

- `ClimateProjectBaseUrl` today: `____` `ProcomerCompanyId` today: `____` Where configured: `____`

### C6 — TTLs actually low

Re-run B3's `dig` checks. A TTL that crept back up (or was never lowered on one record)
is a no-go — it silently caps rollback speed.

- All ≤ 300 s: `____`

### C7 — legacy stack still deployable, dump access confirmed

Rollback depends on the legacy stack being warm (#159). Confirm a legacy deploy is
possible **without executing one from an old commit**: the legacy repo's history holds a
live malware sample at `40fc19a` — building any checkout from before the removal commit
`81363af` (2026-07-29) executes it (`docs/security/rotation-inventory.md`, "Related").
Deploy only from the retired repo's current HEAD. Confirm also read access to the
production MongoDB (the ETL's source).

- Legacy deployable from safe HEAD: `____` Mongo dump access: `____`

### C8 — communications

Maintenance window announced; maintenance page ready (#141, per #162's scope).

- Done: `____`

### C9 — go/no-go

#162: **explicit human authorisation, recorded, on the day.** Named decision owner:
`____`. Rollback trigger table in `rollback.md` filled in and agreed: `____`.

- GO recorded at: `____` by: `____`

---

## Phase D — the window (sequence from #162)

Each step names its evidence. The Duration column is the whole point of the dry run:
the sum of D1–D8 is the maintenance window, and #157 exists to find out whether that
window is viable at all.

| # | Step | Evidence of success | Measured duration | If it fails |
|---|---|---|---|---|
| D1 | Freeze legacy writes (mechanism: `____` — legacy maintenance mode / Vercel env flip; **console state**, decide and record before the day) | Legacy app rejects writes; a test write fails | `____` | Unfreeze; abort — nothing has changed yet |
| D2 | Final ETL run against production Mongo → production Postgres. Connection: session pooler port 5432 (or the Supabase direct connection **only** from an IPv6-capable workstation — it is IPv6-only, `infra/aws/README.md`); **never** 6543 — transaction pooling breaks the multi-statement transactions the loader needs, same reason as EF migrations | Run completes; report written to `--report-path` | `____` ← **the number that sizes the window** | Re-run (idempotent by design — deterministic v5 IDs make every write an upsert); if still failing, abort and unfreeze |
| D3 | Reconciliation: per-collection counts with skip reasons summing to the difference, deterministic content spot-checks, FK integrity pass; **read** the data-quality report (ETL design §Reconciliation — a count match with mangled content is the failure mode to fear) | All three layers clean; report reviewed by a human | `____` | Abort and unfreeze — reconciliation failure post-flip is a rollback trigger, pre-flip it is a free abort |
| D4 | Identity continuity (#155): take ≥ 1 real `PlanDeAccion` from the tracking database and prove it resolves to the correct migrated user and department via `/api/internal/personas` + `/api/internal/nodos` (`src/ClimateProject.Api/Endpoints/TrackingInternalEndpoints.cs`); assert zero orphaned tracking records; assert no empty `nodo_id` | Record resolves; orphan count = 0 | `____` | Abort and unfreeze — this failure is silent post-flip (see C3) |
| D5 | Pre-flip smoke test against migrated data, via the App Runner URL and the Vercel frontend directly (no DNS involved): log in as each role, open every major page, run a report, view tracking dashboards (#157 scope) | Checklist of pages/roles all pass: `____` | `____` | Abort and unfreeze |
| D6 | **Flip DNS** to the new stack | `dig` from two public resolvers returns new targets | `____` | This step itself is reversible (revert the records). What follows it is not — see `rollback.md`, "point of no return" |
| D7 | Update `services/tracking-api` config: `ClimateProjectBaseUrl` → new API domain, `ProcomerCompanyId` → the migrated company GUID; redeploy the tracking service (both its Api and Workers hosts read these — C5's citations) | Tracking dashboards populate against migrated identities | `____` | Tracking degrades but the platform serves; fix forward within the window if possible |
| D8 | Post-flip smoke: `curl https://<custom-domain>/version` (commit check), 20× `/ready`, login through the real domain (exercises CORS per B4 and OAuth origins per B5) | All green | `____` | Evaluate against rollback triggers |
| D9 | Watch period, someone actually watching, rollback criteria live (#162) | No trigger met for its full length | planned length: `____` actual: `____` | Execute `rollback.md` |

**Total window (D1–D8): `____`** (dry-run measured; decide from this whether an offline
window is even acceptable — #157's stated purpose.)

## Phase E — after the window

- **Decommission nothing.** #162 is explicit: the legacy stack stays intact and
  deployable; retirement is M8 (#164–#167), gated on weeks of legacy access-log evidence
  (#163). See `legacy-dependencies.md`.
- Write every measured duration from this run back into this document — that is #157's
  final acceptance criterion, and #162 consumes the updated runbook.

---

## Dry-run record (#157 requires two consecutive clean runs)

| | Run 1 | Run 2 | (Run n) |
|---|---|---|---|
| Date | `____` | `____` | |
| Snapshot used (Mongo dump date) | `____` | `____` | |
| ETL duration (D2) | `____` | `____` | |
| Reconciliation clean? | `____` | `____` | |
| Rollback practised (per `rollback.md`)? | `____` | `____` | |
| Total window (D1–D8) | `____` | `____` | |
| Clean? | `____` | `____` | |
| Findings folded back into this doc | `____` | `____` | |
