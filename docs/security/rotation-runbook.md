# Secret rotation runbook — #70

Companion to [`rotation-inventory.md`](./rotation-inventory.md). Written 2026-08-15 from the
enumeration pass recorded there: every name, ARN, URL and timestamp below was read from a
live console or from the `production` GitHub environment on that date — none is guessed.
Where something could not be verified from this machine it says so inline.

**The standard this document holds itself to: the whole rotation is executable in one
sitting, top to bottom, without opening the code.**

## Ground rules

- **Never write a secret value** into this repo, an issue, a chat, or a screenshot. Names,
  locations, timestamps only.
- **Generate every value fresh** at rotation time. For anything embedded in a
  `key=value;`-style connection string, generate **hex or plain alphanumeric**
  (`openssl rand -hex 24`) — `;`, `'`, `"` and `=` inside a password break the string
  silently.
- **Revoke, don't merely replace.** An unrevoked old credential is still a live credential.
  Each item below names its revocation step; do not skip it.
- **Verify each item with its probe before starting the next.** A rotation without its probe
  is a change, not a rotation.
- **Roll forward, not back.** A retired value is never restored; if a new value is broken,
  fix it with another new value. The one exception is A's emergency rollback, described
  there.

## The one decision to make before sitting down

**Section A (`TrackingJwtSecret`) logs every user out of both products** the moment both
services restart on the new key. Two ways to do it:

1. **Hard logout (recommended).** One secret change, two redeploys, every live session dies
   at once, users log in again. Simple, loud, done in an hour.
2. **Two-key overlap.** Requires a **code change first** — `TokenValidationParameters` today
   accepts a single `IssuerSigningKey`; an overlap needs `IssuerSigningKeys` with old + new,
   shipped to both stacks, then the old key removed after the 24h token lifetime.

If you choose (2), **stop here and file the code change** — it cannot be improvised
mid-rotation. Everything below assumes (1). Either way, schedule A for a low-traffic hour
and tell whoever answers user questions that a mass logout is expected.

## Access you need open before starting

| Console | Needed for | Account / location |
|---|---|---|
| Supabase dashboard | B1, B2 | org `lbxqfmlcxervtttrspjv`, project `uleeeziiceduvmiftgby` (`organizational-climate-platform`) |
| AWS **production** | B1, C, A, E3 | `747814092517`, us-east-1 — Secrets Manager, App Runner, IAM |
| GitHub repo admin | B1 | `TIMSInternational/organizational-climate-platform`, `production` environment |
| Vercel — **legacy account** | E1, D2, inputs to B3/E4 | **Unknown — locating it is E1 step 1** |
| Vercel — current | E2 | `federico-4412` / team `federicos-projects-21f2ff63` |
| MongoDB Atlas | B3 | legacy cluster — host is in the legacy `MONGODB_URI` (via E1) |
| Google Cloud | D1 | the project owning the legacy OAuth client |
| Brevo | E4 | legacy sender account |
| AWS dev (this machine) | E3 | `795965600143` |

## Shared probes and patterns

**PROBE-READY** — 20 consecutive `/ready`, **all** must be 200. The #220 defect alternated
200/timeout, so one green probe proves nothing:

```sh
for i in $(seq 1 20); do curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 \
  https://bhgrdkd4gt.us-east-1.awsapprunner.com/ready; done
```

**PROBE-LOGIN** — open `https://web-one-green-86.vercel.app` (the production frontend;
the old `organizational-climate-platform.vercel.app` is a legacy deployment — see
`README.md` "Deployments", corrected 2026-08-18), log in with a
known account, open a page that renders data (not just the shell).

**REDEPLOY** — how a changed secret reaches the running API. App Runner resolves
`RuntimeEnvironmentSecrets` when instances launch, so `put-secret-value` alone changes
nothing until a new deployment:

```sh
aws apprunner start-deployment --region us-east-1 --service-arn "$(aws apprunner \
  list-services --region us-east-1 \
  --query "ServiceSummaryList[?ServiceName=='climate-project-api-prod'].ServiceArn" \
  --output text)"
```

