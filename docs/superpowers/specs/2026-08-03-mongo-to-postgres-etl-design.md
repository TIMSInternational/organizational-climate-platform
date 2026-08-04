# Production data migration — MongoDB → Postgres ETL (#154) — Design

**Status: architecture settled, field-level mapping blocked.** This document fixes the
mechanism — identity, ordering, idempotency, reconciliation, and where the tool lives — and
proposes a decomposition. It does **not** complete the per-collection field mapping, for two
reasons stated up front rather than buried:

1. **Three collections have no target schema at all** (see [Blocking findings](#blocking-findings)).
   They cannot be mapped until #58 is designed.
2. **No production MongoDB data has been examined.** The mapping below is derived from the
   legacy Mongoose schemas in `climate-project/src/models/`. Mongo is schemaless in practice
   and this issue's own scope note warns to expect documents that do not match the nominal
   model. A schema-derived mapping is a hypothesis; only a dump can confirm it.

Reading the legacy schemas closely has already produced five findings that change the plan.
That is the argument for design-first: each of these would have been discovered during
implementation, or at cutover.

---

## Blocking findings

### 1. Three collections have nowhere to land — blocked on #58

`QuestionBank`, `QuestionCategory` and `QuestionLibrary` (1,264 lines of legacy model between
them, with `QuestionPool` and `LibraryQuestion`) have **no corresponding entity** in
`src/ClimateProject.Domain/Entities/`.

The target `Question` entity is **survey-scoped**: `SurveyId` is a non-nullable `Guid`, and
`Category` is a plain `string`. There is no standalone question repository, no category
hierarchy, and no library concept anywhere in the 50 entities.

That is not an oversight — **EPIC #58 "M4b: Question repositories" is `needs-design`**. The
schema those four collections need has not been designed yet.

**Consequence:** #154's acceptance criterion *"every collection mapped or explicitly excluded
with a reason"* **cannot be met today**, and #154 is hard-blocked on #58 for 4 of 32
collections. Sequencing #154 before #58 would mean designing the question-repository schema
inside the ETL issue, which is the wrong place for it.

### 2. Only two entities can store a legacy identifier

`User.PersonaExternalId` and `Department.LegacyExternalId` are the **only** legacy-ID columns
in the schema. The other 42 GUID-keyed entities have nowhere to record where they came from.

This matters far beyond #155's tracking-continuity concern. Without a legacy→new identity
record, an ETL cannot be idempotent (a re-run duplicates everything) and cannot resolve
foreign keys (a child document references its parent by legacy `_id`). This is the single
most consequential design decision in the migration, and it is resolved below by
[deriving identifiers deterministically](#identity-deterministic-guids) rather than by adding
42 columns.

### 3. `super_admin` users cannot satisfy the target schema — filed as #191

Legacy `User.company_id` is required **only when `role !== 'super_admin'`** (`User.ts:118-124`).
Target `User.CompanyId` is a **non-nullable `Guid`**.

So every super-admin in production has no company and no valid target value. There is no
correct answer available to the ETL — inventing a sentinel company silently corrupts
multi-tenant scoping, and the multi-tenant rule in this repo is that `CompanyId == null` means
*globally visible*, which is a meaningful state the column cannot currently express.

**This needs a schema decision, not an ETL workaround.** Same question applies to
`department_id`, which is nullable in the target and therefore fine.

### 4. Six notification-preference fields have no target home — filed as #192

Legacy `User.preferences.notification_settings` carries `email_surveys`,
`email_microclimates`, `email_action_plans`, `email_reminders`, `push_notifications` and
`digest_frequency` (`User.ts:33-46`).

Target `UserPreferences` has `Language`, `Timezone`, `DashboardLayout`, `Theme` — and nothing
else. All six per-channel notification preferences would be **dropped without an error**.

**This is almost certainly an oversight rather than a decision, and `Department` is the
evidence.** Legacy `Department.settings.notification_preferences` is a nested subdocument with
`email_enabled`/`slack_enabled`/`teams_enabled`, and the target `DepartmentSettings` flattens
all three into `NotificationEmail`/`NotificationSlack`/`NotificationTeams` — carefully, losing
nothing. The identical pattern one collection over was handled; on `User` it was missed.

This lands squarely on Batch 2: #96/#97/#100/#101 build notifications and #97 is explicitly
"self-service endpoints". Users would arrive in the new system with their opt-outs silently
reset to defaults — which is both a trust problem and, for `email_*` opt-outs, arguably a
consent problem given the platform's own consent model. **Worth fixing before #97 is built,
not after**, since #97 will otherwise define the preference surface without them.

### 5. Demographics-as-JSON conflicts with a client requirement — filed as #193

Legacy `User.demographics` is `{ _id: false, strict: false }` — arbitrary company-defined
fields. Target `User.Demographics` is a single `string?`, i.e. a JSON blob.

The client requirement ported in this repo's `docs/requirements/notes/req.md` §2.2 states
that **all custom demographics must be filterable in dashboards and exports**, enabling
segmentation by gender, tenure bracket, educational level and so on. A JSON string column
cannot serve that without either Postgres `jsonb` operators (the column is `string`, not
`jsonb`) or the normalised `DemographicField` / `DemographicSnapshotEntry` tables that already
exist.

Two structures for the same data now exist side by side, and the ETL has to pick. That choice
determines whether a binding client requirement is met, so it is not the ETL's call to make
quietly.

---

## Architecture

### Identity: deterministic GUIDs

**Derive every target `Guid` from the source Mongo `_id` by RFC 4122 v5 (namespace + SHA-1),
using one fixed namespace UUID per migration.**

```
newId(collection, objectId) = uuidv5(MIGRATION_NAMESPACE, collection + ":" + objectId.hex)
```

This single decision buys most of the acceptance criteria:

- **Idempotency** comes free. Re-running produces byte-identical keys, so every write is an
  upsert on a known primary key. No "have I already loaded this?" bookkeeping.
- **Resumability** comes free. A run that dies at collection 28 of 32 restarts anywhere; the
  first 27 collections re-derive the same keys and upsert to no effect. The issue's
  requirement that failure at 28/32 must not require starting over is satisfied structurally
  rather than by checkpointing.
- **Foreign keys need no lookup table.** Legacy documents reference parents by `_id` *string*
  (see below). Resolving `user.company_id` to a target `Guid` is a pure function of that
  string — no map, no join, no ordering dependency for *resolution* (ordering still matters
  for FK *constraint satisfaction*).
- **Cross-run stability.** Dry runs (#157) against staging produce the same identifiers as
  the real cutover, so anything verified in a dry run stays verified.
- **Reconciliation is checkable.** Any legacy `_id` can be turned into the row it should have
  become, without consulting migration state.

The alternative — an ID-map table — needs to survive between runs, becomes a single point of
failure, and makes dry runs non-reproducible. The alternative of adding `LegacyExternalId` to
42 entities pollutes the domain model with migration concerns permanently.

`User.PersonaExternalId` and `Department.LegacyExternalId` are still populated with the raw
legacy `_id`, because #155's consumers (`services/tracking-api`'s `NodoExternalId`,
`LiderExternalId`, `UsuarioExternalId`) read those strings directly and are not being re-keyed.
Determinism does not replace that requirement; it complements it.

**Record the namespace UUID in the design and never change it.** Changing it re-keys the
entire database.

### References are strings, not ObjectIds

Worth stating loudly because it shapes everything: legacy cross-collection references are
declared `{ type: String }`, not `Schema.Types.ObjectId` (`User.company_id`, `department_id`,
`manager_id` are all plain trimmed strings). Mongo enforced nothing.

So expect, and design for:

- references to documents that no longer exist (dangling)
- references that are not valid ObjectId hex at all (typos, empty strings, `"undefined"`)
- references pointing at the wrong collection

The new schema has real FK constraints that the old one did not (#150 is an example of one
that is still missing). **Every one of these becomes an insert failure, not a warning.** The
ETL must resolve references in a pass that classifies each as resolved / dangling /
malformed, and route the latter two to the data-quality report rather than aborting the load.

### Load order

Dependency-ordered so FK constraints are satisfiable on insert. Derived from the target
schema's FKs, not the legacy one's (which has almost none):

1. `Company`
2. `Department` — self-referential parent; load in two passes (rows first, `ParentId` second)
3. `User` — FK to Company + Department; `ManagerId` is self-referential, so second pass
4. `SystemSettings`, `DemographicField`
5. `SurveyTemplate` → `TemplateQuestion`; `MicroclimateTemplate` → `MicroclimateTemplateQuestion`; `ActionPlanTemplate` → children
6. `Survey` → `Question` (+ `QuestionConditionalLogic`, `QuestionEmojiOption`), `SurveyDepartmentTarget`
7. `SurveyVersion`, `SurveyDraft`, `SurveyDistribution`, `SurveyInvitation`, `SurveyAuditLog`
8. `Microclimate` → `MicroclimateQuestion`, `MicroclimateDepartmentTarget`, `MicroclimateAiInsight`; `MicroclimateInvitation`
9. `Response` → `QuestionResponse`, `ResponseDemographic` — **the volume driver**
10. `DemographicSnapshot` → `Entry`, `Change`
11. `ActionPlan` → `Kpi`/`KpiUpdate`/`Objective`/`ObjectiveUpdate`/`ProgressUpdate`
12. `AIInsight`, `AnalyticsInsight` → `AnalyticsMetricData`, `AnalyticsTimeSeries`
13. `Benchmark` → `BenchmarkMetric`; `Report`
14. `NotificationTemplate` → children; `Notification`
15. `UserInvitation`, `AuditLog`

Self-referential columns (`Department.ParentDepartmentId`, `User.ManagerId`) are deliberately
deferred to a second pass rather than solved by topologically sorting rows within a collection
— with deterministic IDs the second pass is a cheap `UPDATE`, and cycles in legacy data cannot
deadlock it.

Note that legacy `Department` nests the parent pointer inside a `hierarchy` subdocument
(`hierarchy.parent_department_id`) alongside `level` and `path`. Those latter two are
**derived** values — depth and materialised path — with no target column, and they are
correctly absent: both are recomputable from `ParentDepartmentId`. Recording that here so a
later reviewer does not mistake them for finding 4's kind of loss. The ETL should recompute and
assert them as a referential-integrity check rather than carry them.

### Where it runs

**A new standalone console project, `tools/ClimateProject.DataMigration`,** not
`ClimateProject.Workers`.

Workers is a deployed runtime service; a one-off cutover tool has no business shipping inside
it, and #101 is about to add real scheduled jobs there. The tool must run repeatedly during
dry runs (#157), against different databases, with flags for
`--dry-run`, `--collections=<list>`, `--resume`, and `--report-path`.

It connects to the Supabase **direct** connection (port 5432), never the pooler (6543) — the
same constraint EF migrations already have.

### Reconciliation

Three layers, because the failure mode to fear is a count match with mangled content:

1. **Per-collection counts** — source documents, rows written, rows skipped, with skip reasons
   summing to the difference. A count that reconciles only because skips are uncounted is the
   trap.
2. **Content spot-checks** — for each collection, sample N documents (deterministically, by
   `_id` ordering, so dry runs and the real run check the same ones) and compare every mapped
   field. Include the newest and oldest document by `created_at`, not only random ones.
3. **Referential integrity** — after load, assert every FK resolves, and count rows whose
   legacy reference was dangling or malformed.

Plus **the data-quality report**, which the issue rightly expects to be non-empty: every
document not migrated cleanly, with collection, legacy `_id`, field, and reason. This is a
deliverable to be read, not a log.

### Normalising rather than importing legacy inconsistencies

Per #152's precedent, known legacy inconsistencies are normalised in the ETL, and each
normalisation is a named, tested rule listed in the report — never an inline silent fix. A
normalisation nobody can enumerate afterwards is indistinguishable from a bug.

---

## Collection mapping — status

All 32 legacy collections. "Fan-out" means Mongo embedded arrays become child tables.

| # | Legacy collection | Target | Status |
|---|---|---|---|
| 1 | `Company` | `Company` | mappable |
| 2 | `Department` | `Department` | mappable; self-ref 2nd pass. **Cleanest mapping of the 32** — even nested settings flatten 1:1 |
| 3 | `User` | `User` | **3 blocking gaps** — #191, #192, #193 |
| 4 | `SystemSettings` | `SystemSettings` | mappable |
| 5 | `DemographicField` | `DemographicField` | mappable |
| 6 | `DemographicSnapshot` | + `Entry`, `Change` | mappable, fan-out |
| 7 | `Survey` | + `Question`, `SurveyDepartmentTarget` | mappable, fan-out |
| 8 | `SurveyVersion` | `SurveyVersion` | mappable |
| 9 | `SurveyDraft` | `SurveyDraft` | mappable |
| 10 | `SurveyTemplate` | + `TemplateQuestion` | mappable, fan-out |
| 11 | `SurveyDistribution` | `SurveyDistribution` | mappable |
| 12 | `SurveyInvitation` | `SurveyInvitation` | mappable |
| 13 | `SurveyAuditLog` | `SurveyAuditLog` | mappable |
| 14 | `Response` | + `QuestionResponse`, `ResponseDemographic` | mappable, fan-out, **volume driver** |
| 15 | `Microclimate` | + `MicroclimateQuestion`, `…DepartmentTarget`, `…AiInsight` | mappable, fan-out |
| 16 | `MicroclimateTemplate` | + `MicroclimateTemplateQuestion` | mappable, fan-out |
| 17 | `MicroclimateInvitation` | `MicroclimateInvitation` | mappable |
| 18 | `ActionPlan` | + 5 child tables | mappable, fan-out |
| 19 | `ActionPlanTemplate` | + `Kpi`, `Objective` | mappable, fan-out |
| 20 | `AIInsight` | `AIInsight` | mappable; check #152's shape bug first |
| 21 | `Analytics` | `AnalyticsInsight` + `MetricData` + `TimeSeries` | mappable, 3-way fan-out |
| 22 | `Benchmark` | `Benchmark` + `BenchmarkMetric` | mappable, fan-out |
| 23 | `Report` | `Report` | mappable |
| 24 | `Notification` | `Notification` | mappable |
| 25 | `NotificationTemplate` | + `Variable`, `PersonalizationRule` | mappable; conditions must pass #73's parser |
| 26 | `UserInvitation` | `UserInvitation` | mappable |
| 27 | `AuditLog` | `AuditLog` | mappable |
| 28 | `LibraryQuestion` | — | **excluded**, dead code (confirm no rows) |
| 29 | `QuestionPool` | — | **blocked on #113** (decision) |
| 30 | `QuestionBank` | — | **blocked on #58** — no target schema |
| 31 | `QuestionCategory` | — | **blocked on #58** — no target schema |
| 32 | `QuestionLibrary` | — | **blocked on #58** — no target schema |

**26 mappable · 1 excluded · 1 decision-blocked · 4 schema-blocked.**

One point on #25: legacy personalization-rule conditions are free-form strings that used to be
`eval`'d. #73's parser now rejects anything that is not a single comparison, so the ETL must
run every stored condition through `NotificationConditionParser.TryParse` and report failures.
Only one condition is known to exist (`reminderCount >= 3`) and it parses — but production may
hold admin-authored ones that do not, and those must surface in the report rather than migrate
into a column whose contents no longer evaluate.

## Worked example — the mapping method, and what it catches

`User`, chosen because it is the identity root and #155's critical path.

| Legacy (`User.ts`) | Target (`User.cs`) | Note |
|---|---|---|
| `_id` | `Id` | v5 derivation; raw value also → `PersonaExternalId` |
| `name` | `Name` | direct |
| `email` | `Email` | lowercased already; unique index → check dupes pre-load |
| `password_hash` | `PasswordHash` | `select: false` in Mongoose — **must be explicitly requested or it silently arrives null**, locking every user out |
| `role` | `Role` | enum → string; verify the target's expected role vocabulary matches |
| `company_id` (String, optional for super_admin) | `CompanyId` (**Guid, non-null**) | ⚠️ **#191** |
| `department_id` (String) | `DepartmentId` (`Guid?`) | resolve; dangling → report |
| `manager_id` (String) | `ManagerId` (`Guid?`) | second pass; #150 notes the FK is missing |
| `preferences.{language,timezone,dashboard_layout,theme}` | `Preferences.*` | direct |
| `preferences.notification_settings.*` (6 fields) | — | ⚠️ **#192** — no target home |
| `demographics` (schemaless) | `Demographics` (`string?`) | ⚠️ **#193** |
| `consent_preferences` (6 fields) | `Consent` (6 fields) | direct, 1:1 |
| `consent_updated_at` | `ConsentUpdatedAt` | direct |
| `is_active` | `IsActive` | direct |
| `last_login` | `LastLoginAt` | `Date` → `DateTimeOffset`; Mongo dates are UTC, assert no local-time drift |
| `created_at` / `updated_at` | `CreatedAt` / `UpdatedAt` | direct |
| — | `NodoId` | new; tracking integration, not in legacy |

The `password_hash` row is the kind of thing this exercise exists to find: Mongoose's
`select: false` means a naive `find()` returns documents **without** the field, and the ETL
would write `null` for every user, cleanly, with matching row counts and no error. Everyone
would be locked out of production and reconciliation-by-count would report success.

One collection, four issues. That is the ratio to expect across the remaining 25.

---

## What is needed to finish this

**From the user:**

- **A read-only production MongoDB dump, or authorisation to take one.** A `MONGODB_URI` is
  present in `climate-project/.env.local` and `mongodump` is installed locally, so this is
  technically available now — but it is production customer data containing PII and I have not
  touched it. Note also that this credential was readable by the malware during the exposure
  window and #70's rotation has not happened, so it should be rotated before or alongside any
  use. Preference: restore a dump into a local scratch Postgres/Mongo and work there.
- **Decisions on #191, #192 and #193.** Each is a schema question, not an ETL question:
  nullable `CompanyId` (or an explicit super-admin representation); where notification
  preferences live; and whether demographics are normalised or `jsonb`. #192 and #193 are
  **time-sensitive** — #97 and #87 would otherwise define those surfaces first.
- **Row counts per collection**, even approximate, if a dump is not forthcoming soon. They
  determine whether `Response` needs batched streaming or fits in memory, which changes the
  tool's shape.

**Sequencing:** #58 (question repositories) must be designed before #154 can claim complete
coverage. #113 gates `QuestionPool`. Both are upstream of the ETL, and #154 should be
re-sequenced behind #58 rather than left as a batch-7 item that silently cannot finish.

## Proposed decomposition

#154 is `size:XL` and the issue anticipates decomposition. Suggested split, each independently
verifiable:

| Sub-issue | Scope | Depends on |
|---|---|---|
| **A** | Tool skeleton: console project, config, direct-connection guard, CLI flags, deterministic-ID library + tests, data-quality report writer | — |
| **B** | Identity & org: `Company`, `Department`, `User`, `SystemSettings`, `DemographicField` + the #155 backfill and both second passes | A, **#191 #192 #193** |
| **C** | Surveys & responses: collections 7–14 — the volume driver, needs batched streaming | B |
| **D** | Microclimates, action plans, templates: 15–19 | B |
| **E** | Analytics, reports, notifications, audit: 20–27, incl. #73 condition validation | B |
| **F** | Question repositories: 29–32 | **#58, #113** |
| **G** | Reconciliation harness: counts, deterministic spot-checks, FK integrity, interrupted-run proof | A, and each of B–F as they land |

**G is where the acceptance criteria actually get met**, and it should be built alongside B
rather than last — a reconciliation harness written after the fact tends to be written to
agree with whatever the ETL did.

## Acceptance criteria status

- [ ] **Design doc committed and approved** — this document; needs review, and #191/#192/#193
      need decisions before it can be called approved
- [ ] **Every collection mapped or explicitly excluded** — 26 mappable, 1 excluded, **5 blocked**;
      cannot be met until #58 and #113
- [x] **Legacy identifiers preserved** — mechanism settled: v5 derivation plus raw `_id` into
      `PersonaExternalId`/`LegacyExternalId` per #155
- [x] **Idempotent and resumable** — by construction via deterministic IDs; the interrupted-run
      proof is sub-issue G
- [x] **Row counts reconciled per collection** — designed, with the skip-accounting trap named
- [x] **Content spot-checks** — designed, deterministic sampling so dry runs and cutover agree
- [x] **Referential integrity verified** — designed as a post-load pass
- [x] **Data-quality report** — designed as a reviewable deliverable

Four of the eight are settled as *design*; all eight need implementation, and two are blocked
on decisions and upstream design that are not #154's to make.

## Tracked follow-ups

Three of the five blocking findings are now their own issues, because each is a schema decision
with consequences outside the ETL:

| Issue | Finding | Time pressure |
|---|---|---|
| **#191** | `User.CompanyId` non-nullable vs super-admins with no company | blocks #154 sub-issue B |
| **#192** | six notification preferences with no target column | **before #97** defines the self-service preference surface |
| **#193** | demographics as opaque `string` vs the filterability requirement | **before #87** ships the snapshot endpoints |

The other two are upstream: **#58** (question-repository schema, `needs-design`) and **#113**
(`QuestionPool` decision).

**Recommended re-sequencing:** #154 currently sits in `batch:7-migration`, which implies it can
be picked up late. It cannot — 4 of 32 collections depend on #58, a `needs-design` epic in the
surveys domain. Either #58 moves earlier or #154 splits so that sub-issues A–E (26 collections)
proceed now and F waits. The latter is preferable: it keeps the ETL off the critical path
instead of parking the whole thing behind an epic.

---

# Addendum — 2026-08-04 — content i18n (#195) changes the collection count

A **sixth** blocking finding was filed as **#195** after this document was written, and is now
designed in
[2026-08-04-content-i18n-schema-design.md](./2026-08-04-content-i18n-schema-design.md). Read that
document before implementing sub-issues covering `Survey`, `SurveyTemplate`, `SurveyVersion`,
`Microclimate`, `MicroclimateTemplate` or any question collection. Two things change here.

## 1. `QuestionCategory` / `QuestionLibrary` were blocked on #195, not only on #58

The [Blocking findings](#blocking-findings) section attributes all four schema-blocked
collections to #58 alone. Two of them are bilingual to their core — `QuestionLibrary` has
`text_es`/`text_en`, `options_es`/`options_en` and `scale.labels_es`/`labels_en`;
`QuestionCategory` has nested `{ en, es }` on `name` and `description` — so #58 could not be
designed until the representation question was settled. It now is: paired `_en`/`_es` columns,
with options moving to a child table carrying a locale-independent value. The target entity
shapes for both are specified in the #195 document, so these two are unblocked as soon as #58's
entities exist.

`LibraryQuestion`'s exclusion as dead code **is confirmed** rather than assumed: its one
apparent reference in `climate-project/src/components/surveys/QuestionLibraryBrowser.tsx` is a
locally declared `interface LibraryQuestion`, not an import of the Mongoose model. The row count
is still worth taking, but the code evidence is now unambiguous.

## 2. Five of the "26 mappable" need a language attribution decision first

This is the part that changes a number in the [Collection mapping](#collection-mapping--status)
table. Legacy `Survey`, `SurveyTemplate`, `SurveyVersion`, `Microclimate` and
`MicroclimateTemplate` store **one** string per content field (`title`, `description`,
`questions[].text`) and **no `language` field on any of them** — verified across all four models.
The target schema after #195 has two columns per field. So for each of these rows the ETL must
decide *which column the single legacy string goes into*, and nothing in the source says.

Required behaviour:

1. **Attribute by `Company.language`** — the only signal that exists. Write the value to
   `<field>_<attributed>` and leave the other language NULL.
2. **Set `Survey.Language` / `Microclimate.Language` to that same single language, not `both`.**
   Otherwise #195's publish-time validation gate fails every migrated survey for missing
   translations that never existed.
3. **Record every attribution in the data-quality report**, per collection and per company. This
   is a guess the ETL is making about production content; it must be visible, not silent.
4. **Add one query to [What is needed to finish this](#what-is-needed-to-finish-this):** the
   distribution of `Company.language` values in production. `Company.language` defaults to `"en"`,
   so if companies never set it while their content is in fact Spanish, rule 1 mislabels the whole
   corpus — Spanish text sitting in an English column, row counts reconciling, no error. That is
   the same failure shape as the `password_hash` `select: false` finding, and this issue's own AC
   ("a count match with mangled content is the failure mode to fear") names it.

`Response` and `QuestionResponse` gain a `Language` column under #195 and need the same
attribution and the same reporting.

**Corrected count.** Where this document says *"26 mappable · 1 excluded · 1 decision-blocked ·
4 schema-blocked"*, read:

> **21 straightforwardly mappable · 5 mappable with a recorded language attribution ·
> 1 excluded · 1 decision-blocked · 4 schema-blocked.**

The 32 total and the set of schema-blocked collections are unchanged; what changes is that five
collections previously counted as clean carry an undecided attribution that must be settled — and
reported — rather than defaulted silently inside the loader.
