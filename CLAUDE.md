# CLAUDE.md

A .NET 10 + React climate-survey platform for a Costa Rican institutional client. This file
holds only what an agent cannot derive from the tree in five minutes and would otherwise get
wrong. Every rule cites the file that is its source of truth — check the source, not this
summary, when the two disagree.

Nothing here records deploy state, branch heads or open-PR counts: those go stale in hours.
For where things stand, read `docs/runbooks/` and the repository's issues.

## The gates, and how long they take

| Gate | Command | Time |
|---|---|---|
| .NET build | `dotnet build ClimateProject.slnx --configuration Release` | ~10 s warm |
| **.NET suite** | `dotnet test ClimateProject.slnx --no-build --configuration Release` | **~18 min**, of which ~13 is Testcontainers Postgres (`.github/workflows/ci.yml:19-26`) |
| tracking service | same two against `services/tracking-api/ClimateTracking.slnx` | ~60 s — **a separate solution**, not covered by the line above (`ci.yml:43-54`) |
| web | `npm run typecheck`, `npm run build`, `npm test`, `npm run lint` in `web/` | 1–5 min each |

Those are exactly what CI runs (`ci.yml`); run the same commands, not variants of them.
`npx tsc --noEmit` is **not** `npm run typecheck` (which is `tsc -b`) and has reported clean
while CI failed.

**A `dotnet test` run takes longer than a foreground tool call allows.** Run it in the
background and read the log when it exits. Under `--verbosity normal` on the solution the
summary is `Test Run Successful.` / `Total tests:` / `Passed:` **per project** — the
`Passed!  - Failed: 0, …` one-line form only appears on a single-project run, so grepping for
`^Passed!` on a solution run finds nothing and looks like a failure.

**Only one .NET suite may run on this machine at a time.** Concurrent Testcontainers suites
collapse into hundreds of false `ObjectDisposedException` failures that read as a defect. Take
a lock (`mkdir /tmp/climate-dotnet-suite.lock`) around the run.

**Never rebuild while a `--no-build` suite is in flight.** It swaps the assemblies underneath
the runner and the result is meaningless — kill it, rebuild, re-run.

## Rules this repository has paid for

- **The full suite or nothing.** A filtered run is not the suite — by name *or* by project.
  Red CI has come from a unit test in a project that was not run.
- **A mutation must compile.** To show a test has teeth, break the implementation, confirm the
  test FAILS, restore, confirm it passes. A mutation that does not compile proves nothing: the
  runner reuses the last good assembly and reports a pass you did not earn. Watch for
  `error CS0162: Unreachable code detected` — warnings are errors here.
- **State the measurement, not the inference.** Every claim carries a file:line, a command with
  its output, or a test name with its result.
- **Every issue body and every comment is a hypothesis.** Several issues here were described
  wrongly and one was already fully built; comments in the code have claimed endpoints do not
  exist that do. Grep the symbol before believing the prose.
- **Close against criteria, not code.** Read the issue's acceptance criteria before saying done.
- **Before calling a failure pre-existing, check whether the environment differs** — a missing
  local migration and an untracked `web/.env.local` have each masqueraded as a code defect.

## Web

- **The lint budget is a hard ceiling**: `npm run lint` is `oxlint --max-warnings 10`
  (`web/package.json`). Adding warnings fails CI even when nothing else is wrong.
- **No user-facing English literals.** `web/src/i18n/noHardcodedStrings.test.ts` walks the
  TypeScript AST and is an absolute check, not a ratchet. Keys go in **both**
  `web/src/i18n/en.json` and `es.json`, additive, never reordered; `catalogues.test.ts` enforces
  exact key parity and `keysExist.test.ts` that every used key exists. Spanish must be Spanish.
- **The suite has no layout engine** (happy-dom). A component can be mispositioned or collapsed
  with every assertion green. `npm run shot -- <route> <out.png> --theme light|dark` renders the
  real screen — then **read the PNG**; a file on disk is not evidence (`web/docs/screenshots.md`).
- `index.css` styles every bare `<button>` as a carded control, and an inline `outline` kills the
  global focus ring. Use the primitives in `web/src/components/ui`.
- Authorized downloads must be `fetch` + `Blob`, never `<a href>`: an anchor sends cookies, not
  the bearer header (`web/src/features/surveys/api/surveyExport.ts`).

## Backend and data

- **No new dependencies without a reason that survives procurement.** The PDF writer and the CSV
  writers in `src/ClimateProject.Application/Exports/` are hand-rolled for that reason —
  `docs/decisions/pdf-rendering.md`. Prefer consuming them over adding a package.
- **The privacy floor is 5 respondents** and it is applied at read time. A suppressed segment
  must never yield a number anywhere — not in a screen, an export, a report or a public link.
  The classic leak is treating an absent count as `0`, which reads as "nobody answered".
- **Verbatim open-text response content is never returned.** Word frequencies only.
- **Migrations: session pooler, port 5432, `postgres.<project-ref>`.** Never 6543 (transaction
  mode breaks the advisory lock EF takes) and never `db.<ref>.supabase.co` (IPv6-only, and CI
  runners are IPv4). The reasoning and both guards are in `.github/workflows/deploy-prod.yml:196-223`.
- **Seed through the endpoints the UI calls, never with SQL** (`scripts/seed-local.mjs`,
  `scripts/seed-surveys.mjs`). A row written by `INSERT` can hold a shape the application cannot
  produce, and every screen built on it is then verified against a fiction.

## Where the knowledge lives

| | |
|---|---|
| `docs/runbooks/` | cutover, rollback, alerting, staging, UAT, question-library import |
| `docs/decisions/` | rulings, each with the reasoning and an owner; open ones say so |
| `docs/security/` | the rotation inventory and runbook, the exfiltration audit |
| `web/docs/` | screenshots, accessibility |
| `infra/aws/` | CloudFormation for the API, the probe and observability |

## Production is off limits

Do not log in to production, query its database, or call its authenticated endpoints.
Unauthenticated `GET /version` and `/health` are fine. AWS is read-only for an agent
(describe/list/get). The seeded production role accounts are for a dry run and must not be used
for anything a client will see (`docs/runbooks/uat-script.md` §8.4). Local development uses the
`climate_project` Postgres database and `@acme.test` accounts.
