# #154 sub-issue breakdown — MongoDB → Postgres ETL

Issue-ready drafts, one per section, to be filed as sub-issues of #154. Written 2026-08-15
against origin/main `1219dc6`, after the scaffold landed in `tools/ClimateProject.DataMigration`
and the design doc was amended
([2026-08-03-mongo-to-postgres-etl-design.md](../superpowers/specs/2026-08-03-mongo-to-postgres-etl-design.md)).
This concern-based split supersedes the collection-group split (A–G) proposed in the design
doc's body; the dependency reasoning there survives inside these drafts.

Shared context every issue can link: the design doc above, the scaffold
(`tools/ClimateProject.DataMigration.slnx` — deliberately NOT in `ClimateProject.slnx`, see
the csproj comment), and the fixed migration namespace
`1ad51692-845e-4f16-ac97-c8f692842472` (recorded in the doc's 2026-08-15 addendum; never
change it).

Suggested filing order = dependency order: A → B → C → D → E can start with B (the design
doc warns a reconciliation harness written last "tends to be written to agree with whatever
the ETL did") → F → G.

---

## A — Extraction: readers, census, row counts

**Proposed title:** `#154A ETL extraction: production census, row counts, streaming reads`

The scaffold has typed readers for all 35 legacy collections (32 model files + the three
extra models `QuestionPool.ts` registers — see the design doc's 2026-08-15 addendum), each
reading `_id` plus a `[BsonExtraElements]` catch-all in ascending-`_id` order. This issue
turns them into the real extraction layer and answers the questions only production data
can answer.

Scope:

- Run the census against a production dump (or read-only replica): list the collections
  that actually exist, diff against `LegacyCollections.All` in both directions, and record
  exact per-collection row counts. An unexpected collection or a non-empty
  `libraryquestions` is a finding, not a footnote.
- Row counts decide `Response`'s handling: batched streaming is already the reader shape,
  but batch size, cursor timeout and memory ceiling need real numbers.
- Confirm every document's `_id` is an `ObjectId` (the readers deserialize `_id` as
  `ObjectId` and fail loudly otherwise — a string `_id` anywhere is a design-level finding,
  because the deterministic-id scheme keys on the hex form).
- Connection handling: read-only credentials, and note the design doc's warning that the
  legacy `MONGODB_URI` was readable during the malware exposure window (#70) — rotate
  before use.

Acceptance criteria:

- [ ] Census report committed: every collection present in production, its row count, and
      the diff against the 35 expected names — including "expected but absent"
- [ ] `LibraryQuestion`'s row count taken (its dead-code exclusion assumes 0)
- [ ] The three `QuestionPool.ts` sub-collections' row counts taken (decides how much #113
      actually gates)
- [ ] Readers proven against the dump end-to-end (every collection enumerable to completion
      without materialising it)

Depends on: production dump access (+ #70 credential rotation). Blocks: B, G.

---

## B — Mapping: per-collection field mapping and normalisation rules

**Proposed title:** `#154B ETL mapping: legacy fields → current entities, with named normalisation rules`

Type the stub documents field-by-field and map them to the current entities. The design
doc's worked `User` example (as corrected 2026-08-15) is the method: one table per
collection, every legacy field either mapped, deliberately dropped with a reason, or routed
to the data-quality report.

Scope highlights (the traps already known):

- `User`: `CompanyId` NULL for super-admins (#191); the six notification preferences
  verbatim, absent fields left at DDL defaults so opt-outs are never reset (#192);
  `demographics` fan-out to `UserDemographic` with every key resolved against the company's
  `DemographicField` — unresolved keys/values → report (#193). Same fan-out for
  `UserInvitation.demographics`. `password_hash` was `select: false` in Mongoose — the
  readers see raw BSON so it arrives, but assert a sane non-null rate anyway.
- Language attribution (#195): `Survey`, `SurveyTemplate`, `SurveyVersion`, `Microclimate`,
  `MicroclimateTemplate` carry one monolingual string per content field; attribute by
  `Company.language` into `_en`/`_es`, set the row's `Language` to that single language
  (never `both`), and record every attribution per company in the report.
- Question options → `QuestionOption` rows with stable `Value`; answers map to the stable
  value, not display text, in the same slice that maps responses.
- `NotificationTemplate` personalization-rule conditions through
  `NotificationConditionParser.TryParse`; failures → report.
- Every normalisation is a named, tested rule enumerated in the report — never an inline
  silent fix (per #152's precedent).

Out of scope until upstream lands: `QuestionBank`/`QuestionCategory`/`QuestionLibrary`
(#58) and `QuestionPool` + its three sub-collections (#113). File the residual slice when
those close.

Acceptance criteria:

- [ ] Every non-question collection's mapping implemented and unit-tested against fixture
      documents, including at least one document per collection that does NOT match the
      nominal schema (anything left in `Extra` at load time is asserted to be reported)
- [ ] Attribution and normalisation rules enumerated in the data-quality report by name
- [ ] The corrected `User` mapping table from the design doc realised in code 1:1

Depends on: A. Blocks: C. #58/#113 gate only the question-collection residual.

---

## C — Load order: dependency-ordered writes and reference resolution

**Proposed title:** `#154C ETL load order: FK-satisfying write order, two-pass self-references, reference classification`

Implement the design doc's load order (Company → Department → User → … → AuditLog), derived
from the target schema's FK constraints. Self-referential columns
(`Department.ParentDepartmentId`, `User.ManagerId`) load in a second `UPDATE` pass — cheap
because ids are deterministic, and cycle-proof.

- Resolve every legacy string reference in a classification pass first: resolved / dangling
  / malformed (`MigrationIds.For(string, string)` already refuses malformed hex by
  contract). Dangling and malformed go to the data-quality report and load as NULL where
  the column allows it; a non-nullable FK with an unresolvable reference is a reported skip,
  never an abort.
- Connect only to the Supabase **direct** connection (port 5432), never the pooler —
  enforce it, don't document it (same guard EF migrations have).
- Recompute `Department` `level`/`path` from `ParentDepartmentId` and assert against the
  legacy `hierarchy` values as an integrity check (they are derived, not migrated).

Acceptance criteria:

- [ ] Full load order encoded and integration-tested against Postgres (Testcontainer) with
      fixture data covering every FK edge, both self-references, and at least one dangling
      + one malformed reference per referencing collection
- [ ] Pooler connection string refused at startup
- [ ] Skips always carry a reason that reaches the report

Depends on: B. Blocks: D.

---

## D — Idempotency and resumability, proven against Postgres

**Proposed title:** `#154D ETL idempotency: deterministic-key upserts, interrupted-run proof`

The scaffold proves the *shape* (same keys on re-read; naive restart converges) against an
in-memory sink. This issue makes it real: every write an upsert on the v5-derived primary
key, against actual Postgres.

- Decide and document upsert semantics: `INSERT … ON CONFLICT (id) DO UPDATE` (last run
  wins, required if a re-run must pick up source-side fixes) vs `DO NOTHING` — and what
  that means for columns the app initialises itself (`User.SecurityStamp` must never be
  overwritten on re-run; a re-keyed stamp ends live sessions).
- CLI flags from the design: `--dry-run`, `--collections=<list>`, `--resume`,
  `--report-path`. `--resume` is allowed to be a no-op alias for "run again" — that is the
  point of deterministic ids — but must say so.
- The interrupted-run proof, for real: kill the loader mid-collection (not between
  collections), restart, assert row counts and content equal an uninterrupted run's.

Acceptance criteria:

- [ ] Running the full load twice produces byte-identical target state and zero new rows
      (asserted, not eyeballed)
- [ ] Kill-mid-collection + restart converges to the uninterrupted state
- [ ] `SecurityStamp` (and any other app-initialised column) survives a re-run unchanged
- [ ] The `NotImplementedException` guard in `MigrationRunner` is deleted in the same PR
      that makes running it real

Depends on: C. Blocks: G.

---

## E — Reconciliation harness and data-quality report

**Proposed title:** `#154E ETL reconciliation: counts with skip-accounting, deterministic spot-checks, FK integrity, the report`

The design doc's three layers, built alongside B — not after D — because "a reconciliation
harness written after the fact tends to be written to agree with whatever the ETL did."

- Per-collection counts: source documents = rows written + skips, with skip reasons summing
  exactly to the difference. A count that reconciles only because skips are uncounted is
  the named trap.
- Content spot-checks: N documents per collection sampled deterministically by `_id` order
  (the readers already enumerate ascending), always including newest and oldest by
  `created_at`, every mapped field compared.
- Post-load referential integrity: every FK resolves; dangling/malformed tallies match the
  classification pass from C.
- The data-quality report is a reviewable deliverable (one file per run at
  `--report-path`): every document not migrated cleanly with collection, legacy `_id`,
  field, reason; every attribution; every normalisation rule that fired, with counts.

Acceptance criteria:

- [ ] Harness fails a run where a skip is uncounted, a sampled field mismatches, or an FK
      dangles (each proven by mutation: break the loader deliberately, watch the harness
      catch it)
- [ ] Report format committed with a worked example from fixture data
- [ ] Spot-check sampling proven identical across two runs (dry run and real run must check
      the same documents)

Depends on: A (starts with B, hardens through C/D). Blocks: G.

---

## F — Identity backfill for tracking continuity (#155)

**Proposed title:** `#154F ETL identity backfill: raw legacy ids into PersonaExternalId / LegacyExternalId`

Deterministic GUIDs do not replace #155's requirement — `services/tracking-api` consumers
(`NodoExternalId`, `LiderExternalId`, `UsuarioExternalId`) read raw legacy id strings and
are not being re-keyed. Populate `User.PersonaExternalId` and `Department.LegacyExternalId`
with the raw legacy `_id` hex during load.

- `TrackingIdentifiers` already prefers these columns and falls back to `Id.ToString()` —
  verify the migrated values flow through `/api/internal/personas` and `/api/internal/nodos`
  unchanged.
- Super-admins have `CompanyId = NULL` since #191; `TrackingIdentifiers.NodoIdClaimForUser`
  already handles that (null claim, admin-role short-circuit) — cover it in the test rather
  than assuming it.

Acceptance criteria:

- [ ] Every migrated `User`/`Department` row carries its raw legacy `_id`
- [ ] A tracking-api integration check proves persona/nodo ids are byte-identical to what
      the legacy system emitted for the same people
- [ ] Idempotent under re-run (D's upsert semantics apply to these columns too)

Depends on: C (loads with the same passes). Blocks: G.

---

## G — Dry run against staging, and the cutover rehearsal

**Proposed title:** `#154G ETL dry run: staging rehearsal against a production dump`

The full pipeline against a restored production dump, into a staging Postgres, ending in a
report a human signs off — the acceptance run for everything above.

- Take the dump read-only, after rotating the exposed legacy credential (#70); restore into
  scratch infrastructure, never run extraction against live production during rehearsal.
- Run the `Company.language` distribution query the design doc demands **before** trusting
  attribution: `Company.language` defaults to `"en"`, so Spanish content under never-set
  company language would be mislabelled corpus-wide with reconciling row counts. If the
  distribution looks implausible, attribution needs a human decision per company before the
  real run.
- Time the run (informs the cutover window), review the data-quality report line by line,
  and file whatever it surfaces as issues on the mapping (B) rather than patching inline.
- Two consecutive dry runs must reconcile identically (determinism end-to-end, per D).

Acceptance criteria:

- [ ] Staging database populated from a real dump with the reconciliation harness green
- [ ] `Company.language` distribution recorded and attribution signed off
- [ ] Data-quality report reviewed, with every finding either accepted or filed
- [ ] Measured wall-clock time and a written cutover checklist (including the
      question-collection residual's status against #58/#113)

Depends on: A–F, dump access, #70. Blocks: the cutover itself (#156–#162 territory).