Wait for the operation to finish (`aws apprunner list-operations --service-arn …`), then
PROBE-READY. Alternative: `gh workflow run deploy-prod.yml --ref main` — but note that
workflow has **never been dispatched in its life** (`infra/aws/README.md`); mid-rotation is
the wrong moment for its maiden run. Use `start-deployment`.

**SECRET-UPDATE** — the pattern for all three Secrets Manager values. Secrets Manager keeps
the old value as `AWSPREVIOUS` automatically:

```sh
# type the value into stdin rather than putting it on the command line / in history:
aws secretsmanager put-secret-value --region us-east-1 \
  --secret-id climate-project-api/prod/<name> \
  --secret-string "$(cat)"        # paste value, newline, Ctrl-D
```

**Execution order — B, C, D, E, then A.** Same as the inventory: independent,
non-disruptive items first; the one that logs everyone out goes last, scheduled, not
stumbled into.

---

## B1. Supabase Postgres password

*~20 minutes. Degraded DB connectivity between steps 3 and 5 — DB-touching API requests
fail; no user sessions are lost (the JWT key is untouched).*

Names (all verified 2026-08-15):

| What | Where |
|---|---|
| Reset page | `https://supabase.com/dashboard/project/uleeeziiceduvmiftgby/settings/database` |
| Runtime string | Secrets Manager `climate-project-api/prod/database-connection-string` (acct `747814092517`) |
| Migration string | GitHub secret `MIGRATION_DATABASE_CONNECTION_STRING`, `production` environment |
| Both strings' shape | host `aws-0-us-east-1.pooler.supabase.com`, port **5432**, username `postgres.uleeeziiceduvmiftgby` |

