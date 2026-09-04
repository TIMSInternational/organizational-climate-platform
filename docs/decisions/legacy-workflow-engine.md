# The legacy workflow-state engine — DROP (#148)

**Status: DROPPED. Evidence below; no follow-up story is needed.**

#148 asks whether three legacy routes — `api/system/workflows`,
`api/system/workflows/[executionId]` and `api/system/workflow-state` — represent a real
generic workflow engine that must be ported, or an abandoned abstraction. Its own framing:
*"This smells like an abandoned abstraction, but it should be checked rather than assumed."*

Checked. It is abandoned.

## The evidence

| Check | Result |
|---|---|
| References in `src/`, `services/`, `web/src/` | **zero** — `workflow-state`, `workflowExecution` and `system/workflows` appear nowhere |
| Legacy source available to trace call sites | **not in this repository** — 0 files match `api/system/workflows`; the legacy app was retired and only its issues were archived |
| "workflow" in the 40 archived legacy issues | **3 hits, none about a state engine** — all three are about the branch/PR *development* workflow and a workflow run id |
| A design doc mentioning it | none |

## Why the data question is moot

#148's scope asks to "check for data in the backing collections" and, if dropped, to exclude
it "from the #154 scope". Both are answered by a decision that outranks them:

**`docs/decisions/no-data-migration.md` — Federico, 2026-08-19: there is no data migration.**
#154 is **CLOSED / NOT_PLANNED**, the ETL's 51 files were deleted, and the legacy Mongo data
was mock. So there is no #154 scope to exclude anything from, and no collection whose contents
could change the answer. Even a *heavily used* legacy workflow engine would not be ported by
this migration, because nothing is being ported at all.

## The honest limit of this finding

I could not trace legacy runtime call sites or query the Mongo collections, because neither
the legacy source nor the database is reachable from this repository. If the question were
"was it ever used in production?", this evidence would not settle it.

That is not the question #148 needs answered. The question is whether anything in the **new**
stack depends on it, or whether a port must be scoped — and the answer to both is no, on
evidence that does not depend on the legacy system at all.

## Acceptance criteria

- [x] **Real usage established from call sites and data** — zero call sites in the new stack;
      legacy source unavailable and irrelevant given no-data-migration; no data will be read.
- [x] **Port-or-drop decision recorded** — drop.
- [x] **If dropped, excluded from ETL scope** — moot; #154 is closed not-planned and the ETL
      no longer exists.
- [x] **If ported, a follow-up story exists** — not ported; none needed.
