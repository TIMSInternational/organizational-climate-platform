# Survey foreign keys, and the two that are still open

Issue #168. Four `uuid` columns named for `surveys` had no foreign key at all. This note records
what was constrained, why each `ON DELETE` is what it is, and the two questions that were left
for a person because a foreign key makes a guess permanent.

## What the issue said, and what the schema said

The issue is titled "Find the two remaining unfixed FK issues from the schema review". A query
over `pg_constraint` on a real migrated database found **eight** items and **none** fixed. The
counts in the earlier review are also stale — it was written against 107 foreign keys, and the
schema now carries **133** — so every claim below was re-measured rather than repeated.

## The one fact that decides everything here

**Surveys are hard-deleted.** `SurveyEndpoints.cs:930` calls `db.Surveys.Remove(survey)`, and it
is not dead code: `DeleteSurveyAsync` returns 409 only when the survey has responses, so
`DELETE /surveys/{id}` succeeds today for any response-less survey and returns 204.

That makes `ON DELETE` the whole design question, and it makes both easy answers wrong:

- a **restrictive** constraint turns a working 204 into a 500 the moment anything points at the
  survey;
- a **cascading** constraint silently deletes rows a person wrote.

So the choice is per column, and each one is argued at its own statement in
`20260902024642_AddSurveyForeignKeys.cs`.

## Constrained

| Column | Nullable | `ON DELETE` | The short reason |
|---|---|---|---|
| `action_plans.source_survey_id` | yes | **SET NULL** | The plan is human work; the link is provenance. Matches `survey_templates.source_survey_id`. |
| `ai_insights.survey_id` | yes | **SET NULL** | An acknowledged insight is a record of a sign-off. |
| `analytics_insights.survey_id` | yes | **SET NULL** | Kept identical to `ai_insights` on purpose. |
| `demographic_snapshots.survey_id` | **no** | **CASCADE** | `NOT NULL` leaves no third option, and the snapshot is defined by its survey. |

Two supporting measurements, because the arguments rest on them:

- **Corrected 2026-09-02.** This first read `grep -rn "SurveyId ==" src/` returns *3 hits, all in
  `DemographicSnapshotEndpoints.cs`*. That is false: it returns **59 hits across 14 files**. The
  conclusion it was offered for still holds, on a measurement that can actually be checked — in
  `AIInsightEndpoints` and `AnalyticsInsightEndpoints`, `SurveyId` appears **only** as insert-time
  validation (`:107-126`, `:97-116`), the insert assignment (`:147`, `:134`) and the output
  projection (`:242`, `:256`). Neither table is ever *filtered* by `survey_id`, so `SET NULL`
  drops a pointer and reclassifies nothing. Recording the error rather than quietly fixing it,
  because a right conclusion resting on a wrong measurement is the failure mode this repo keeps
  paying for.
- `grep -rn "sourceInsightId" web/src` returns **0**. `ActionPlanList.tsx:39-46` documents the
  same thing from the other side: neither `SourceSurveyId` nor `SourceInsightId` is projected
  into `ActionPlanListItem` or `ActionPlanDetail`, so nothing in the browser can lose anything.

### What the CASCADE costs

`snapshot_id` on `demographic_snapshot_entries` and `demographic_snapshot_changes` is a required
foreign key on EF's default `Cascade`, so deleting a response-less survey now also deletes
per-user demographic rows that `SubjectErasure.cs:238` classifies as **retained** under a subject
erasure request. That is a real consequence and it is accepted knowingly rather than discovered
later; `Restrict` was the alternative and it breaks a live endpoint. Reversing it is a one-line
follow-up migration.

## Deploying this onto a database that already has rows

Orphan counts on **production were not measured** before this shipped — reading the production
connection string was not available from where the work was done. So the migration measures them
itself instead of assuming a zero, on the precedent `AddBenchmarkValidationStatusCheck` set.

- For the three **nullable** columns it nulls dangling pointers first, then constrains. That is
  not data loss: it writes exactly what `ON DELETE SET NULL` would have written had the
  constraint existed when the survey was deleted. The counts go to the deploy log via
  `RAISE NOTICE`.