Never port 6543 (transaction pooler — Npgsql and EF both break on it, #220/#212); never
`db.uleeeziiceduvmiftgby.supabase.co` (IPv6-only, unreachable from GitHub Actions —
`deploy-prod.yml` rejects it by name).

1. Generate: `openssl rand -hex 24`.
2. Read the current runtime string to a terminal (not a file):
   `aws secretsmanager get-secret-value --region us-east-1 --secret-id
   climate-project-api/prod/database-connection-string --query SecretString --output text`.
   Prepare the new string: **identical, only the password swapped**. Do not "improve" the
   host or port while you are in there.
3. Dashboard reset page → **Reset database password** → paste the generated value. From this
   moment new DB connections from the live API fail — move immediately to 4.
4. SECRET-UPDATE the runtime string.
5. REDEPLOY. Replacement instances read the new secret.
6. **Verify:** PROBE-READY (20/20 green) + PROBE-LOGIN.
7. Update the migration string — same password swap (this string may legitimately differ in
   pool settings; change only the password):
   `gh secret set MIGRATION_DATABASE_CONNECTION_STRING --env production -R
   TIMSInternational/organizational-climate-platform` (paste when prompted).
8. Step 7 can only be *fully* verified by the next production deploy (only
   `deploy-prod.yml`'s migration step reads it). Note the rotation date on the inventory row
   so a later migration failure is traced here in seconds instead of a session.

**Blast radius:** minutes of DB-touching request failures between 3 and 5; any workstation
`psql` or dashboard session using the old password. **The classic miss is skipping step 7** —
it breaks migrations later, in a different session, looking unrelated.

**Rollback:** roll forward — reset again with a fresh value and repeat 4–7. `AWSPREVIOUS`
holds the old string for diffing only; a retired password is never restored.

**Optional finish-the-job (separate change, not this sitting):** arm
`Database__RequireSessionPooler` — `infra/aws/README.md`, "Arming the guard", step 3.

## B2. Supabase API keys — disable the legacy pair

*~5 minutes. Expected blast radius: zero.*

Per the inventory's timeline callout these keys are **out of incident scope** (the project
post-dates the window); this is hygiene. Enumerated 2026-08-15: `anon` + `service_role`
(legacy JWT format), one `sb_publishable_…`, one `sb_secret_…`.

1. `https://supabase.com/dashboard/project/uleeeziiceduvmiftgby/settings/api-keys` →
   the **Legacy API keys** tab.
2. **Disable** the legacy `anon`/`service_role` JWT keys. Disabling beats rotating: nothing
   in this stack uses them — the API speaks raw Postgres and the web speaks the API — and
   the PostgREST privileges behind them were already revoked on 2026-08-04
   (`LockDownPostgrestRoles`). A disabled key authenticates nobody, rotated or not.
3. **Verify:** PROBE-READY + PROBE-LOGIN — this is the measurement that the stack truly does
   not use them.
4. While in the dashboard: open **Advisors → Security** and read it for *this* project. (The
   MCP shortcut on the dev machine reports a different project's advisors — inventory,
   "Enumerated 2026-08-15".) File anything CRITICAL it shows.

**Rollback:** the same toggle re-enables the keys.

## B3. MongoDB Atlas — legacy (prefer decommission)

*Blocked until E1 recovers the legacy `MONGODB_URI` (its host names the cluster).*

The new stack has no Mongo anywhere; the strictly better move is to **decommission** rather
than rotate a credential for a database nothing should use again.

- **Decommission:** `cloud.mongodb.com` → the project → Database → the cluster → **⋯ →
  Terminate**. Take a final snapshot or `mongodump` first if there is any retention
  obligation — check before, not after.
- **Or rotate (if the legacy app must stay alive):** Security → Database Access → the user →
  Edit → **Edit Password**; delete users nothing uses; Network Access → remove `0.0.0.0/0`
  if present. Then update `MONGODB_URI` in the legacy Vercel env (E1) and redeploy the
  legacy app.

**Verify:** legacy app works, if it must; otherwise the cluster's absence is the
verification. **Rollback:** none needed for decommission (that is the point); for rotation,
roll forward.

## C. `InternalApiKey`

*~15 minutes. During the mismatch window `/api/internal/*` returns 401 per request
(fail-closed); user traffic is unaffected.*

Names: Secrets Manager `climate-project-api/prod/InternalApiKey` → climate API env
`InternalApiKey`; the only caller is climate-tracking, which holds the same value as
`ClimateProjectInternalApiKey` (its API **and** Workers).

0. **Confirm whether the tracking services run in production at all.** Their source lives in
   this repo (`services/tracking-api`) but no deploy pipeline for them exists here, and the
   frontend's direct client to them is documented as not production-usable (README, #56). If
   they are not deployed, steps 4–5 shrink to "record the new value wherever tracking's
   config will live". *(Unverifiable from this machine on 2026-08-15.)*
1. Generate: `openssl rand -hex 32`.
2. SECRET-UPDATE `climate-project-api/prod/InternalApiKey`.
3. REDEPLOY; PROBE-READY. A blank/failed write fails loudly — the host validates the key at
   startup (`ValidateOnStart`, #189), so a bad value means the deploy itself fails; that is
   the probe for it.
4. Set the same value as `ClimateProjectInternalApiKey` in the tracking deployment's config
   (API and Workers both) and redeploy them.
5. **Verify:** exercise one tracking→climate call and see 200 — or watch the climate App
   Runner application log for the **absence** of repeated
   `401 "Invalid or missing internal API key."`. Mismatch is per-request 401, fail-closed —
   tolerable for the minutes between 3 and 4.

**Rollback:** roll forward.

## D1. Google OAuth client secret — legacy only

*The new stack is untouched: it verifies Google ID tokens with the public client ID and
reads no client secret. Only the legacy NextAuth app used one.*

1. `console.cloud.google.com` → APIs & Services → Credentials → OAuth 2.0 Client IDs → the
   legacy NextAuth client → **Client secrets → Add secret** (Google allows two concurrent
   secrets exactly for rotation).
2. If the legacy app still runs: update its `GOOGLE_CLIENT_SECRET` env in the legacy Vercel
   project (E1) and redeploy it.
3. **Delete the old secret.** This is the revocation — without it, nothing was rotated.

**Blast radius:** legacy Google sign-in between steps 1 and 2 (none if the legacy app is
dead). **Verify:** Google sign-in on the new stack still works (it should be unaffected —
that is itself the check); legacy sign-in if alive. **Rollback:** the old secret exists
until step 3; after it, roll forward.

## D2. `NEXTAUTH_SECRET` — legacy

*Blocked on E1 — it lives in the legacy Vercel env.*

0. **The positive check first** (inventory, "History scan"): compare the live value's first
   characters against the published example at the legacy repo's `ENV_VARIABLES.md:128`
   (begins `8xK9…`). **If they match, the secret has been public in 194 commits** — treat
   every legacy session as compromised and say so in the incident notes, don't just quietly
   rotate.
1. Generate `openssl rand -base64 32`; replace the env var in the legacy Vercel project;
   redeploy the legacy app. If the legacy app is dead, delete the variable instead — an env
   var nothing reads is pure liability.

**Blast radius:** every legacy session. **Verify:** legacy login round-trip, if the app is
alive.

## E1. Legacy Vercel project — locate, walk, rotate

*The 2026-08-15 enumeration proves the legacy project is **not** under the only team the
`federico-4412` login can see (16 projects, none legacy). Until it is found, B3, D2 and
E4's env-side updates stay blocked.*

1. **Locate the owning account.** Candidates: a client-owned Vercel team, another personal
   login, or the project was deleted. The email that received the legacy deployment
   notifications identifies the account fastest. If deleted, record when and by whom (the
   dashboard activity log shows it) — deletion without rotation does **not** retire the
   values that were exposed.
2. **Walk the env** — the inventory's explicit first step: Project → Settings →
   Environment Variables → record **every key name**, per environment, into the inventory.
   Anything not already on the inventory becomes a new row before it gets rotated.
3. **Rotate each secret found**, routing to its owner: `MONGODB_URI` → B3;
   `NEXTAUTH_SECRET` → D2; `GOOGLE_CLIENT_SECRET` → D1; Brevo values → E4; anything new →
   its own provider's console, added to the inventory first.

The new `climate` project needs nothing — one public variable, created post-window
(inventory, "Enumerated 2026-08-15").

## E2. Vercel account/team API tokens

*Dashboard-only — tokens have no CLI listing, which is why enumeration could not pre-fill
this.*

1. `vercel.com` → account avatar → **Account Settings → Tokens**: delete **every token whose
   Created date is on or before 2026-07-29**. Repeat under the team's settings if team
   tokens exist.
2. Recreate what CI/automation actually needs, minimally scoped, and update those consumers.

**Blast radius:** any CLI or CI using a deleted token starts failing auth — re-auth with
`vercel login` / the new token. **Verify:** `vercel whoami` succeeds where needed and the
deleted tokens are gone from the list.

## E3. AWS access keys

**DEV `795965600143` — walked 2026-08-15, results on the inventory row.** The one in-window
key belongs to `tims-ats-dev` — its **single** access key, ID ending `…M75LO` (Active,
created 2026-05-28, last used 2026-06-25 for Bedrock in us-east-2, and present on this
developer machine as the `[tims-ats]` profile). Read the full ID back at execution time —
the user has exactly one key, so there is nothing to confuse it with:

```sh
aws iam list-access-keys --user-name tims-ats-dev       # note the old key's id (…M75LO)
aws iam create-access-key --user-name tims-ats-dev      # store in ~/.aws/credentials [tims-ats] + any CI that uses it
aws iam update-access-key --user-name tims-ats-dev \
  --access-key-id <old-key-id> --status Inactive
# run whatever consumes the profile once; then confirm usage moved:
aws iam get-access-key-last-used --access-key-id <new-key-id>
# after a quiet day or two:
aws iam delete-access-key --user-name tims-ats-dev --access-key-id <old-key-id>
```

(The user has one existing key, so create-then-deactivate fits IAM's two-key limit.)
Optional hygiene, out of incident scope: `Federico`'s key and the `BedrockAPIKey-7mqw`
service credential, both created 2026-08-01, after the window.

**PROD `747814092517` — still to walk.** Same commands with production credentials:
`aws iam list-users`, then per user `aws iam list-access-keys`. Rotate anything with
`CreateDate` ≤ 2026-07-29 using the pattern above. Expected result: **no long-lived keys**
(App Runner runs on an instance role) — if so, mark the inventory row N/A **with the walk as
the evidence**, not the expectation.

Also on this machine: profiles `[default]`, `[claude]`, `[formmaps-deploy]`, `[mep]` in
`~/.aws/credentials`. If their keys predate 2026-07-29 they were readable by the payload's
detached child and are in scope regardless of which project they belong to — check their
CreateDates in their own accounts.

## E4. Brevo SMTP — legacy

1. `app.brevo.com` → **SMTP & API**. SMTP tab: generate a new SMTP key, **delete the old
   one(s)**. API keys tab: delete any key created on or before 2026-07-29, recreate if
   something still sends.
2. If the legacy app still sends mail, update its env (E1) and redeploy; if not, deletion
   alone is the rotation.

**New stack: nothing to do** — production runs `Email:Provider=none` and wires no `Email__*`
secret (inventory row E, verified against the App Runner template).

---

## A. `TrackingJwtSecret` — last, deliberately

*Logs every user out of **both** products the moment both services restart. Do it in the
scheduled window from "The one decision", not opportunistically at the end of the sitting.*

**Decision check:** if the decision was the two-key overlap — stop; ship that code change
first. This section is the hard-logout path.

Names: Secrets Manager `climate-project-api/prod/tracking-jwt-secret` → climate API env
`TrackingJwtSecret`. The **same value, byte-identical**, must reach climate-tracking's API
and Workers (`TrackingJwtSecret` in their config) — but first apply C step 0's finding: if
the tracking services are not deployed in production, this is a single-service rotation and
the coordination constraint is moot.

1. Confirm the window is now; whoever supports users knows a mass logout is coming. Note
   that every token issued before the rotation dies **immediately** — the 24h lifetime stops
   mattering.
2. Generate: `openssl rand -base64 64` (HMAC-SHA256 key; ≥32 bytes required, 64 is right).
3. SECRET-UPDATE `climate-project-api/prod/tracking-jwt-secret`.
4. Set the same value on the tracking side's config/secret store (if deployed).
5. **Before redeploying**, log in once and keep the bearer token in a terminal — it is the
   negative probe in step 7. (It is about to become worthless; it still never goes in a
   file.)
6. REDEPLOY the climate API; redeploy tracking API + Workers as close together as possible.
   Between the two restarts, cross-service tokens fail with 401s — the known, bounded cost.
7. **Verify — all four:**
   - PROBE-READY, 20/20;
   - PROBE-LOGIN — a *fresh* login works and an authed page renders;
   - the **saved old token** against any authed endpoint → **401**. This is the probe that
     proves the rotation actually happened — a green login alone cannot distinguish "rotated"
     from "nothing changed";
   - if tracking is live: one cross-service flow works end-to-end.
8. Failure modes, both loud: a blank/mangled secret refuses to boot
   (`ValidateOnStart`) and the deploy fails — fix the secret and redeploy, don't roll back;
   one side redeployed and the other not shows as cross-service 401s until step 6 completes.

**Emergency rollback (the one exception to roll-forward):** restore `AWSPREVIOUS` on the
same secret (`aws secretsmanager put-secret-value` with the previous string via
`get-secret-value --version-stage AWSPREVIOUS`), mirror it on the tracking side, redeploy
both. This restores the old sessions too. Use it only if the new value itself is broken,
then schedule the rotation again with a fresh value — the old key was to be retired for a
reason.

---

## Closeout

1. **Revocation audit** — for each item, the old value must be dead, not just unused:
   DB password (superseded at the dashboard reset), legacy Supabase keys (disabled), Atlas
   (cluster terminated / user password changed), `InternalApiKey` + `TrackingJwtSecret`
   (superseded — once both services restart, the old values authenticate nothing), Google
   old client secret (**deleted**, step D1.3), `NEXTAUTH_SECRET` (replaced or variable
   deleted), Vercel tokens (**deleted**), AWS old keys (Inactive, then **deleted**), Brevo
   old keys (**deleted**).
2. Tick the inventory checkboxes with date and who; note each probe's result next to it.
3. Next day: `deploy-drift.yml` is green and PROBE-READY passes once more.
4. Close #70. The residual items that survive this runbook — the legacy Vercel account hunt
   (E1) and the production IAM walk (E3) — either got done above or become their own issues;
   #70 does not close with them silently open.
