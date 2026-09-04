# Gotchas — things that cost real time here

Each entry is something that was learned the expensive way. The rule for adding one: it must
have actually bitten, and it must say what the *symptom* looked like, because the symptom is
what a future reader will be searching for.

`CLAUDE.md` carries the subset an agent needs before touching anything. This file is the full
index, for people.

---

## The environment lies about the code

**An untracked `web/.env.local` makes tests fail that CI says pass.** Two tests asserted the
developer's environment was *unset*: one compared a URL against the literal string
`'undefined/shared/reports/…'` (because `${undefined}` stringifies to `"undefined"`), and one
built its expected navigation with a hardcoded `{ trackingEnabled: false }` while the component
rendered from the ambient env. CI sets neither variable, so both sides agreed and the tests were
green forever.

*Symptom:* a test fails only on your machine, and the failure looks like a product defect —
"no rail Tab stop links to /action-plans" reads exactly like an accessibility bug. It was not;
with tracking enabled `/action-plans` is deliberately replaced by `/tracking/planes`.

*Rule:* run the suite **both ways** before believing either. Derive expectations from the same
`import.meta.env` the code reads.

**A missing local migration looks like a 500.** The share endpoints returned 500 on localhost
because the local database was two migrations behind and `report_shares` did not exist. Run
`dotnet ef database update` before concluding anything from a local API failure.

## The test runner

**`dotnet test` on a solution prints its summary per project.** `Test Run Successful.` /
`Total tests:` / `Passed:`, once per project. The one-line `Passed!  - Failed: 0…` form only
appears on a single-project run — so grepping `^Passed!` on a solution run finds nothing and
looks like a failure.

**Only one .NET suite may run on this machine at a time.** Concurrent Testcontainers suites
collapse into hundreds of false `ObjectDisposedException` failures that read as a real defect.
Take a lock (`mkdir /tmp/climate-dotnet-suite.lock`).

**Never rebuild while a `--no-build` suite is running.** It swaps the assemblies underneath the
runner; the result is meaningless. A 20-minute run was thrown away learning this.

**`ClimateProject.slnx` does not contain the tracking tests.** They are a separate solution.
Running the first and calling it "the full suite" misses 164 tests.

**A mutation must compile.** To prove a test has teeth, break the implementation and watch the
test fail — but if the mutation does not build, the runner reuses the last good assembly and
reports a pass you did not earn. Warnings are errors here; watch for
`error CS0162: Unreachable code detected`.

## The web suite has no layout engine

happy-dom does not lay anything out. A component can be mispositioned, overlap another, or
collapse to zero height with every assertion green. `npm run shot -- <route> <out.png> --theme
light|dark` renders the real screen — **then look at the PNG.** A file on disk is not evidence.

This has caught, among others: a form with no visible grouping, full-width submit buttons, and
an entire set of description fields that the code carried and sent but never rendered.

**`index.css` styles every bare `<button>`** as a carded control in `@layer base`, and an
inline `outline` silently kills the global focus ring. Use the primitives in
`web/src/components/ui`.

**`utilityExistence.test.ts` catches invented Tailwind tokens.** `text-fg-danger` compiles to
nothing — there is no danger colour in `theme.css`. The house pattern for a form error is
`Alert variant="destructive"`.

## Database and deploys

**Migrations need the session pooler: port 5432, `postgres.<project-ref>`.** Never 6543 —
transaction mode breaks the advisory lock EF takes. Never `db.<ref>.supabase.co` — IPv6-only,
and CI runners are IPv4. Both guards are in `deploy-prod.yml`.

**App Runner needs an amd64 image.** Building on an arm64 Mac and pushing produces a service
that never starts.

**Vercel Deployment Protection defaults on**, which makes a preview URL return an
authentication wall to any automated check rather than the page.

**A deploy workflow is not a check.** The tracking Docker build was broken on `main` for weeks
while CI stayed green, because only a deploy job ever builds that image.

**GitHub's concurrency group cancels superseded CI runs.** Merge three PRs quickly and the
first two runs show `cancelled`, not `failure` — and the last *successful* run on `main` can be
older than your merges. Read the conclusion, not the absence of red.

## Data shapes that bite

**A list projection that strips fields will destroy them on save.** `QuestionLibraryItem` omits
options and tags; `UpdateItemAsync` does `RemoveRange` and re-adds whatever the request carried.
A PUT built from a list row silently deletes every tag on the row it was only meant to retitle.
Read the detail endpoint first — the interface comment says so.

**Passing `companyId` to a list endpoint can hide the global rows.** Several endpoints answer
`CompanyId == companyId` when it is supplied, which *excludes* rows owned by nobody. For an
authoring screen that is the difference between "your library" and "an empty library".

**Seed through the endpoints the UI calls, never with SQL.** A row written by `INSERT` can hold
a shape the application cannot produce, and every screen built on it is then verified against a
fiction.

## Process

**An unrelated CI failure is a measurement.** A red job on a PR that touched nothing near it
turned out to be a real race that 500s the client's tracking module. "Flaky, not mine" was the
cheap read and it was wrong.

**Before believing a fix, run the broken code the same number of times.** A flaky test passed
5/5 on the broken code once; a green run on the fix proved nothing. Where the bug is a race,
find or write a *deterministic* test of the same underlying state.

**A clean merge is not a working merge.** Thirteen branches merged with zero conflicts and the
union still failed twelve tests: one lane tightened the password policy, another added a fixture
using a password it now refused. Merge the set into a throwaway worktree and run the gates on
the union — **including the docs lanes**, because prose encodes assumptions no compiler reads.

**Every issue body is a hypothesis.** Several issues here were described wrongly, one was
already fully built, and a `blocked` label survived the removal of its blocker. Grep the symbol
before sizing the work.

**Counting migrations with `grep -v Snapshot` is off by one.** The obvious filter for
"migration files, excluding the model snapshot" is
`ls Migrations/*.cs | grep -v Designer | grep -v Snapshot`. It also deletes
`AddDemographicFieldsAndSnapshot**s**Tables.cs`, a real migration. The count is **56**, not 55,
and the wrong number survived into published documentation before a database disagreed with it.
Anchor the filter: `grep -v '\.Designer\.cs$' | grep -v 'ModelSnapshot\.cs$'`.

**`xargs -a` does not exist on macOS.** BSD xargs has no `-a`; the command fails and, if you
redirected stderr, silently does nothing. Use `< file`.
