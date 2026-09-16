# Pickup prompt — organizational climate platform

Paste everything below the line into a fresh Claude Code session in this repo.

---

Read MEMORY.md and start with project_state_2026_09_14.md (verified 14 September 09:56 CDT), then the
2026-09-10 evening note it supersedes for the per-lane detail and the full rulings list. Verify before
trusting — every brief here has had at least one wrong claim. Read CLAUDE.md before touching anything.
Production is off limits except unauthenticated GET /version and /health, and CloudWatch Logs filtered to
a literal.

## Where we are

Six redesign PRs merged on 10–11 September: #469 results, #470 Panel de Control + survey list + Clima en
el tiempo, #471 the super administrator's six screens, #472 seven admin authoring/analytics screens,
#473 Informes + sharing + Puntos de Referencia, #474 Planes de Acción + tracking. `main` = `55154406`.

Two things are stuck, and both matter more than the next merge:

1. **The weekly agent limit** (it reset 16 Sep 15:00 CDT per the message) killed two v2 agents on 11 Sep:
   the leaders lane's round-2 fix and the INTEGRATION lane. So there is **no integration PR and no
   26-artboard coverage table**, and #482 is missing a fix round. No agents are running now.
2. **Production web is stuck on #472's build.** Vercel refused the production deploys of #473 and #474
   ("Deployment rate limited") and never retries: production only moves on the next push to main or a
   manual redeploy. Read the Vercel status on each merge commit before calling anything live.

Eight lane PRs are open and mergeable. #475, #476 and #479 are already judged (screens match their
artboards, no product claim refuted); #477, #478, #480, #481, #482 still carry defects from their last
review.

Verify first:
  date; git fetch -q origin; git log --oneline -1 origin/main; git worktree list | grep -c locked
  gh pr list --state open --json number,headRefName,isDraft,mergeable,headRefOid --jq '.[]|"\(.number) \(.isDraft) \(.headRefOid[0:8]) \(.headRefName)"'
  gh pr checks 475; gh pr checks 476; gh pr checks 479
  lsof -nP -iTCP:5173 -sTCP:LISTEN; curl -s http://127.0.0.1:5080/version; curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5091/health
  ls ~/Desktop/climate-redesign/work-2026-09-10/scripts

## Finish list, in order

1. Merge the three judged PRs, one at a time, each: `gh pr ready <n>` then `gh pr merge <n> --merge` as
   SEPARATE commands, then `git pull --ff-only`, then read the Vercel status on the merge commit.
   - #475 (`6a4b8d8a`) — main is already merged into it by hand.
   - #476 (`54dd3d77`) — run the four web gates on main+#476 locally first; neither PR's CI saw the other.
   - #479 (`f12d41f0`) — shoot its six screens with its own fixture and clock-probe its tests first.
2. For #477, #478, #480, #481, #482: judge each by its shots against its artboards, its CI and its
   refuted claims (not the defect count), merge main in where it lags, and merge. #482 is missing a fix
   round — decide whether to merge it as is or run one more.
3. Relaunch what the weekly limit killed and never started, keeping ≤4 agents and copying the script
   first: v2's integration lane (resume `wf_6a895008-7a3` with `redesign-all-v2-resume.js`), then the
   role builds leader-supervisor, employee and public (`redesign-roles.js` with `args.lanes`).
4. Rerun the Playwright sweep (`<backup>/scripts/sweep.mjs`) and report the count of redesigned
   role×route renders; the baseline was 8 of 118 on 10 Sep at 15:10.
5. Phase 2 backend lanes (`scratchpad/ui-wiring-2026-09-10.js`), then one `deploy-prod.yml` dispatch —
   no `src/` change has merged since `d30fbed0`, so the production API is unchanged.
6. Hand Federico the rulings list (the state note's "Follow-ups and rulings" section): the app-wide mean
   3,65 vs 3,67 and the benchmark comparison are the two that change what the product claims.

## Non-negotiables

Build → adversarially refute → fix, up to three rounds. A mutation must compile. Run the project's own
commands. The full suite or nothing, one .NET suite at a time under the lock. Seed through endpoints,
never SQL. State the measurement, not the inference. Privacy floor of 5 at read time; never verbatim open
text. Never remove a worktree before its work is verified on origin. Keep ≤4 agents running.

Per-PR, before merging: shoot with the lane's OWN fixture (a "no fixture" line means the instrument is
broken), clock-probe its changed tests at 16 Sep / 1 Oct / 1 Dec, and remember that a naive union of two
conflicting test blocks nests them — rebuild the file from main's version plus the lane's own block.
