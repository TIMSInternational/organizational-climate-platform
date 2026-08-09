# Pipeline reports are kept, under `docs/pipeline-reports/` — not gitignored away

Decided while resolving #171. The issue offered two options: move the eight per-domain
report directories under `docs/pipeline-reports/`, or gitignore them and keep them
locally only. This records which was taken and why, so the next pipeline run has an
unambiguous destination.

## What the directories were

Eight dot-prefixed directories sat in the repo root, one per domain pipeline run, holding
34 markdown files in total:

| Root directory | Files | Now at |
| --- | --- | --- |
| `.slice2-reports/` | 7 | `docs/pipeline-reports/2026-07-31-org-structure-slice2-users-invitations/` |
| `.slice3-reports/` | 5 | `docs/pipeline-reports/2026-07-31-org-structure-slice3-settings-demographics/` |
| `.action-plans-reports/` | 6 | `docs/pipeline-reports/2026-07-31-action-plans-core/` |
| `.microclimates-reports/` | 7 | `docs/pipeline-reports/2026-07-31-microclimates-core/` |
| `.reports-analytics-reports/` | 1 | `docs/pipeline-reports/2026-08-01-reports-analytics/` |
| `.tracking-integration-api-reports/` | 5 | `docs/pipeline-reports/2026-08-01-tracking-integration-api/` |
| `.tracking-integration-reports-v2/` | 1 | `docs/pipeline-reports/2026-08-01-tracking-integration-api-review-2/` |
| `.tracking-service-fixes-reports/` | 2 | `docs/pipeline-reports/2026-08-01-tracking-service-fixes/` |

## Decision

**Move, do not ignore.** Every file was already tracked, and the reports are the only
written record of *how* several domains were built — which steps ran, which tests were
added, which review findings were fixed and why. Ignoring them would have left the
committed copies to be deleted in a later cleanup and the local copies to disappear with
the first fresh clone. `.gitignore` still gains the pattern, but only to stop the **repo
root** being repopulated; it does not cover the new home.

The move used `git mv`, so `git log --follow` reaches the original commits.

## Why the names look like that

Each directory is named for the plan it reports on, so the name is identical to the plan's
filename in `docs/superpowers/plans/` minus the `.md`. That is where the dates come from —
they are the plan's date, not the day the reports happened to be committed, which is why
`.action-plans-reports/` and `.microclimates-reports/` (committed 2026-08-01) are filed
under `2026-07-31-`. Matching the plan filename exactly means a report directory and its
plan sort alike and neither has to link to the other to be findable.

`.tracking-integration-reports-v2/` is the exception with no plan of its own: it is a
second independent-review round against `2026-08-01-tracking-integration-api.md`, so it is
filed as `...-tracking-integration-api-review-2`.

## What stops the root filling up again

`.gitignore` now carries two root-anchored patterns:

```
/.*-reports/
/.*-reports-*/
```

The leading `/` anchors them to the top level, so `docs/pipeline-reports/` is untouched;
the second pattern catches rerun suffixes like the `-v2` above. `web/src/test/repoHygiene.test.ts`
asserts both halves — that no such directory is tracked at the root, and that the patterns
actually ignore one while leaving `docs/pipeline-reports/` alone. A `.gitignore` rule with
no test is indistinguishable from a typo'd one.

## Consequences

- A pipeline run that writes `.<domain>-reports/` at the root now produces ignored output.
  To keep a run's reports, `git mv` the directory into `docs/pipeline-reports/` under the
  plan's slug and commit it; the guard test will accept it there and reject it at the root.
- Nothing else in the repo referenced the old paths, so no links needed rewriting
  (verified by grep across all tracked files before the move).
