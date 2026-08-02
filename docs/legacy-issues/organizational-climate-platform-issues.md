# Archived issues: TIMSInternational/organizational-climate-platform

Frozen snapshot taken before the migration tracker was consolidated into
`organizational-climate-platform`. The original issues were deleted after this
archive was committed. Numbers below refer to the ORIGINAL repo numbering.

Total: 1 issues

---

## #5 — GitHub Actions billing block prevents all CI/CD runs

- **State:** OPEN
- **Labels:** -
- **Author:** tafurfede
- **Created:** 2026-07-31T01:12:56Z  **Closed:** -
- **Original URL:** https://github.com/TIMSInternational/organizational-climate-platform/issues/5

TIMSInternational's GitHub Actions billing is blocked account-wide — every workflow run fails within seconds with "recent account payments have failed or your spending limit needs to be increased." This means:
- No commit in this repo has ever had a passing CI run (all 9+ runs to date failed instantly on billing, not on test/build content).
- deploy-prod.yml (added in #59's deploy work) has never executed successfully — the currently-live production App Runner service was deployed by hand via local AWS CLI as a workaround, documented in infra/aws/README.md.
- Every future commit ships with no automated test gate until this is resolved.

Action needed: resolve the billing/spending-limit issue in the TIMSInternational GitHub organization's Billing & plans settings, then verify with `gh workflow run ci.yml --repo TIMSInternational/climate-project-api --ref main` (or any workflow_dispatch-capable workflow) that a run actually executes instead of failing in ~3s.

---

