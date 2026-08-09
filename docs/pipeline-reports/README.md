# Pipeline reports

Per-task implementation records written by the domain pipeline runs. One directory per
plan; the directory name is the plan's filename in `docs/superpowers/plans/` without the
`.md`, so a plan and its reports are trivially paired.

These were moved here from eight dot-prefixed directories in the repo root (#171). The
reasoning, the old-path mapping and the `.gitignore` rules that keep the root clean are in
[`docs/decisions/pipeline-report-directories.md`](../decisions/pipeline-report-directories.md).

| Reports | Plan |
| --- | --- |
| [`2026-07-31-action-plans-core/`](2026-07-31-action-plans-core/) | [`2026-07-31-action-plans-core.md`](../superpowers/plans/2026-07-31-action-plans-core.md) |
| [`2026-07-31-microclimates-core/`](2026-07-31-microclimates-core/) | [`2026-07-31-microclimates-core.md`](../superpowers/plans/2026-07-31-microclimates-core.md) |
| [`2026-07-31-org-structure-slice2-users-invitations/`](2026-07-31-org-structure-slice2-users-invitations/) | [`2026-07-31-org-structure-slice2-users-invitations.md`](../superpowers/plans/2026-07-31-org-structure-slice2-users-invitations.md) |
| [`2026-07-31-org-structure-slice3-settings-demographics/`](2026-07-31-org-structure-slice3-settings-demographics/) | [`2026-07-31-org-structure-slice3-settings-demographics.md`](../superpowers/plans/2026-07-31-org-structure-slice3-settings-demographics.md) |
| [`2026-08-01-reports-analytics/`](2026-08-01-reports-analytics/) | [`2026-08-01-reports-analytics.md`](../superpowers/plans/2026-08-01-reports-analytics.md) |
| [`2026-08-01-tracking-integration-api/`](2026-08-01-tracking-integration-api/) | [`2026-08-01-tracking-integration-api.md`](../superpowers/plans/2026-08-01-tracking-integration-api.md) |
| [`2026-08-01-tracking-integration-api-review-2/`](2026-08-01-tracking-integration-api-review-2/) | same plan, second independent-review round |
| [`2026-08-01-tracking-service-fixes/`](2026-08-01-tracking-service-fixes/) | [`2026-08-01-tracking-service-fixes.md`](../superpowers/plans/2026-08-01-tracking-service-fixes.md) |

## Adding a run

A pipeline that writes `.<domain>-reports/` at the repo root produces **ignored** output —
that is deliberate. To keep it, plain `mv` the directory to `docs/pipeline-reports/<plan-slug>/`
and `git add` it — **not** `git mv`, which fails with `fatal: source directory is empty`
because the ignore rule above means git is not tracking the source
and add a row above. `web/src/test/repoHygiene.test.ts` fails the build if such a directory
is committed at the root instead.
