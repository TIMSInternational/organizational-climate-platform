# Migration execution plan

How the 121 tracker issues get worked through. Companion to epic
[#51](https://github.com/TIMSInternational/organizational-climate-platform/issues/51) and the
[project board](https://github.com/orgs/TIMSInternational/projects/3).

Every non-epic issue carries exactly one `batch:*` label. That assignment is validated to have
no gaps and no overlaps.

---

## The structure: two lanes plus your lane

Prior domain work ran strictly sequentially because pipelines conflicted on `Program.cs`,
`router.tsx` and `navSections.ts`. That reasoning was right, but it over-generalised:

**`src/` (.NET) and `web/` (React) are disjoint file trees.** A backend story and a frontend
story cannot conflict. The registration files that forced serialisation are one per lane —
backend serialises on `Program.cs`, frontend on `router.tsx`/`navSections.ts`, and neither
touches the other's.

So three concurrent lanes:

| Lane | What | Concurrency rule |
|---|---|---|
| **Backend** | `src/`, `tests/` | One pipeline at a time (shared `Program.cs`) |
| **Frontend** | `web/` | One at a time, **except** new-file-only work like `ui/` primitives |
| **Human** | decisions, security, infra, cutover | Yours; overlaps both |

Plus a discipline, not a lane: **the design track runs one batch ahead.** The 11
`needs-design`/`XL` issues are the real bottleneck. Designing batch N+1 while batch N executes
keeps it off the critical path.

---

## Batches

### Batch 0 — Unblock (no pipelines)
`#84` commit the in-flight Benchmark fix · `#68` CI billing · `#67` AI provider decision ·
`#69` redeploy prod

`#84` first — it is verified-building but uncommitted, and a stray checkout loses it.
`#68` and `#67` have long external/thinking latency: start their clocks immediately.
**`#69` before `#70`** — redeploying now surfaces missing-secret problems while stakes are low,
which is exactly how the previous redeploy auto-rolled-back.

### Batch 1 — Foundation + ready backend
- **FE:** `#74` tokens **alone first** (primitives must consume them), then `#75 #76 #77 #78`
  as four concurrent pipelines. The only genuinely conflict-free parallel batch in the
  programme — new files under `web/src/components/ui/`, no shared registration file.
- **BE:** `#85 → #86 → #87` on the existing `feature/reports-analytics` branch. Plans already
  written; straight to pipeline.
- **Human:** `#70` rotation · `#72` sandbox → `#71` log audit (sandbox first makes the audit targeted)
- **Design ahead:** `#88` report generation · **`#154` ETL — design now, execute in batch 7.**
  It is P0, XL, and was untracked until the audit. Learning that 32 collections don't map
  cleanly is a month-one problem, not a cutover-week problem.

### Batch 1.5 — Scope triage (one session, high leverage)
`#102 #113 #133 #134 #140 #141 #148 #151` — all are "establish real usage, then decide."
Several will come back *unused, drop it*. Deleting work is the cheapest speed available, and it
must happen before anything is built on top of them.

### Batch 2 — Foundation wave B + notifications backend
- **FE:** `#79` charts · `#80` shell · `#81` auth pages · `#82` PWA · `#83` a11y (after `#75-77`)
- **BE:** `#73` safe-evaluator design → `#96 → #97 → #100 → #101`
- **`#67` must land here.** Three issues are blocked behind it.
- **Build against [`docs/requirements/`](requirements/README.md), not against inference.** This is
  the first batch with the client PRD and review notes actually in the repo; its
  [per-issue reading list](requirements/README.md#what-batch-2-should-build-against) says which
  document governs which issue. Two conflicts to resolve rather than discover late: the notes put
  **SSO out of scope** while the Login screen spec lists it (`#81`), and neither the **PWA**
  decision (`#82`) nor the **a11y baseline** (`#83`) is specified by the client at all — those two
  are genuinely ours to decide.

### Batch 3 — First real pages + backend hardening
- **FE:** `#124` company-context **first** (it changes nav gating for everything after) →
  `#93 #98` clients → `#94 #95 #99 #103`
- **BE:** `#143` audit · `#146` rate limiting · `#147` health · `#153` token compat
- **`#143` before any export story** — four issues require audit logging to exist.

### Batch 4 — M2 completion + tracking & microclimates UI
- **BE:** `#88` report generation (L) · `#89 #90 #91` · `#144` GDPR · `#145` search ·
  `#150 #152` bugs
- **FE:** `#125 #126` tracking UI (finally consumes the orphaned `trackingApi.ts`) ·
  `#127` MC wizard · `#128 #129 #130 #131`

### Batches 5a–5c — Surveys (26 issues, the mountain)
| Batch | Backend | Frontend |
|---|---|---|
| 5a authoring + questions | `#104 #105 #106 #107 #112 #110` | `#115` picker → `#109` |
| 5b distribution + response | `#116 #118` | `#117 #120` |
| 5c results + wizard | `#121 #122` | `#123 #114 #108` |

`#108` (survey wizard) is XL — 34 legacy components, needs its own decomposition. Build its
shell shared with `#127`, whichever lands first. `#112 → #115 → #108/#127` is a hard chain:
the question picker gates both wizards.

### Batch 6 — Parity completion
`#132` role dashboards · `#138` non-admin experience · `#135 #136 #137 #139 #142` ·
`#149` drop dev routes, plus whatever survived triage.

`#132` and `#138` are the biggest remaining user-facing gaps — every non-admin currently logs
in to nothing.

### Batch 7 — Migration & cutover prep
`#155` identity → `#154` ETL (designed back in batch 1) → `#156` staging → `#157` dry run.
In parallel: `#158` monitoring · `#159` rollback · `#160` DNS. Then `#161` UAT.

**`#161` requires `#100`** — you cannot test an invitation flow that never sends an invitation.

### Batch 8 — Cutover + decommission
`#162` cutover (explicit go/no-go) → `#163` → `#164 #165 #166 #167` → backlog `#168-#171`.

### Deferred
`#92 #111 #119` behind `#67`. Not schedulable until that decision lands; kept out of batches
so burndown stays honest.

---

## The per-batch operating loop

Same six steps every time.

1. **Open the batch.** Move its issues to *In Progress* on the board. Confirm the design track
   delivered whatever this batch needs — if a `needs-design` issue has no design doc, it is not
   ready and should slip rather than be improvised.
2. **Branch.** One worktree per pipeline, each based on the **current `main` tip at launch**,
   never a stale SHA.
3. **Run.** Pipelines within a lane run sequentially; lanes run concurrently. Only new-file-only
   work parallelises inside a lane.
4. **Merge, one at a time.** Rebase each branch onto `main` immediately before its merge.
   **Never rebase a branch that is mid-flight.**
5. **Verify on merged `main`** — build plus full test suite — before pushing. Every time.
6. **Close and open the next.** Design for batch N+1 should already be underway.

## Five rules that keep quality while moving fast

1. **Parallel branches, serialised merges.** Concurrency in the work, not in the merge.
2. **One pipeline per lane per shared registration file.** Two backend pipelines editing
   `Program.cs` at once is the conflict that forced serialisation; in sequence it is fine.
3. **Checkpoint to the issue after every task** — a comment with branch SHA and task number.
   A pipeline's run state dies with its session and cannot be resumed across sessions; the
   issue comment is what makes a dead run recoverable rather than lost.
4. **A human reviews the branch before merge.** Whole-branch review has caught real bugs that
   per-task review missed. Auto-merge is what let an unreviewed domain reach `main` once.
5. **`BLOCKED` means hand-fix, never relaunch.** The one-fix-wave budget is deliberate.

## Where automation fits

| Work | How |
|---|---|
| Story with a written plan (~80 issues) | Pipeline it |
| `needs-design` / `XL` (11 issues) | Design conversationally first, then pipeline |
| Decisions, security, infra, cutover (~25) | Human only. A pipeline may research; it must not execute |

Roughly 70% is pipelineable, but the other 30% gates it. Throughput is limited by design and
review capacity, not by agent capacity — adding agents to the executable 70% does not help if
the 30% is the constraint.
