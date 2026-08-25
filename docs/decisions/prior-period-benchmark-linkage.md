# Decision: prior-period benchmark linkage is explicit; matching only ever suggests

Taken 2026-08-25 for #89 ("Populate `resultado_anio_anterior_pct` — prior-year benchmark
linkage"), whose first acceptance criterion is that the linkage mechanism be decided and
written down. This is that.

## The question

`Benchmark.PriorPeriodBenchmarkId` has existed since the benchmarks tables were added, and
nothing has ever populated it in a way that survives. #89 offers two mechanisms:

> explicit admin selection, or automatic matching on (company, category, period-1).
> Automatic is friendlier and riskier — a wrong automatic match produces a confidently wrong
> comparison, which is worse than a blank

## The decision

**A prior period is established by a person. Matching produces a shortlist and never a
link.**

Three routes, one rule between them:

| Route | What it does |
| --- | --- |
| `PUT /admin/benchmarks/{id}/prior-period` | The only thing that writes a link. Takes a status and, for `linked`, the id. |
| `GET /admin/benchmarks/{id}/prior-period/candidates` | Suggests. Writes nothing. |
| `POST /admin/benchmarks/prior-period/backfill` | Reports by default; with `?apply=true`, links **only** where there is exactly one candidate. |

### Why not automatic

The decisive fact is that **a benchmark has no period**. There is no year column, no period
start, no measurement date — only `created_at`, which records when somebody typed the row in.
The benchmarks page already works around this: its trend table labels each period with the
benchmark's *name* rather than a date, because a date would have to be invented.

"Period − 1" therefore cannot be computed. The closest available proxy is "the most recently
created earlier benchmark in the same company and category", and that proxy breaks in a
completely ordinary way: enter 2024's figures late — after 2025's are already in — and the
proxy makes 2024 the prior period of 2026. The resulting comparison is not obviously wrong to
a reader. It is a plausible number in a column labelled *year-over-year*, and nothing on the
screen tells them it spans two years, or none.

An empty column is a question a user can ask someone about. A wrong number is one they act
on.

### What the matching rule is, where it is used

`BenchmarkPriorPeriod.CandidatesQuery` — same `CompanyId` (company-to-company,
global-to-global), same `Category`, same `Type`, `IsActive`, and `CreatedAt` strictly
earlier. Ordered newest first.

It backs the candidates route, and the backfill uses it under a much narrower condition:
exactly one candidate, i.e. the case where there is nothing to choose between.

### The same rule guards explicit links

Choosing by hand is not the same as choosing freely. `PUT .../prior-period` refuses a target
that is:

- **another company's, or global when the subject is not** (and vice versa) — a
  cross-tenant link would read another tenant's movement out of this tenant's detail
  response, and a company-to-global link relabels an industry comparison as a
  year-over-year one;
- **a different category or type** — those say what the benchmark measures, and
  "engagement 2026 against absenteeism 2025" is not a prior period of anything;
- **anything that closes a loop**, including a self-link. Nothing refused this before: the
  browser carried a visited set in `followPriorPeriodChain` precisely because `A→B→A` was
  creatable and would otherwise hang the page.

`POST /admin/benchmarks` applies the identical checks to a link supplied at create time. It
previously checked only that the id existed, so the whole rule could be walked round by
choosing the other door.

## The third state, and why it needed a column

`prior_period_benchmark_id IS NULL` was carrying two unrelated claims:

- **there is no prior period** — a first-year company, a first measurement. An answer.
- **nobody has linked one yet** — a fact about our data entry, not about the company.

The benchmarks page printed one sentence over both. #89's third acceptance criterion is that
they render distinctly, which is impossible while the only thing stored is an absence. So
`benchmarks.prior_period_status` holds one of `unlinked` (the default, and what every
pre-existing row takes), `linked`, or `none`.

The status and the pointer are one fact written twice, so
`ck_benchmarks_prior_period_status` makes them unable to disagree:

```sql
prior_period_status IN ('unlinked', 'linked', 'none')
AND ((prior_period_status = 'linked') = (prior_period_benchmark_id IS NOT NULL))
```

In the database rather than in a handler, because the handlers are what it guards against —
#90 adds bulk and import paths, and a bulk writer that sets an id and forgets the status is
exactly the shape of thing that leaves a page saying "not linked yet" over a real comparison.

There is a fourth state on screen and it is not stored: `linked` where the reader may not
read the linked row. `LoadPriorPeriodAsync` omits the comparison rather than handing over
another tenant's numbers, and the panel says so instead of falling back to "not linked",
which would be untrue.

## Backfill — what replaced the #154 plan

#89 says to populate existing benchmarks "during #154". **That plan no longer exists.** #154
and the whole Mongo→Postgres ETL were deleted (`docs/decisions/no-data-migration.md`): the
legacy data was mock, there is no customer history to carry, and the new platform starts
empty. So there is no import to populate anything during.

What is left needing a link is what this product created itself, in two groups:

1. **Rows that already carry a pointer.** The migration sets their status to `linked` in the
   same transaction that adds the column — it has to, or the check constraint aborts the
   migration on any database holding a linked benchmark. No inference: a row with a pointer
   *is* linked.
2. **Everything else.** Reachable only from inside the product, so the backfill lives inside
   the product, as an endpoint. It considers only `unlinked` rows — a declared `none` is
   somebody's answer and is never overwritten — links only the unambiguous, reports the
   ambiguous and the candidate-less without touching them, and is a dry run unless
   `?apply=true` is sent. A backfill whose default is to write is one that gets run once to
   see what it would do.

A CompanyAdmin's run is scoped to their own company and cannot reach the global benchmarks
they can read; those are SuperAdmin-only to write, and a bulk path is the shape that reopens
that hole.

## What this does not do

**`resultado_anio_anterior_pct` still reads null in the tracking module,** and this change
does not alter that. It is emitted by `GET /api/internal/hallazgos`
(`TrackingInternalEndpoints.ListHallazgosAsync`), which is an unconditional stub returning an
empty list — #385 tracks it, and replacing it is #51's work, not this issue's. What #89
removes is the reason the field could never be anything *but* null: there was no linkage to
resolve from, and no way to create one. There now is, the year-over-year arithmetic is
computed once in `BenchmarkPriorPeriod.BuildChanges` rather than in each consumer, and
`/hallazgos` calls into it when it becomes real.

Report documents do not carry benchmark comparisons yet either; that is an explicit
`ReportGeneration` TODO under #88, whose own note says to reuse the benchmark endpoints'
source rather than re-derive. `BuildChanges` is that source.
