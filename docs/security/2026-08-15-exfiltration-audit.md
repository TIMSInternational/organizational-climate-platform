# Exfiltration audit — build logs and outbound traffic (#71)

**Audit performed:** 2026-08-15 / 2026-08-16 (UTC), days 17–18 after the payload was removed
from the legacy repository in `81363af`.
**Written into the repository:** 2026-09-01, from the evidence set described under
[Evidence](#evidence--where-it-lives-and-why-it-is-not-here).
**Subject:** the obfuscated loader found in the legacy app's `tailwind.config.js` —
see [2026-07-30-tailwind-payload-analysis.md](./2026-07-30-tailwind-payload-analysis.md) and
[2026-08-03-recovered-onchain-stages.md](./2026-08-03-recovered-onchain-stages.md).

---

## Verdict

**Negative, within the systems this account can reach.** Every reachable build log for the
exposure window was pulled and searched against the recovered indicator set, and **0 of 822
deployments produced a hit**. No evidence of exfiltration was found.

Two of the systems that could still hold positive evidence were **not** reachable and are
recorded as [OPEN](#open--what-a-human-must-still-do), not as clean.

> **A clean log is *no telemetry*, not *no detonation*.** That rule is stated in
> `2026-08-03-recovered-onchain-stages.md` and it governs this document too. What follows is
> what was searched and what came back, not a claim that nothing happened.

---

## The issue title is wrong, and this is the headline finding

Issue #71 is titled *"audit Vercel build logs and outbound traffic for exfiltration"*, and its
body instructs: *"Pull Vercel build logs for every deployment in that window."*

**The legacy Next.js app (`TIMSInternational/climate-project`) was never deployed on any Vercel
scope reachable from this machine.** There is no legacy Vercel project — not present today, and
no trace in the activity feed of one ever having been created or deleted in this team. There are
therefore **no legacy Vercel build logs to pull**. This is a different outcome from the
anticipated "the project was deleted, so the logs are gone": the logs are not gone, they never
existed here.

The legacy app's own deployment tooling says so as well. In the HEAD snapshot of that repository:

| Measurement | Result |
|---|---|
| `deploy.sh` line 3 | `# Deployment script for Coolify` |
| Files mentioning "coolify" (case-insensitive, 1,041 files scanned) | 2 — `deploy.sh`, `DOCKER_DEPLOYMENT.md` |
| `Dockerfile`, `docker-compose.yml` | both present |
| `vercel.json` | present, and contains **only** a `crons` array (one entry, `/api/cron/send-reminders`) — no project binding |
| `.vercel/project.json` | absent (GitHub API returned 404) |

If the loader detonated in a *hosted* build during the believed May→July 2026 window, it
detonated on **the original vendor's infrastructure** — a Coolify host per that repo's own
script — not in this Vercel team. That relocates the remaining search, and it is the reason
item 1 of [OPEN](#open--what-a-human-must-still-do) exists.

This also corrects `docs/security/rotation-inventory.md`, which attributes
"Legacy Vercel env (`MONGODB_URI`)" and "`NEXTAUTH_SECRET` | Legacy Vercel env" to a Vercel
project — see [Corrections owed to other documents](#corrections-owed-to-other-documents).
**It does not clear a single credential.** The build-time environment was still readable
in-process, on vendor infrastructure and on developer machines. #70 stands unchanged.

---

## Window

| Window | Span | How it was established |
|---|---|---|
| **Repo-side, in TIMS/Federico hands** | 2026-07-29T02:26:47Z → 2026-07-30T03:17:33Z (~25.5 h) | Author dates of `40fc19a` (payload introduced with the squashed vendor baseline) and `81363af` (payload removed) |
| **Believed full exposure window** | May 2026 → 2026-07-29 | Vendor-side only. Asserted by the incident docs; **no artifact for it exists in any system reachable from here** |
| **Swept anyway (defence in depth)** | 2026-05-01T00:00:00Z → 2026-08-01T00:00:00Z | Every deployment this team made in three months, whatever the project |

Two dates in the earlier incident write-ups are corrected by the commit metadata:

- **`40fc19a` is 2026-07-29T02:26:47Z**, not May 2026. It is the single squashed baseline commit
  ("Add existing Procomer climate platform application (baseline)"). The repository was created
  on GitHub 2026-07-29T15:14:45Z and its observed history begins 2026-07-29T01:42:07Z. The
  vendor's real May→July history was collapsed into that one commit and does not exist as
  separate commits anywhere we can see. **"May 2026" can only ever refer to the vendor-side
  timeline.**
- **`81363af` is 2026-07-30T03:17:33Z.** The docs' "2026-07-29" is that timestamp in local time.
- **`40fc19a` is reachable from `main`** (it appears in the 133-commit default-branch listing).
  `rotation-inventory.md` describes it as "unreachable from any branch tip"; that is inaccurate.
  Good for evidence preservation, and still a detonation hazard on any checkout-and-build of that
  history.

---

## Method

Read-only HTTP GETs, via the Vercel CLI (50.22.1) authenticated to the single team this account
belongs to, and the `gh` CLI for the GitHub side. No write, no delete, no attacker infrastructure
contacted. The exact scripts are in the evidence set and are listed in the
[manifest](#evidence--where-it-lives-and-why-it-is-not-here).

**1 — Scope coverage.** `vercel teams ls` returns exactly one team; `vercel whoami` one user;
`GET /v2/teams/{id}/members` returns **1 member (OWNER)**, so the activity feed below covers every
actor in the scope. Personal scope is refused by the platform ("You cannot set your Personal
Account as the scope"), and no personal-scope projects exist.

**2 — Project enumeration.** `vercel projects ls` + `GET /v10/projects` → **16 projects**. None is
the legacy app. Searching the full project payload for a link to `climate-project` returns **0
projects**. The project named `climate` (`prj_p6k2Hui…`) is the **new** Vite app, linked to
`TIMSInternational/organizational-climate-platform`, created **2026-07-31T17:50:55Z — two days
after the payload was removed.**

**3 — Full deployment inventory.** `GET /v6/deployments`, paginated to exhaustion (`next=None`) →
**882 deployments, 2025-10-29T18:22:23Z → 2026-07-31T23:56:13Z**. Zero deployments of any project
named as, or linked to, the legacy app — ever. Deleting a project also deletes its deployments
from this listing, which is why step 4 matters.

**4 — Activity feed as audit-log substitute.** Vercel's Audit Log is an Enterprise feature and
this team is on the **hobby** plan (`GET /v2/teams/{id}` → `billing.plan: hobby`). Every audit
endpoint probed returned 404; `GET /v3/events` returned 200 and was used instead:

| Endpoint probed | Response |
|---|---|
| `GET /v1/audit-events?teamId=…&limit=50` | `404` — "The requested API endpoint was not found" |
| `GET /v1/teams/{id}/audit-events` | `404` — "Not Found" |
| `GET /v2/audit-events?limit=50` | `404` — "The requested API endpoint was not found" |
| `GET /v1/audit?teamId=…` | `404` — "The requested API endpoint was not found" |
| `GET /v3/events?limit=100` | **`200`** — used as the audit substitute |

Paginated over 87 pages → **8,700 events, 2026-03-17T05:17:41Z → 2026-08-16T00:50:01Z**, fully
covering the believed exposure window. Re-measured while writing this document: **792 events
mention "climate" anywhere in their JSON; 0 of them occur before 2026-07-31.** The earliest is
2026-07-31T16:29:11Z. Every project create/delete/rename in the feed is accounted for by name and
none is climate-related.

**5 — GitHub side of the legacy repository.** A Vercel-linked repository leaves marks; none are
present. `.vercel/project.json` → 404. Repo webhooks (`GET /repos/…/hooks`) → **`[]`**. Commit
statuses and check-runs on the baseline commit, a mid-history commit and HEAD → **0 and 0**.
`vercel[bot]` PR comments → **0**.

**6 — IOC sweep of what this team *does* hold.** Even though no legacy build exists here, all
reachable build logs were pulled and searched anyway, to rule out cross-contamination by a
developer machine that built the legacy repo and then deployed something else.

- **Corpus:** `GET /v3/deployments/{uid}/events?builds=1&limit=-1` for **every team deployment in
  2026-05-01 → 2026-08-01: 822 deployments** across 12 projects. Re-measured from the result
  table: first 2026-05-05T14:08:48Z, last 2026-07-31T23:56:13Z. On disk: **822 JSON files, ~44 MB**.
- **Indicator set:** **27 literal strings**, taken from
  [`2026-08-03-recovered-onchain-stages.md`](./2026-08-03-recovered-onchain-stages.md), which
  remains the canonical list. By class: 4 attacker-controlled IPv4 addresses (one of them probed
  on **MongoDB's default port**), 1 C2 URL path, 1 custom request-header name, 4 blockchain RPC
  hostnames, 3 TRON dead-drop addresses, 1 BSC funding address, 3 XOR keys, 8 obfuscation
  markers, and 1 field delimiter. The literals are deliberately not repeated here — one list, one
  place to correct.
- **Result: 0 IOC hits across all 822 deployments. 0 fetch errors.** Per-deployment verdicts are
  recorded in `ioc-grep-results.tsv` (822 data rows; grouping the verdict column gives
  `822 × "no IOC hits"` and nothing else).
- **Corpus sanity check** — a sweep that found nothing has to be shown capable of finding
  something. 27 of the 822 deployments returned an **empty** event list; all 27 are accounted for
  against the deployment inventory: 23 `CANCELED`, 3 `BLOCKED` (no build ever ran), and 1 `READY`
  git deploy with an empty `builds` array (unrelated personal project). That is not a retention
  gap. Of the 822 saved log files, **784 contain recognisable build output** (`npm` / `vite` /
  `next` markers), so the grep ran over real content rather than empty responses.

**7 — Legacy repository HEAD.** A fresh shallow clone (**1,041 files**), searched byte-wise so
binaries are covered, against 25 of the 27 indicators (the two excluded are the bare `:27017`
port marker and the `?.?` delimiter, both too generic for a source tree): **0 hits.**
`tailwind.config.js` at HEAD is an ordinary 317-line config. **The clone holds HEAD only — it
does not contain `40fc19a`, and therefore does not preserve the sample.**

---

## Coverage gaps, stated plainly

- **Vendor-side hosting, May → 2026-07-29.** Unreachable from any credential on this machine. If
  the loader detonated in a hosted build during the real window, it was there. → OPEN 1.
- **MongoDB Atlas access and network logs.** Never attempted; no Atlas credential on this
  machine. → OPEN 2.
- **Developer-machine detonations.** Chain B of the loader outlives the build as a detached
  process. Nothing on the hosting side can speak to that; host triage of the machines that built
  the legacy repo on 2026-07-29/30 (and of vendor machines before the handoff) is separate work
  and is not covered by this audit.
- **Activity-feed floor.** Pagination stopped at 2026-03-17T05:17:41Z (the feed jumped from
  2026-04-01 to 2026-03-17 and then ended). Earlier events were not retrieved. The believed
  window sits entirely inside the retrieved range.
- **Deleted-project blind spot.** A Vercel project created *and* deleted before
  2026-03-17T05:17:41Z would leave no row in either the deployment inventory or the event feed.
  For the window that matters (May–July 2026) that case is excluded by steps 3 and 4, and the
  GitHub-side absence in step 5 is time-independent.
- **Runtime logs.** Hours-scale retention on this plan; long gone for the window and never in
  scope. Build-log retention, by contrast, had destroyed nothing reachable as of 2026-08-16 —
  May 2026 build logs were still served in full.

---

## OPEN — what a human must still do

Neither of these is closed, and neither can be closed from this machine. Both need a console this
account has no credential for.

**OPEN 1 — Vendor / previous operator: hosted build and host logs for May → 2026-07-29.**
Ask whoever operated the legacy app before the 2026-07-29 handoff where production ran (their own
`deploy.sh` says **Coolify**), then pull, against the indicator set in
`2026-08-03-recovered-onchain-stages.md`: build logs for the window, host egress/firewall logs,
and any CI logs. This is now **the only place hosted-build telemetry for the real window can
exist**. Ask for the *raw* logs or a scoped search result — a verbal "we saw nothing" closes
nothing.

**OPEN 2 — MongoDB Atlas console: access history and cluster logs for the window.**
Needs Atlas credentials nobody on this machine has. Pull: organisation access history, cluster
access logs, and IP allowlist change history for May → 2026-08-01 — specifically any connection
or allowlist entry involving the four attacker IPs, and above all the one seen paired with
**port 27017**, which is what makes a database-side hit plausible rather than theoretical.

**Both are prerequisites to declaring #71 done.** The verdict above is scoped to reachable
systems and does not survive being restated without that scope.

---

## Acceptance criteria (issue #71)

| Criterion | State | Where |
|---|---|---|
| Time window established and documented | **Met** | [Window](#window), incl. two date corrections |
| Build logs for the window reviewed | **Met for reachable systems; vendor side OPEN 1** | [Method](#method) step 6 — 822/822, 0 hits |
| Atlas and Vercel access logs reviewed | **Vercel: met by substitute** (audit log is Enterprise-only; 8,700-event activity feed used, all actors covered). **Atlas: OPEN 2** | [Method](#method) step 4 |
| Findings written to `docs/` with a clear verdict | **Met by this document** | [Verdict](#verdict) |
| If exfiltration is confirmed, escalate rather than decide here | **Not triggered** — result is negative | — |

---

## Corrections owed to other documents

Recorded, not applied — these files are edited by other work in flight. Each is a factual error
this audit disproves:

1. **`docs/security/rotation-inventory.md`** — rows attributing exposure to "Legacy Vercel env"
   should read *vendor hosting environment (Coolify, per the legacy repo's `deploy.sh`) —
   enumerate with the vendor*. Row E's "Vercel dashboard → project `climate`" should note that
   `climate` is the **new** app's project, created 2026-07-31T17:50:55Z, after the removal
   commit; its environment never overlapped the malware window. Separately, its description of
   `40fc19a` as "unreachable from any branch tip" is wrong — the commit is in `main`'s history.
2. **`docs/runbooks/legacy-dependencies.md`** — the row describing "the legacy Vercel deployment
   itself … Vercel project `climate`" rests on the same disproven premise: that project is the
   new app and post-dates the incident.
3. **#70 rotation is unaffected.** This audit narrows *where* the build-time environment was
   exposed. It does not clear any credential.

---

## Evidence — where it lives, and why it is not here

The raw evidence set is **~29 MB across 24 entries** and is deliberately **not committed**. This
repository is public; the set contains full build-log payloads for twelve unrelated projects and
a working-tree snapshot of the legacy application. It lives outside the repository at:

```
<workstation>/clients/tims-international/scratchpad-salvage-2026-08-17/evidence-71/
```

| Entry | What it is |
|---|---|
| `REPORT.md` | The 2026-08-16 pull report this document is derived from |
| `projects-team.json` | All 16 team projects, `GET /v10/projects` |
| `deployments-all-window.json` | Full inventory — 882 deployments, 2025-10-29 → 2026-07-31 |
| `deployments-team-latest.json`, `deployments-window-may-jul.json` | Initial probe pages |
| `team-activity-events.json` | 8,700 activity events, 2026-03-17 → 2026-08-16 |
| `build-logs/` | 822 per-deployment build-log JSON files, ~44 MB |
| `ioc-grep-results.tsv` | Per-deployment IOC verdicts, 822 data rows |
| `legacy-repo/`, `legacy-repo-commits.txt` | HEAD working-tree snapshot (1,041 files, git metadata stripped) and the 133-commit `main` listing |
| `paginate_deployments.py`, `paginate_events.py`, `fetch_build_logs.py`, `grep_legacy_repo.py`, `gen_report.py` | The exact scripts used — read-only GETs only |
| `full-window-sweep.txt`, `fetch-logs-progress*.log`, `events-*.log`, `pagination.log`, `events-summary.txt` | Run logs and summaries |

Two notes for anyone re-reading that directory:

- `full-window-sweep.txt` prints the line
  `deployments in 2026-07-28..2026-08-01: 822`. **That label is stale**, left over from an earlier
  revision of the script. `fetch_build_logs.py` filters on `LO = 1777593600000`
  (2026-05-01T00:00:00Z) — the three-month sweep, which is also what the result table's own date
  range shows (2026-05-05 → 2026-07-31). The count, 822, is correct.
- **The sample's survival is not guaranteed.** `40fc19a` is still fetchable from GitHub because it
  is in `main`'s history, but the local clone in the evidence set holds HEAD only. If that
  repository is force-pushed, history-rewritten or deleted, the loader sample dies with it.
  Preserving it is not covered by this issue and has no owner.

Every count in this document was re-measured from that evidence set on 2026-09-01, not copied
from the 2026-08-16 report.
