# Secret rotation inventory — #70

**Status: NOT STARTED. No credential below has been rotated.**

This is the scaffold for #70, not a record of completed work. It exists so that the
rotation is a checklist someone can execute in one sitting rather than a scoping exercise
each time it comes up. Every item is grounded in what the code actually reads or what the
legacy stack actually used — sources are cited per row.

**Never record a secret value in this file.** Record what was rotated, when, by whom, and
that the new value was verified working.

## Why this is needed

An obfuscated payload sat in `tailwind.config.js` in the legacy `climate-project` repo from
the baseline import (`40fc19a`) until removal (`81363af`, 2026-07-29). `tailwind.config.js`
is `require()`d on every build, so it executed on **every local build and every production
deploy** in that window. Full analysis:
[`2026-07-30-tailwind-payload-analysis.md`](./2026-07-30-tailwind-payload-analysis.md).

The governing finding is that **the stage which actually executed was never in the
repository** — the loader fetched it from a blockchain dead drop at run time. No further
analysis of the sample can establish what was taken. That is why the scope below is
"everything the legacy build and runtime could read," not a narrowed subset.

One chain ran *inside* the Vercel build, where project environment variables are directly
readable. Another spawned a detached `node -e` child that *outlived* the build.

## Scope decision

Treat as compromised: any secret readable from the legacy Vercel build/runtime environment,
or from a developer machine that ran a legacy build, at any point between 2026-05-XX
(baseline import) and 2026-07-29 (removal). Confirm the exact baseline date from
`git log -1 40fc19a` in the legacy repo before finalising the window.

## Inventory

Ordered so that the disruptive, coordination-heavy item is planned rather than stumbled
into. Rotate top-down.

### A. Shared JWT signing key — **do this deliberately, it logs everyone out**

| Field | Value |
|---|---|
| Item | `TrackingJwtSecret` |
| Where it lives now | AWS Secrets Manager → App Runner `RuntimeEnvironmentSecrets` (`infra/aws/climate-project-api-prod-service.yml`, param `TrackingJwtSecretArn`) |
| Also configured in | `services/tracking-api/src/ClimateTracking.Api/appsettings.json`, local `dotnet user-secrets` |
| Rotated? | ☐ |

**This is one value doing three jobs, which #70's description splits into two rows.** It is
not "the tracking secret plus the new stack's own signing key" — they are the same string:

- `src/ClimateProject.Infrastructure/Auth/JwtTokenService.cs:17` reads `TrackingJwtSecret`
  and uses it as the HMAC-SHA256 **signing** key for tokens this API issues.
- `src/ClimateProject.Api/Program.cs:61` uses the same value as `IssuerSigningKey` for
  **validation**, with a comment that it must match climate-tracking's `Program.cs` exactly
  for token compatibility.
- climate-tracking's API and Workers read the same value.

Consequences to plan for:

- Rotation invalidates every live session in **both** products simultaneously.
- `JwtTokenService.cs:12` sets `TokenLifetime = TimeSpan.FromHours(24)`, so a validation-only
  grace window of 24h would be needed to avoid a hard cutover. The current single-key
  `TokenValidationParameters` cannot accept two keys at once — an overlap window requires a
  code change (`IssuerSigningKeys` with both the old and new key, old one removed after 24h).
  **Decide before starting** whether to accept a hard logout or to do the two-key change
  first; a hard logout is simpler and probably fine, but it should be a choice.
- Both services must be redeployed against the new value. Deploying one and not the other
  breaks cross-service auth silently — tokens issued by one are rejected by the other.
- `Program.cs` calls `.ValidateOnStart()`, so a missing or empty value fails fast at
  startup rather than 500-ing per request. A blank rotation is loud, not silent. Good.

### B. Database

