# Migration retrospective

Written 2026-09-04, with the platform live and go-live pending. #167 asks for "what worked,
what did not", and names two things it wants covered: the pipeline-with-review pattern, and the
cost of unsupervised automation. Both are here, and both are less flattering than the shipped
system suggests.

## What the migration actually was

A legacy Next.js + MongoDB application was replaced by a .NET 10 + React + Postgres one. The
replacement is live and serving. **No data came across**: `docs/decisions/no-data-migration.md`
records that the legacy data was mock, and on 2026-08-19 the entire ETL — 51 files, a month of
work, a P0 epic and ten issues — was deleted.

That deletion is the single most valuable decision in the project's history, and it is worth
starting with because of what it cost to reach. A month of engineering went into migrating data
that nobody had checked was real. The question "is the source data worth moving?" was answerable
on day one by looking at it.

**The lesson is not "we wasted a month".** It is that the cheapest question was never asked,
because the work was framed as *how* to migrate rather than *whether*. Everything downstream —
the dry-run requirement, the reconciliation plan, the cutover freeze — was scaffolding around an
assumption.

## What worked

**Build → adversarially refute → fix.** Every substantial change went through a second pass whose
only job was to break the first. It caught things a review would not: a suppressed department's
open text reachable through a public share link, an audit that offered already-finished work as
unclaimed, a UAT step that told the tester to file a weak password as a security defect.

**Proving a test by breaking the code.** A mutation that compiles, fails the guarding test, and
is then reverted is the only evidence a test has teeth. Suites here have been green while
defending the wrong behaviour — four tests once asserted that a raw exception message appeared
on screen, making "show the user the stack trace" a guarantee the suite protected.

**Recording rulings as documents with a signature line.** `docs/decisions/` is why a reader can
tell a deliberate choice from an accident. The ones with `____` in them are honest about being
unresolved, which is more useful than a decision invented to close an issue.

**Measuring the union before merging a batch.** Thirteen branches merged with zero conflicts and
the union still failed twelve tests. Nothing but running the gates on the merged set would have
found it.

## What did not

**Unsupervised automation was expensive and unreliable.** Measured, not estimated:

- Three multi-agent waves died — twice on an account session limit (12 agents at 3 minutes,
  then 8 at 70), once because **the computer went to sleep mid-response**.
- One wave's refuter returned BLOCK and the agent meant to act on it died, so the verdict sat
  unread for a day while the PR looked finished.
- A cleared session did not stop a background workflow; it kept building and produced a
  byte-identical duplicate of an already-merged PR.
- Two parallel agents once wrote the same 215-line file and each believed it had authored it.
- Splitting one module across two parallel slices shipped 4,034 lines that did nothing, because
  neither slice owned the wiring and both wrote the same six files with incompatible APIs.

The pattern: **parallelism multiplied throughput and multiplied the ways a result could be
false**. The fix that stuck was to build the highest-value lane by hand and treat the wave as a
bonus — and to never trust a lane's own report of itself.

**Issue bodies were unreliable.** Of six "remaining" issues audited at one point, four were
described wrongly and one was already fully built. A `blocked` label outlived its blocker by
weeks; the blocker's own artifact was an unapproved draft, so *closing* it unblocked nothing
while making the tracker say otherwise.

**Documentation went stale faster than it was read.** Runbooks asserted "there is no maintenance
page" hours after one merged, "zero CloudWatch alarms" after three were deployed, and counts
that a same-day PR had changed. Every one was written accurately and became wrong without
anyone touching it.

**Tests passed for reasons unrelated to the code.** A date-picker test passed only while the
clock sat inside its fixture's month. A volume test "passed" in 0.07s having aggregated nothing.
Two tests asserted that a developer's environment variable was unset. None of these was caught
by review; all were caught by someone running the suite in a configuration nobody had tried.

## The pipeline-with-review pattern

#167 asks about it by name. What it was: work produced in a lane, then a separate adversarial
pass, then a human merge. What it is worth:

- **The review pass earns its cost.** Roughly 40% of first attempts had a real defect found by
  the refuter, and several were defects no test would have caught because they were about
  *intent* — the code did what it said, and what it said was wrong.
- **A dead reviewer must not read as approval.** The system once fell back to a first verdict
  when a re-check died, showing BLOCK for problems already fixed, and separately let a BLOCK go
  unread because the agent that would have acted on it died. Absence of a verdict has to be
  distinguishable from a passing one.
- **The human merge gate held.** Nothing reached production without a person choosing it. That
  is the reason none of the above became an incident.

## The number that matters most

**7,053 tests green, and zero of six proof gates passed.** No UAT has been run, no staging
exists, no rollback has been rehearsed, there is no restorable backup of production, the alarms
are written and undeployed, and no real user has ever used the system.

A codebase can be 98.6% complete by feature surface and 0% proven. Those are different axes and
the first does not imply the second. If this retrospective has one thing worth carrying to the
next project, it is that measuring the first and reporting it as readiness is the most
comfortable mistake available.
