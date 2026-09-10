# Rehearsal — walking the demo runbook as a script

`scripts/rehearse.mjs` walks `docs/runbooks/demo-script.md` against the **real local stack**
(API on 5080, web on 5173), one step at a time, one full-page PNG per step, and says PASS or
FAIL per step with a note that quotes what the screen said. It is the read-only sibling of
the two drivers beside it: `e2e.mjs` visits every route and records the wire, `flows.mjs`
role-plays the flows that *write* (build a survey, answer it, create a plan, share a report).
`screenshots.md` covers `npm run shot`, which photographs one route against fixtures with
no backend at all.

## Run it

```sh
cd web
node scripts/rehearse.mjs                       # every step, as Grupo Meridiano, into web/.rehearsal/
node scripts/rehearse.mjs --only 04             # one step, by a case-insensitive name prefix
node scripts/rehearse.mjs --theme dark --out .rehearsal-dark
node scripts/rehearse.mjs --employee carlos.mata   # the demo's unanswered respondent's dashboard — it clicks nothing
```

The stack must already be up (`demo-script.md`, "Where it runs"). Defaults are the demo
tenant's accounts (`ana.rojas`, `diego.solano`, `luis.mora`, `sofia.vargas` at
`meridiano.test`); `--domain`, `--password`, `--admin`, `--employee`, `--leader`,
`--supervisor` change them, `--api` and `--server` the origins.

Exit code: `0` when every step that ran passed, `1` on any failure, `2` when `--only`
matched no step — a typo must not read as a green rehearsal. An account that cannot sign in
fails its own step with the status (`login x@y: 401`) and the other steps still run.

## What it writes, and what it does not

**Nothing, by default — and that is enforced, not promised.** `grep -n "method:"
scripts/rehearse.mjs` shows one request with a method — the login `POST`, which writes
nothing — and every browser context aborts any request that is not a `GET`/`HEAD`/`OPTIONS`
and records it against the step as `blocked writes: …` (`allowRequest` in
`rehearse-harness.mjs`). The abort uses the code Chromium reports as
`net::ERR_BLOCKED_BY_CLIENT`, and the step's console filter (`isConsoleNoise`) knows that one
is the guard's own doing; a bare abort reads `net::ERR_FAILED`, the text of a dead API, and
the step would fail for what the guard did. That guard exists because the pages are not read-only on their
own: the invitation page POSTs an `opened` step the moment it mounts
(`MicroclimateInvitationPage.tsx`), and the wizard offers to DELETE a leftover draft. So
step 12 opens the share dialog and photographs it without pressing *Crear enlace*; step 09
photographs the draft offer without discarding it; step 14 opens the live microclimate's
respond link as the signed-in employee, *counts* the answer controls and clicks none — and
the `opened` POST it would have sent is listed in the note, blocked.

The one write is step **10b, answering a survey**, and it runs only when BOTH
`--answerer <local-part>` and `--answer-survey <survey id>` are given. Point it at a
duplicated copy of the open survey (runbook, "Resetting between rehearsals") and never at
the demo's unanswered respondent: a person answers once, and the seed has exactly one who
has not.

## Output

`web/.rehearsal/` (gitignored, like `.e2e/` and `.flows/`; a custom `--out` with the same
prefix is too). `NN-<step>.png` per step — a failed step's PNG is named `…-FAILED` — and
`results.json` with every step's name, account, status, note, console errors and the
`4xx`/`5xx` responses it saw. Console errors fail a step; failed responses are recorded in
the note and do not.

**Then read the PNGs.** A file on disk is not evidence; the picture is
(`screenshots.md`). The steps follow the runbook's numbering: `01 login` … `13 benchmarks`,
then `14` the live microclimate and its respond link, `15` the supervisor's dashboard.

## The part that is tested

`rehearse-harness.mjs` holds what can be checked without a browser, and
`rehearse-harness.test.mjs` pins it: the accessible names the script clicks by are
case-insensitive (the rehearsal's first two failures were its own `Iniciar sesión` and
`Vista previa` selectors against buttons rendered `Iniciar Sesión` and `Vista Previa`),
`--only` is a prefix and not a substring, and the exit code is non-zero for a failed or an
empty run. `flows-harness.mjs` / `flows-harness.test.mjs` do the same for `flows.mjs`: one
department and one plan by a fixed name, reused rather than recreated, every minted share
link revoked, and a survey that cannot be deleted closed and archived rather than left open.
