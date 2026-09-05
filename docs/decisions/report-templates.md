# Report templates: deferred, not dropped

**Status:** DECIDED — deferred. **Date:** 2026-09-05. **Owner:** Federico Tafur.
**Supersedes:** the third clause of #88's `ReportGeneration.cs` TODO.

## The decision

**`report_templates` is not built.** `Report.TemplateId` stays a free `varchar(100)` with no
table behind it, accepted and echoed and read by nothing.

The other two clauses of that TODO are done: period-over-period comparison shipped, and the
filter model shipped — so a report **can** now be told what to include. Templates are a
different thing: they are about *saving a configuration for reuse*, not about applying one.

## Why deferred

1. **Nobody has asked for it.** #88 lists `reports/templates` among the legacy surfaces being
   replaced, and that is the whole of the requirement. No PRD line, no UAT step and no client
   promise in `docs/requirements/` names saved report shapes. `CLAUDE.md`'s rule is that new
   scope needs a reason that survives procurement; "the legacy app had a route" is not one.
2. **It is the only part of #88 that needs a migration.** The filter model landed in the
   `filters` jsonb column, which already existed. A template table is a new table, a new FK
   and a schema change — four business days from a go-live deadline, against a production
   database whose first restorable backup is a week old.
3. **The value it adds is small while the filter is cheap.** A filter is four fields on the
   create request. Re-typing them is a worse experience than picking a saved template and a
   far better one than a table nobody has specified the ownership rules for — global versus
   company-owned is exactly the ruling that is still outstanding for the question library, and
   `CompanyId` immutability makes it irreversible there too.

## What would trigger building it

Any one of these, and none has happened:

- A client asks for saved report shapes, or PROCOMER's own reporting cadence turns out to need
  the same filter re-entered on a schedule.
- More than a handful of recurring reports exist and their filters drift apart by re-typing.
- A second consumer of `Report.TemplateId` appears — today it is written by
  `ReportEndpoints.CreateAsync` and read by nothing, which is the state that makes it safe to
  leave alone.

## What was NOT decided

Whether to **drop** `reports.template_id` and `reports.config`. Both are unused columns;
removing them is a migration with no benefit today, and leaving them costs nothing but this
paragraph. Revisit when the next migration is being written for another reason.

## Two things about #88 worth recording while this is open

- **Its "known legacy bug" reference is dangling.** The body says of `reports/filters`: *"there
  is a known legacy bug here, see below"* — and nothing below describes it. It is in no legacy
  issue either: a search of `docs/legacy-issues/climate-project-issues.json` for a filter model
  or filter bug returns **zero** matches. The warning that was meant to shape this
  implementation could not be acted on, and that is stated here rather than left for the next
  reader to hunt for.
- **Two of its acceptance criteria are unverifiable.** *"Generated report matches legacy output
  for an identical response set"* and *"Verify output against the legacy generator"* both
  require a generator that is not in this repository — the legacy stack was retired and its
  issues archived. They cannot be ticked, and the correctness they were reaching for is instead
  carried by the aggregation being shared with the results screens rather than reimplemented.