- For `demographic_snapshots` the equivalent repair would be a `DELETE`, and a migration will not
  silently delete production rows holding personal data. So the constraint is added `NOT VALID`
  and then `VALIDATE`d in the same statement **when the orphan count is zero**. When it is not,
  the deploy still succeeds, the count goes to the log as a `WARNING` with the command to finish
  the job, and a person decides what those rows were.
  **`NOT VALID` is not "not enforced"**: every `INSERT` and `UPDATE` from that moment on is
  checked; only the rows already present are exempt.

Measured, not assumed (throwaway `postgres:16-alpine`, schema migrated to `AddReportShares`,
orphans planted, then migrated forward):

| | before | after |
|---|---|---|
| `action_plans.source_survey_id` orphans | 2 | 0 (nulled) |
| `ai_insights.survey_id` orphans | 1 | 0 (nulled) |
| `analytics_insights.survey_id` orphans | 2 | 0 (nulled) |
| `demographic_snapshots.survey_id` orphans | 1 | 1 (left in place) |

`pg_constraint` after that run: the three nullable ones `confdeltype='n'`, `convalidated=t`; the
snapshot one `confdeltype='c'`, `convalidated=f`. On a **clean** database migrated from scratch
all four come out `convalidated=t`, which is the production path if production has no orphans.
Rows pointing at a real survey were untouched, and an already-`NULL` pointer was not counted as
repaired. `Down` was run too: 0 errors, all four constraints dropped.

### The query to run against production

Read-only. Run it before or after the deploy; it answers "did this migration have to move
anything". `surveys."Id"` is quoted PascalCase — unquoted `id` fails with 42703.

```sql
SELECT 'action_plans.source_survey_id' AS col, count(*) AS orphan_rows
FROM action_plans a
WHERE a.source_survey_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM surveys s WHERE s."Id" = a.source_survey_id)
UNION ALL
SELECT 'ai_insights.survey_id', count(*)
FROM ai_insights i
WHERE i.survey_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM surveys s WHERE s."Id" = i.survey_id)
UNION ALL
SELECT 'analytics_insights.survey_id', count(*)
FROM analytics_insights i
WHERE i.survey_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM surveys s WHERE s."Id" = i.survey_id)
UNION ALL
SELECT 'demographic_snapshots.survey_id', count(*)
FROM demographic_snapshots d
WHERE NOT EXISTS (SELECT 1 FROM surveys s WHERE s."Id" = d.survey_id);
```

If the last row is non-zero after deploying, the constraint is `NOT VALID` and waiting:

```sql
-- after deciding what those rows are
ALTER TABLE demographic_snapshots
  VALIDATE CONSTRAINT "FK_demographic_snapshots_surveys_survey_id";
```

---

# Decision 1 — what does `action_plans.source_insight_id` point at?

**Unconstrained on purpose. Nobody has ruled, and a foreign key would make the guess permanent.**

The facts, each measured:

- There are **two** insight tables with **separate id spaces**: `ai_insights` and
  `analytics_insights`. Nothing in the column name, the entity (`ActionPlan.cs:18`), the
  configuration or the DTOs says which.
- **Nothing validates it.** `ActionPlanEndpoints.cs:131` persists `request.SourceInsightId`
  straight from the request. Compare `SurveyTemplateEndpoints.cs:228-234`, which checks the
  survey exists before writing the analogous column.
- **Nothing reads it back.** It appears in `CreateActionPlanRequest` (`ActionPlanDtos.cs:46`) and
  in neither `ActionPlanListItem` nor `ActionPlanDetail`. `grep -rn "sourceInsightId" web/src`
  returns 0.

So today the column accepts any GUID from any tenant and no screen is worse off for it. It is an
integrity gap, not a disclosure.

**What is needed:** a ruling on which table it names. Then it becomes one migration —
`SET NULL` for the same reason `source_survey_id` is `SET NULL`, plus the same orphan pre-flight.

**Before ruling, run this**, because the answer may already be in the data:

```sql
SELECT count(*) FILTER (WHERE source_insight_id IS NOT NULL)                       AS populated,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM ai_insights        i WHERE i."Id" = a.source_insight_id)) AS matches_ai,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM analytics_insights i WHERE i."Id" = a.source_insight_id)) AS matches_analytics
FROM action_plans a;
```

If `populated` is 0 — which is what the throwaway run showed for a fresh schema — then the third
option is live and is probably the right one: **drop the column** rather than constrain it. A
nullable, unvalidated, unread, never-populated column is not a relationship, and deleting it
costs nothing that anything today can observe.

`SurveyForeignKeyDeleteBehaviourTests.Source_insight_id_still_takes_any_guid_because_its_parent_table_is_undecided`
pins the current state, so this decision cannot be silently lost.

---

# Decision 2 — `notification_templates.created_by` is the only actor column that cascades

**Not changed. Both options cost something and neither is mine to pick.**

Re-measured against the live schema rather than taken from the earlier review (which counted 16
columns; there are now 33 foreign keys into `users`):

| `ON DELETE` | actor columns into `users` |
|---|---|
| CASCADE | **1** — `notification_templates.created_by` |
| RESTRICT | 14 — `surveys.created_by`, `action_plans.created_by`, `reports.created_by`, `benchmarks.created_by`, `demographic_snapshots.created_by`, `demographic_snapshot_changes.changed_by`, `user_invitations.invited_by`, `survey_versions.created_by`, `microclimates.created_by`, `action_plan_templates.created_by`, `action_plan_progress_updates.updated_by`, `question_bank_items.created_by`, `question_categories.created_by`, `question_library_items.created_by` |
| SET NULL | 8 — `survey_templates.created_by`, `microclimate_templates.created_by`, `audit_logs.user_id`, `survey_distributions.last_regenerated_by`, `ai_insights.acknowledged_by`, `question_library_items.last_modified_by`, `report_shares.created_by`, `report_shares.revoked_by` |

(The other CASCADEs into `users` — `survey_drafts.user_id`, `notifications.user_id`,
`user_demographics.user_id` — are ownership, not authorship. "This row belongs to that user" is
exactly what should cascade.)

So deleting a user today would delete every notification template they authored, and cascade
onward into `notification_template_variables` and
`notification_personalization_rules`. Templates are shared configuration, not the author's
property.

**The two options and what each costs:**

1. **RESTRICT** — matches the 14 siblings, no column change, one migration. Cost: a user who ever
   authored a template can no longer be hard-deleted. That is already true of any user who ever
   created a survey or a report, so it adds no *new* class of blocked delete.
2. **SET NULL** — matches the four template tables, keeps the template and forgets the author.
   Cost: `notification_templates.created_by` is **`NOT NULL`** (verified in
   `information_schema.columns`), so this needs `ALTER COLUMN ... DROP NOT NULL` first, and every
   reader of the column has to tolerate a null author.

**Recommendation, not a decision:** RESTRICT. It is the smaller migration, it needs no column
change, and it matches what this schema already does with authorship everywhere else. But it is
a rule about what happens to a person's work when the person is deleted, so it should be said out
loud rather than inferred from a majority vote of sibling tables.

## Two more from the same review, still open and out of #168's scope

Recorded so they are not rediscovered a third time. Both re-verified here against a live schema.

- **`microclimate_templates.company_id` is the only foreign key in the schema with a defaulted
  `onDelete`** — Postgres applied `NO ACTION` — while its seven sibling global tables
  (`survey_templates`, `action_plan_templates`, `benchmarks`, `notification_templates`,
  `question_bank_items`, `question_categories`, `question_library_items`) all pin `SET NULL`. The
  column is nullable, so this is a one-line fix; a tenant purge `SET NULL`s the siblings and
  aborts here. Needs no decision — only an owner.
- **`survey_department_targets.department_id` is CASCADE while
  `microclimate_department_targets.department_id` is RESTRICT.** Identical semantics, opposite
  behaviour. Latent today because nothing hard-deletes a department, which is also why it has
  survived; it is the same shape of divergence this note went out of its way to avoid between
  `ai_insights` and `analytics_insights`.
