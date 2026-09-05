# Gap closures and corrections — 2026-09-05

**Commit measured:** `6f8e1296` (`main`), all ten CI jobs green. Production API at `e0896f9`,
**75 commits behind**. Go-live 16 November 2026.

**What this is.** A short, additive successor to `2026-09-03-functional-gaps.md`, which it does
**not** edit — this folder supersedes by date, because the value of a stale audit is that it
dates the drift. Two kinds of row are recorded here: gaps that closed between 3 and 5 September,
and **three errors in how the 09-03 audit was being read** that produced a materially wrong
picture of what was left to do.

---

## 1. The reading errors — these mattered more than the closures

### 1.1 §8 is an ordered queue; §5 is the classification. They are not the same set.

§8 is titled *"Ordered list — CODE/DOCS an agent can build with no human input"*. It was
exhausted, and that was reported as **"there is no buildable work left; all remaining items are
human-only."** That is false.

§5 classifies every open issue: **7 `BUILDABLE-NOW`**, 4 `NEEDS-RULING`, 14 `BLOCKED-ON-HUMAN`.
Only three of the seven buildable ones are closed (#141, #423, #167's code half). **Four are
open and were never carried into §8:**

| # | Class in §5 | Measured 2026-09-05 |
|---|---|---|
| 134 | BUILDABLE-NOW, 0/4 | `DashboardEndpoints.cs:97-101` maps five `GET` routes and no `/export`; `PdfDocument`, `CsvStreamWriter` and `ReportShareTokens` all exist, are tested, and are consumed by `SurveyExportEndpoints`. Pure composition. |
| 210 | BUILDABLE-NOW, 2/6 | Carries a `blocked` label; the label is a hypothesis. Only the **three** `Category` fields wait on #58 — the issue says so itself. The other **24** are the same paired `_en`/`_es` mechanism Tier 1 already shipped. |
| 140 | BUILDABLE-NOW, 1/4 | First criterion is "legacy behaviour established, keep/drop decision recorded", and there is no legacy behaviour to establish (`no-data-migration.md`). The buildable deliverable is a decision record, the shape that closed #141. |
| 133 | BUILDABLE-NOW, 1/4 | Same shape, weaker: its own scope says "recommend dropping if unused", and usage cannot be established because the legacy data does not exist. |

**A queue emptying is not a category emptying.** Answer "is there any buildable work left?" from
the classification, never from the plan.

### 1.2 The "37 tracked gaps" figure double-counts #141

The composite in use was *§8's 14 + §9's 21 + #423 + #141 = 37*. But **§8 item 5 *is* #141** —
its text is "The maintenance page and logs viewer (#141)". #423 is a genuine addition, appearing
only in §5. **The unique denominator is 36.**

### 1.3 #141 is closed on GitHub over a decision nobody signed

`gh issue view 141` → `CLOSED/COMPLETED`, and cutover P9 is marked met. But
`docs/decisions/operational-pages.md` still ends:

```
Logs viewer:  ____  (drop | build, with the #141 constraints)
Decided by: ____
Date: ____
```

Its own heading reads "RECOMMENDED DROP, awaiting Federico's sign-off". The maintenance page
half is genuinely shipped (#430) and cutover C8 has a page to point at; the logs-viewer half is
a recommendation, not a decision. **§8.5 is open.**

---

## 2. Gaps that closed by measurement, not by code

### 2.1 Cutover gate A1's exit criterion is MET

The 09-03 audit recorded A1 as *"CLOSED, **exit criterion unmet** — eight heartbeat lines never
observed in production logs"*, and cutover C4 carried
`[CANNOT VERIFY FROM HERE: production CloudWatch Logs access.]`.

Access was granted on 2026-09-05 (logs only — see `docs/security/agent-aws-permissions.md`) and
used narrowly: a filter for the eight literals the alarms key on, not a log dump.

```
$ aws logs filter-log-events --region us-east-1 \
    --log-group-name /aws/apprunner/climate-project-api-prod/126c3f28…/application \
    --start-time <now-24h> --filter-pattern '"Heartbeat: scheduled job"'
```

**2,528 heartbeat lines over a continuous 24-hour window (2026-09-04T19:05Z →
2026-09-05T19:06Z). All eight jobs present, each at its designed cadence:**

| Job | Lines in 24 h | Implied cadence |
|---|---|---|
| `notification-dispatch` | 1,441 | every minute |
| `survey-lifecycle` | 289 | every 5 minutes |
| `scheduled-reports` | 289 | every 5 minutes |
| `microclimate-lifecycle` | 289 | every 5 minutes |
| `invitation-reminders` | 97 | every 15 minutes |
| `digests` | 97 | every 15 minutes |
| `survey-draft-retention` | 24 | hourly |
| `retention-cleanup` | 1 | daily |

The scheduling design logs a heartbeat on **every** tick including no-op ticks, so this is
positive evidence that all eight jobs are running, not merely that some had work to do.

**This does not close cutover C4**, which is a same-day re-check and must still be run on the
day. It closes A1's standing exit criterion: the eight lines have now been observed.

### 2.2 §9.2 — break-glass credentials exist

§9.2 asked for one command and warned: *"If nobody holds those credentials, break-glass rollback
does not exist and every recovery depends on GitHub Actions being reachable."*

`AWS_PROFILE=claude aws sts get-caller-identity` → account **`747814092517`**, user
`claude-code-agent`. They exist. **§9.2 is closed**, and recovery does not depend solely on
GitHub Actions.

They also carry `AdministratorAccess`, which is a separate and unwanted finding — recorded in
full, with its remediation trap, in `docs/security/agent-aws-permissions.md`.

### 2.3 §9.19's premise confirmed from the live account

```
$ aws logs describe-log-groups --log-group-name-prefix /aws/apprunner/climate-project-api-prod
  …/126c3f28…/application   retention: None   81,208,860 bytes
  …/126c3f28…/service       retention: None        44,734 bytes
  …/3527dfd2…/service       retention: None         1,928 bytes
  …/6490576b…/service       retention: None         1,925 bytes
```

Four log groups, **none with a retention policy**, 81 MB of application logs that never expire.
The gap is unchanged and still needs one number from a human; what is new is that it is now
measured against the account rather than inferred from `grep` over `infra/`.

---

## 3. Gaps that closed by code, 3–5 September (#450–#453)

| Was | Now |
|---|---|
| `ScheduledReportJob` swept every 15 minutes since #91 against three columns nothing could write | `PUT`/`DELETE /admin/reports/{id}/schedule` is the writer (#451) |
| Reports had no period-over-period comparison | `ReportComparison` projects the trends matrix for the two most recent closed waves (#452); withheld from the public link by ruling |
| `reports.filters` was a jsonb column nothing wrote or read | The filter model, validated at the endpoint (#453). `reports.config` stays deliberately unused |
| Two runbooks told a reader to budget work already done | Corrected (#450) |

---

## 4. Where this leaves the count

**HARDENED: 15 of 36 unique rows (41.7%).** Two judgment calls are stated rather than buried, so
either can be overruled:

- **§9.1 counted CLOSED.** Its own "Needed:" clause was *"either a Supabase plan decision **or**
  one command — `supabase db dump`"*, and the command was run on 4 September and the dump
  restored. The residue is real and is tracked elsewhere: production still has
  `pitr_enabled: false` and `"backups": []`, so there is *a* restorable backup but no backup
  *regime*, and the dump is currently on a laptop.
- **§8.5 counted OPEN**, per §1.3 above. Counting it closed reads 16 of 36 (44.4%).

The previously reported 17 of 37 is superseded by both the denominator correction in §1.2 and
these two calls.