| Item | Where | Notes | Rotated? |
|---|---|---|---|
| Supabase Postgres password | Secrets Manager (`DatabaseConnectionStringSecretArn`) → env `ConnectionStrings__ClimateProject` | Supabase project `organizational-climate-platform`, `us-east-1` (README). **Two places hold this password, and rotating one is the classic miss.** Runtime currently uses the **transaction pooler, port 6543** (Secrets Manager) — **this is a defect, not the design; see the warning below.** EF migrations use the **session pooler** — *same host*, port **5432**, username `postgres.<project-ref>` — held separately as the `MIGRATION_DATABASE_CONNECTION_STRING` **secret on the `production` GitHub environment**, not in Secrets Manager. Same password, two strings, two systems: update and verify **both** or migrations break later, in a different session, looking unrelated. **Both strings should be on port 5432**; whoever rotates this password is the most likely person to fix the runtime port at the same time, since they are rewriting the value anyway. Do **not** rotate the migration string onto `db.<project-ref>.supabase.co` (the dashboard's "direct connection") — that host is **IPv6-only and unreachable from GitHub Actions**; `deploy-prod.yml` now rejects it outright (#212). | ☐ |
| Supabase `service_role` key | Supabase dashboard | **Verify whether it is used at all.** No reference found anywhere in this repo — the .NET stack connects over Postgres, not the Supabase REST API. If genuinely unused, mark N/A with that reason rather than rotating it. | ☐ |
| Supabase `anon` key | Supabase dashboard | Same — no reference in this repo. Likely legacy-only or unused. | ☐ |
| MongoDB Atlas credentials / connection string | Legacy Vercel env (`MONGODB_URI`) | **Legacy-only.** The new stack is Postgres; no Mongo driver or connection string exists in this repo. Still must be rotated — the legacy build could read it — but it does not touch the new stack. Consider whether the Atlas cluster should simply be decommissioned instead, which is strictly better than rotating a credential for a database nothing should use again. | ☐ |

> **The runtime port is wrong today (#220).** Earlier revisions of this file recorded
> "transaction pooler, port 6543" for the runtime path as if it were the intended
> configuration. It is not — it is the bug. Supavisor's **transaction** mode hands a different
> backend to each statement, which a client-side pool like Npgsql's cannot work with: Npgsql
> holds connections open across statements and expects session state to survive between them.
> Measured on the live service: ten consecutive probes of `/ready` (which round-trips Postgres)
> alternated perfectly — 200, timeout, 200, timeout — five of ten hanging, while `/health`
> returned 200 every time because it is a static literal that opens no connection.
>
> The runtime string wants the **session pooler on port 5432**, exactly like the migration
> string: same host, same password, same `postgres.<project-ref>` username, only the port
> differs. Do **not** "fix" it by moving to `db.<project-ref>.supabase.co` — that host is
> IPv6-only, as the migration-string note above explains.
>
> The value lives in AWS Secrets Manager as
> `climate-project-api/prod/database-connection-string` and can only be changed by someone
> with write access to that secret. It is **not** fixed by anything in this repository. What
> the repository does do, as of #220: `DatabaseConnectionStringPolicy` bounds the Npgsql pool
> and logs a startup **warning** naming this issue whenever it sees port 6543. That guard is
> deliberately a warning and not a hard startup failure, because the live secret still says
> 6543 and a hard failure would stop production booting on the next deploy.
>
> Whoever rotates this password is the most likely person to also fix the port, since they are
> rewriting the value anyway. **If you do, finish the job**: set
> `Database__RequireSessionPooler` to `"true"` in
> `infra/aws/climate-project-api-prod-service.yml` once a deploy on port 5432 has come up
> green. That flag turns the warning into a startup failure, and it is the only thing in the
> system that would catch the port regressing later — nothing in `deploy-prod.yml` inspects
> this secret. The ordered sequence, and why the order matters, is in `infra/aws/README.md`
> under "Arming the guard".

### C. Internal service auth

| Item | Where | Notes | Rotated? |
|---|---|---|---|
| `InternalApiKey` | Secrets Manager (`InternalApiKeySecretArn`) → env `InternalApiKey` | Static bearer token guarding `/api/internal/*`; the only caller is climate-tracking's backend, which passes it as `ClimateProjectInternalApiKey`. **Rotate on both sides together.** Two distinct failure modes, worth keeping apart when planning the rotation: an **unset/empty** value now fails the host at *startup* (`.ValidateOnStart()`, added by #189), so a blank rotation means the service does not boot and the deploy fails outright — loud, not silent. A **mismatched** value (set on one side, stale on the other) is not a 500: `InternalApiKeyFilter` returns **401 `"Invalid or missing internal API key."`** per request, failing closed. The filter's 500 `"Internal API is not configured."` branch is now unreachable in a running service and is retained only as defence in depth. | ☐ |

### D. Identity / OAuth

| Item | Where | Notes | Rotated? |
|---|---|---|---|
| Google OAuth **client secret** | Google Cloud console | **Legacy-only for this stack.** `src/ClimateProject.Infrastructure/Auth/GoogleTokenVerifier.cs:13` reads only `GoogleClientId` — it verifies Google-issued ID tokens, which needs the public client ID and no secret. The legacy NextAuth app did use a client secret. Rotate it there; the new stack is unaffected. | ☐ |
| Google OAuth client ID | `GoogleClientId` config | Public by design, not a secret. **N/A — no rotation needed.** Listed only so it is not mistaken for an omission. | ☐ N/A |
| `NEXTAUTH_SECRET` | Legacy Vercel env | Legacy-only; NextAuth does not exist in the new stack. See the finding in "History scan" below before assuming this one is unremarkable. | ☐ |

### E. Platform tokens

| Item | Where | Notes | Rotated? |
|---|---|---|---|
| Vercel project environment variables | Vercel dashboard → project `climate` | Everything in the legacy project's env was readable **in-process during the build** — this is the highest-confidence exposure of the whole incident, not a hypothetical. Enumerate and rotate all of it. | ☐ |
| Vercel account/team API tokens | Vercel account settings | Rotate any token that existed during the window. | ☐ |
| AWS access keys (long-lived) | IAM | Only keys that are **not** instance-role based. App Runner uses an instance role, so there may be none — confirm and mark N/A. Note the local dev credentials in use are for account `795965600143`, while production is `747814092517` (`AWS_ACCOUNT_ID` repo variable); check both. | ☐ |
| GitHub Actions OIDC deploy role | `climate-project-github-deploy-prod` | Not a secret (no static credential — that is the point of OIDC). **N/A for rotation**, but see #68: its trust policy may still reference the pre-rename repo, which is a separate correctness bug. | ☐ N/A |
| SMTP / email credentials | Brevo (per legacy `ENV_VARIABLES.md`) | Legacy-only unless the new stack has since added mail. No SMTP config key found in this repo — confirm before marking N/A. | ☐ |

## History scan — completed 2026-08-03

This half of #70's groundwork is **done**. Result: **no credential has ever been committed
to any of the three repositories.**

Method — two independent passes, because a single clean report is not evidence:

1. **Manual.** Pattern scan (AWS `AKIA`/`ASIA`, `GOCSPX-`, `mongodb+srv://` and
   `postgres://` with inline credentials, PEM private-key markers, JWT-shaped `eyJhbGciOi`
   blobs, `sk-`, `xox[baprs]-`, SendGrid `SG.`, `service_role`) across **every blob**, not
   just reachable commits — `git cat-file --batch-all-objects` covers unreachable and
   dangling objects too. 1,197 blobs in `organizational-climate-platform`, 1,362 in
   `climate-project`, 130 in `climate-tracking`.
2. **Independent tool.** `gitleaks` 8.30.1, both `gitleaks dir .` and `gitleaks git .`
   (full history) — no leaks found, agreeing with the manual pass.

Findings, all benign, none requiring rotation on their own account:

- **`organizational-climate-platform`** — clean. Tracked config holds empty strings for
  every real secret (`appsettings.json`: `TrackingJwtSecret`, `InternalApiKey`,
  `GoogleClientId`, connection string all `""`). The only credentials present are localhost
  dev placeholders (`Password=postgres`, `Password=changeme`). No `.env` file has ever been
  committed — only `web/.env.example`, which holds two `localhost` URLs.
- **`climate-tracking`** — clean, nothing matched.
- **`climate-project`** (legacy) — no real credentials. All matches are documentation
  placeholders of the form `mongodb+srv://username:password@cluster.mongodb.net/...`, plus
  `ENV_VARIABLES.md` and `Dockerfile`'s `NEXTAUTH_SECRET=dummy-secret-for-build`.

One item worth a positive check rather than an assumption:

> `climate-project`'s `ENV_VARIABLES.md:128` publishes a `NEXTAUTH_SECRET=` line with a
> real-looking 47-character mixed-case alphanumeric value (beginning `8xK9`; not reproduced
> here in full, per this file's own rule). It is labelled `**Example:**` and followed by
> "⚠️ CRITICAL: Change this for production!", so it reads as documentation and almost
> certainly never was the live secret. But it is present in **194 commits and still on
> HEAD**, so if anyone ever copy-pasted it, the production NextAuth secret is publicly
> readable. **Confirm the live legacy `NEXTAUTH_SECRET` is not this value.** If it is,
> that promotes row D/`NEXTAUTH_SECRET` from precautionary to urgent.

### Ongoing prevention (added with this document)

- `.gitleaks.toml` — gitleaks config extending the default ruleset, with a deliberately
  narrow, individually justified allowlist.
- `.githooks/pre-commit` — scans staged changes. Opt-in per clone:
  `git config core.hooksPath .githooks`. A convenience, not the gate — it can be skipped
  with `--no-verify` and is off in a fresh clone.
- `scripts/verify-secret-scanning.sh` — the actual gate, run by the `secret-scan` CI job.
  Asserts **both** that a planted private key is still detected and that the repo is clean.
  The detection half is what gives the clean half meaning: a misconfigured scanner and a
  clean repository produce identical output. This caught two real problems while being
  written — an obviously-fake AWS key that gitleaks silently ignores (upstream allowlist and
  an entropy threshold), and the script's own fixture strings tripping the scanner.

## Still blocked on console access

Everything in the inventory above needs credentials I do not have: Atlas, Vercel, Supabase,
AWS (production account `747814092517`), and Google Cloud. The scaffolding, the history
scan, and the prevention tooling are done; **the rotation itself is unstarted and needs a
human with those consoles.**

Suggested order once someone has them:

1. **Enumerate first, rotate second.** Walk the legacy Vercel project's environment
   variables and write down every key present — the inventory above is derived from code and
   docs, so anything configured only in the dashboard is not yet on it.
2. Rotate B–E (independent, non-disruptive, no coordination needed).
3. Decide the `TrackingJwtSecret` question (hard logout vs. the two-key overlap change),
   then schedule and execute A across both services together.
4. **Revoke old values, do not merely replace them** — an unrevoked old credential is still
   a live credential.
5. Fill in this file's checkboxes with dates, and close #70.

## Related

- #71 — traffic audit. The highest-value lead is reading the two BSC transaction `input`
  fields on a public explorer, which recovers the payload that actually ran; recipe is in
  the analysis doc. Do it before the attacker rotates them. Treat a clean Vercel log as
  *no telemetry*, not *no detonation*.
- #72 — payload analysis. Done.
- **`climate-project` history still holds a live sample** at `40fc19a`. It is unreachable
  from any branch tip, but `git checkout 40fc19a` restores a file that detonates on the next
  build. Handle before archiving that repository.
