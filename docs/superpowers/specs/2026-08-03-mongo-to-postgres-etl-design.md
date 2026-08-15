# Production data migration — MongoDB → Postgres ETL (#154) — Design

> **Verified against `1219dc6` (origin/main, 2026-08-15).** Amended in place: **#191, #192,
> #193 and #195 were all resolved and closed on 2026-08-06**, after this document and its
> first addendum were written, and the schema moved under the worked User mapping. The three
> blocking findings below are marked RESOLVED with their outcomes, the User mapping table is
> corrected against the current entity classes (not against memory of them), and the
> [2026-08-15 addendum](#addendum--2026-08-15--resolutions-folded-in-scaffold-landed-census-corrected)
> records the migration namespace, the tool scaffold, and a census correction. Statements not
> marked otherwise still read as written on 2026-08-03/04.

**Status: architecture settled; findings 3–5 (#191/#192/#193) and the #195 i18n gap are
resolved in the schema; field-level mapping remains blocked only where #58/#113 are still
open.** This document fixes the
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

> **RESOLVED 2026-08-06 —
> [#191](https://github.com/TIMSInternational/organizational-climate-platform/issues/191)
> closed.** `User.CompanyId` is now `Guid?`, and NULL means global scope — consistent with
> the established `CompanyId == null` convention on Benchmark and the four template
> entities (see the comment on `User.cs`). A sentinel company was explicitly rejected.
> **ETL consequence:** a legacy super-admin with no `company_id` migrates with
> `CompanyId = NULL`; nothing needs inventing.

Legacy `User.company_id` is required **only when `role !== 'super_admin'`** (`User.ts:118-124`).
Target `User.CompanyId` is a **non-nullable `Guid`**.

So every super-admin in production has no company and no valid target value. There is no
correct answer available to the ETL — inventing a sentinel company silently corrupts
multi-tenant scoping, and the multi-tenant rule in this repo is that `CompanyId == null` means
*globally visible*, which is a meaningful state the column cannot currently express.

**This needs a schema decision, not an ETL workaround.** Same question applies to
`department_id`, which is nullable in the target and therefore fine.

### 4. Six notification-preference fields have no target home — filed as #192

> **RESOLVED 2026-08-06 —
> [#192](https://github.com/TIMSInternational/organizational-climate-platform/issues/192)
> closed.** `User.Notifications` (`NotificationPreferences`, flat beside `Consent`) now
> carries all six fields verbatim, with defaults matching legacy
> `NotificationSettingsSchema` exactly — deliberate, so a field the ETL cannot read stays
> at the value legacy would have given it rather than re-subscribing an opt-out.
> `push_notifications` is stored but not exposed on the API until #82 decides the PWA.
> The worked mapping row below was already updated for this.

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

> **RESOLVED 2026-08-06 —
> [#193](https://github.com/TIMSInternational/organizational-climate-platform/issues/193)
> closed, in favour of normalisation.** The opaque `User.Demographics` string column no
> longer exists. Its replacement is the `UserDemographic` child table
> (`UserId`, `DemographicFieldId`, `Value`) — one row per answer, keyed by the company's
> `DemographicField` definition — plus `UserInvitationDemographic` for demographics
> assigned at invitation time. **ETL consequence:** `User` becomes a fan-out like
> `Department`'s settings never was: each key of the schemaless legacy `demographics`
> subdocument must resolve to a configured `DemographicField` for that company; keys and
> out-of-range values that do not resolve go to the data-quality report, never into a
> blob. Same for `UserInvitation.demographics`.

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
| 3 | `User` | `User` + `UserDemographic` | mappable, fan-out — #191/#192/#193 all resolved 2026-08-06; demographics keys must resolve to `DemographicField`, unresolved → report |
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
| 26 | `UserInvitation` | `UserInvitation` + `UserInvitationDemographic` | mappable, fan-out since #193 — same key-resolution rule as `User` |
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
| `company_id` (String, optional for super_admin) | `CompanyId` (`Guid?`) | **#191 resolved 2026-08-06** — null means global scope; a super-admin with no legacy company migrates as NULL |
| `department_id` (String) | `DepartmentId` (`Guid?`) | resolve; dangling → report |
| `manager_id` (String) | `ManagerId` (`Guid?`) | second pass; #150 notes the FK is missing |
| `preferences.{language,timezone,dashboard_layout,theme}` | `Preferences.*` | direct |
| `preferences.notification_settings.*` (6 fields) | `Notifications` (6 fields) | direct, 1:1 — **#192** resolved. Flattened one level: legacy nests these under `preferences`, the target hangs them off `User` beside `Consent`. All six carry over, including `push_notifications`, which is stored but not yet exposed by the API (#82). Leave every field the ETL cannot read at its DDL default — the four `email_*` are opt-outs real users have set, and writing a value the legacy doc did not contain re-subscribes them |
| `demographics` (schemaless) | `UserDemographic` rows (`DemographicFieldId`, `Value`) | **#193 resolved 2026-08-06** — fan-out to a child table; the `Demographics` string column no longer exists. Each key must resolve to the company's `DemographicField`; unresolved keys/values → data-quality report |
| `consent_preferences` (6 fields) | `Consent` (6 fields) | direct, 1:1 |
| `consent_updated_at` | `ConsentUpdatedAt` | direct |
| `is_active` | `IsActive` | direct |
| `last_login` | `LastLoginAt` | `Date` → `DateTimeOffset`; Mongo dates are UTC, assert no local-time drift |
| `created_at` / `updated_at` | `CreatedAt` / `UpdatedAt` | direct |
| — | ~~`NodoId`~~ | **correction 2026-08-15: this column does not exist.** #151 dropped it as confirmed-dead; a user's nodo is *derived* from `DepartmentId` by `TrackingIdentifiers`, never stored. The ETL writes nothing |
| — | `SecurityStamp` | new (#284); session-revocation stamp, initialised per row by the entity itself — the ETL must leave it alone, not copy or blank it |

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
- ~~**Decisions on #191, #192 and #193.**~~ **Done 2026-08-06** — all three closed with the
  schema landed: `CompanyId` nullable (null = global scope), `NotificationPreferences`
  carried verbatim, demographics normalised into `UserDemographic` /
  `UserInvitationDemographic`. See the RESOLVED notes on findings 3–5 above.
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

- [ ] **Design doc committed and approved** — this document; committed and amended, review
      still outstanding. The #191/#192/#193 decisions it was waiting on are made (2026-08-06)
- [ ] **Every collection mapped or explicitly excluded** — 26 mappable, 1 excluded, **5 blocked**
      (plus the three QuestionPool.ts sub-collections, see the 2026-08-15 addendum);
      cannot be met until #58 and #113, both still open as of 2026-08-15
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

Three of the five blocking findings became their own issues, because each was a schema decision
with consequences outside the ETL. **All three are now closed (2026-08-06):**

| Issue | Finding | Outcome |
|---|---|---|
| **#191** | `User.CompanyId` non-nullable vs super-admins with no company | **resolved** — `CompanyId` is `Guid?`, null = global scope |
| **#192** | six notification preferences with no target column | **resolved** — `NotificationPreferences` on `User.Notifications`, six fields verbatim, legacy defaults |
| **#193** | demographics as opaque `string` vs the filterability requirement | **resolved** — normalised into `UserDemographic` / `UserInvitationDemographic`, keyed by `DemographicField` |

The other two are upstream and **still open as of 2026-08-15**: **#58** (question-repository
schema, `needs-design`) and **#113** (`QuestionPool` decision).

**Recommended re-sequencing:** #154 currently sits in `batch:7-migration`, which implies it can
be picked up late. It cannot — 4 of 32 collections depend on #58, a `needs-design` epic in the
surveys domain. Either #58 moves earlier or #154 splits so that sub-issues A–E (26 collections)
proceed now and F waits. The latter is preferable: it keeps the ETL off the critical path
instead of parking the whole thing behind an epic.

---

# Addendum — 2026-08-04 — content i18n (#195) changes the collection count

> **RESOLVED 2026-08-06 —
> [#195](https://github.com/TIMSInternational/organizational-climate-platform/issues/195)
> closed; the schema described below is implemented, not just designed.** Verified in the
> entities: paired `_en`/`_es` columns on `Survey`/`Question` (and per-language
> `CommentPrompt` defaults), `QuestionOption` as a child table carrying a stable
> locale-independent `Value` that is what `question_responses.response_value` stores, and
> `Response.Language` recording the served locale. `QuestionResponse` did NOT gain its own
> `Language` column — the response-level one is the record. The *attribution* rules below
> (which column a monolingual legacy string lands in, reported per company) are unchanged
> and still the ETL's to implement; section 3's sequencing warning is now moot because the
> options schema exists — what remains is B/C-ordering: load `QuestionOption` rows and map
> answers to stable values in the same slice that loads responses.

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

## 3. This changes the decomposition, not only the field mapping

[Proposed decomposition](#proposed-decomposition) recommends that sub-issues **A–E** (the 26
"mappable" collections) proceed now, independent of **F** (the #58-blocked question collections).
That still holds for 24 of them, but **not for `Response`/`QuestionResponse`**.

#195 moves question options from `text[]` to a child table carrying a **stable, locale-independent
`value`**, because `MicroclimateEndpoints.SubmitResponseAsync` currently validates and stores an
answer as the option's *display text* — which becomes locale-dependent the moment options are
bilingual, fragmenting every count, chart and export with no error and reconciling row counts.

The consequence for this ETL: `question_responses.response_value` must be loaded as the stable
value, not as legacy option text. Loading it before the options migration exists writes
locale-ambiguous text into the column, and the backfill that would repair it is only unambiguous
*while no bilingual options exist* — i.e. that window closes behind the loader.

**So whichever sub-issue owns `Response`/`QuestionResponse` must be sequenced after #195's options
migration.** The other 24 A–E collections remain independent. This is the one place where #195
changes #154's shape rather than just its per-field mapping, and it is easy to miss because
`Response` is not in the schema-blocked set.

**Corrected count.** Where this document says *"26 mappable · 1 excluded · 1 decision-blocked ·
4 schema-blocked"*, read:

> **21 straightforwardly mappable · 5 mappable with a recorded language attribution ·
> 1 excluded · 1 decision-blocked · 4 schema-blocked.**

The 32 total and the set of schema-blocked collections are unchanged; what changes is that five
collections previously counted as clean carry an undecided attribution that must be settled — and
reported — rather than defaulted silently inside the loader.

---

# Addendum — 2026-08-15 — resolutions folded in, scaffold landed, census corrected

Written against origin/main `1219dc6`. Three things happened since the 2026-08-04 addendum,
and each is folded into the body above *in place* (marked RESOLVED / correction) rather than
only appended here — a stale table with a correct appendix is how the last reader got burned.

## 1. #191, #192, #193 and #195 all closed on 2026-08-06

The outcomes are recorded inline on findings 3–5 and on the 2026-08-04 addendum header. The
worked `User` mapping table is corrected against the current entity classes; two of its rows
had gone factually wrong (`CompanyId` is now nullable; the `Demographics` column no longer
exists — it is the `UserDemographic` child table), and its `NodoId` row was wrong all along
(#151 dropped that column; the nodo is derived, never stored).

## 2. The census is 35 registered models, not 32

The body's "all 32 legacy collections" counted model *files*. `QuestionPool.ts` registers
**three further models** beyond `QuestionPool` itself, all storage for the adaptive-question
engine: `QuestionEffectiveness`, `QuestionCombination`, `QuestionGeneration` (default
collection names `questioneffectivenesses`, `questioncombinations`, `questiongenerations`).
Whether production holds any such documents is a dump question, but the census cannot answer
it for collections it does not list. All three sit under **#113**'s decision with
`QuestionPool`. Collection names throughout are Mongoose `pluralize()` defaults — no legacy
model passes an explicit `collection` option and nothing overrides the pluralizer; each name
was computed with the legacy repo's own installed pluralizer, not by hand.

## 3. The tool scaffold exists — `tools/ClimateProject.DataMigration`

What the body calls "a new standalone console project" is now scaffolded, with its own
solution (`tools/ClimateProject.DataMigration.slnx`) so it never joins `ClimateProject.slnx`
— the production Dockerfile (line 13) and CI both restore that file, and a cutover tool's
dependencies have no business in the shipped restore graph.

- **The migration namespace is fixed:** `MIGRATION_NAMESPACE = 1ad51692-845e-4f16-ac97-c8f692842472`.
  Recorded here per this document's own "record the namespace UUID and never change it"
  rule; `MigrationIds.MigrationNamespace` pins it in code and a test pins the derivation
  against vectors computed with an independent RFC 4122 v5 implementation (Python's
  `uuid.uuid5`).
- The v5 construction is `DeterministicNotificationId.Create` — the implementation #101
  landed, already proven against the RFC test vector — referenced, not reimplemented.
- All 35 collections have typed readers (`LegacyCollections.All`): stub documents carrying
  only `_id` plus a `[BsonExtraElements]` catch-all, so a field the stub does not declare is
  captured and visible rather than silently dropped. Field-level typing is sub-issue work.
- A Mongo Testcontainer harness proves the idempotency and resumability *shape* — reading
  twice derives identical keys; a run killed mid-collection restarted naively lands in the
  same state as an uninterrupted run — against a dictionary standing in for the Postgres
  upsert sink. The real loader is still unwritten.
- **Running the tool throws `NotImplementedException`** pointing at
  `docs/migration/sub-issues.md`. Deliberate: a migration tool that exits 0 without
  migrating would be read as "the data moved" during a rehearsal.

## 4. Decomposition superseded

The [Proposed decomposition](#proposed-decomposition) table above (A–G by collection group)
is superseded by the concern-based split in
[docs/migration/sub-issues.md](../../migration/sub-issues.md) — readers, mapping, load
order, idempotency, reconciliation, identity backfill, staging dry-run — drafted as
issue-ready text. The dependency reasoning above (G alongside B, `Response` after the
options mapping, F behind #58/#113) survives inside those drafts.
