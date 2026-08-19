# Decision: there is no data migration (#154 and the whole ETL, dropped)

Taken 2026-08-19 by Federico. Recorded here because this repository spent roughly a month
building a Mongo→Postgres ETL, and a future reader finding 51 deleted files and a closed P0
epic deserves the reason rather than an archaeology exercise.

## The decision

**The legacy MongoDB data is not migrated. It is abandoned.**

The legacy `climate-project` database was built by a previous development team and holds
mock data, not production records worth preserving. There is no customer data in it, so
there is nothing for a migration to carry. The new platform starts with an empty database
and is populated by real use.

## What was deleted

- `tools/ClimateProject.DataMigration` and its test project — the complete ETL: 26 collection
  groups mapped, 201 passing tests, deterministic v5 GUIDs, idempotent upserts,
  FK-ordered load, data-quality reporting, reconciliation layer 1.
- `docs/superpowers/specs/2026-08-03-mongo-to-postgres-etl-design.md` and
  `docs/migration/sub-issues.md`.
- The `etl-build-and-test` CI job.

**All of it remains in git history.** This is a deletion, not an erasure: if the decision
ever reverses, `git log -- tools/` restores a complete, tested tool. Nothing needs rewriting
from scratch.

## What was deliberately NOT deleted

- **`User.PersonaExternalId` and `Department.LegacyExternalId`.** These are not migration
  artefacts. `services/tracking-api` reads them through `TrackingIdentifiers` as external-id
  slots, and `AuthEndpoints` mints `sub` from `PersonaExternalId ?? Id`. They keep working
  and stay useful for any future external identity mapping; dropping them would need a
  migration and would break the tracking integration for no gain.
- **`services/tracking-api` itself.** It is part of the new stack, in this repository, not
  the legacy app. It is configured at deployment with `ProcomerCompanyId` pointing at a real
  company GUID — previously "the migrated company", now simply "the company". One config
  value, no code.

## What this changes about getting to production

Removing the migration removes most of the remaining critical path. The cutover was never
mainly a deployment problem; it was a *data* problem, and the data problem is now gone:

- Gate **A2** (ETL tool built, reconciliation harness included) — **void**.
- **#157** (full cutover dry run against staging) loses its reason to exist: the rehearsal
  was rehearsing the migration.
- The "index before ETL" sequencing in pre-flight C3 — **void**.
- Every issue whose acceptance criteria required a **production row count** from the dump
  (#197 matrix questions, #198 emoji_rating) becomes a straight product decision:
  implement, or drop with sign-off. No number is coming.
- **#153 / #155** (token value-compatibility, identity backfill) lose their premise. They
  existed because the tracking service's records were keyed to legacy Mongo `_id`s. With no
  migrated records, the tracking service is configured against new GUIDs from day one.

What remains between here and production is now ordinary product and operations work:
staging (#156), monitoring (#158), rollback rehearsal (#159), secret rotation (#70), email
configuration, and UAT (#161).

## The one thing to be sure of

This decision is only safe if the legacy database genuinely holds nothing anyone will ask
for later. That was Federico's call, made on direct knowledge of how the legacy data was
produced. If a stakeholder later asks "where did the old surveys go", the answer is that
they were mock data and were deliberately not carried over — and the tool to carry them is
one `git revert` away.
