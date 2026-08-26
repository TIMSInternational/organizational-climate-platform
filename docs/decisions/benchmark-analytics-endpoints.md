# Benchmark analytics endpoints — what was ported, what was dropped, and why

**Issue:** #90 — *Remaining benchmark endpoints: compare, trends, industry, import, validate.*
**Depends on:** #89 (prior-period linkage), whose `BenchmarkPriorPeriod` this builds on.
**Status:** implemented.

---

## The thing that has to be said first

#90 says "read each legacy route before porting". **That could not be done literally, and
nothing below should be read as though it was.**

The legacy application lived in `TIMSInternational/climate-project`, which has been retired.
Its source is not in this repository and not in this repository's history — `git log --all`
over `*api/benchmarks*` finds nothing, and the only surviving trace is the issue archive in
`docs/legacy-issues/`, which names the routes and does not describe them. There is also no
legacy database to look at: the MongoDB ETL was deleted outright and the reason is in
`docs/decisions/no-data-migration.md`.

So the ten route names in the issue are the entire specification that survives. Each decision
below is therefore taken against **what this product needs**, not against what the old code
did, and each is written down here so the client can argue with it. Where a route was dropped,
the reason is a claim about this product, not a claim about the legacy code's behaviour — we
cannot make claims about behaviour we cannot read.

---

## The ten routes

| Legacy route | Decision | Where it lives now |
| --- | --- | --- |
| `benchmarks/compare` | **Ported** | `GET /admin/benchmarks/compare` |
| `benchmarks/trends` | **Ported** | `GET /admin/benchmarks/{id}/trends` |
| `benchmarks/industry` | **Ported** | `GET /admin/benchmarks/industry` |
| `benchmarks/categories` | **Ported** | `GET /admin/benchmarks/categories` |
| `benchmarks/import` | **Ported** | `POST /admin/benchmarks/import` |
| `benchmarks/validate` | **Ported** | `POST /admin/benchmarks/{id}/validate` |
| `benchmarks/bulk` | **Merged into `import`** | `POST /admin/benchmarks/import` |
| `benchmarks/similar` | **Merged into `industry`** | `GET /admin/benchmarks/industry?benchmarkId=…` |
| `benchmarks/analysis` | **Dropped** | — |
| `benchmarks/recommendations` | **Deferred to #67** | — |

---

## The two the client contract hangs on

The contract's acceptance criterion demands **both** year-on-year and sector benchmarking.
Those are two different routes and they fail in two different ways, so they are listed
together here:

- **Year-on-year** is `trends`. #89 gave a benchmark a prior period and a single-step
  comparison; the browser then walked the chain itself, one `GET` at a time
  (`followPriorPeriodChain`), and differenced it itself (`benchmarkAnalysis.buildTrend`).
  That works for a page and is unavailable to every other consumer — a report section, an
  export, the tracking module's `resultado_anio_anterior_pct` — each of which would have had
  to write the same subtraction again. `trends` is the chain endpoint #89 recorded as
  missing, and it walks the chain **server-side**, authorizing every hop.
- **Sector** is `industry`. It aggregates the benchmarks of an industry into a mean, median
  and range per metric, and — when given `benchmarkId` — says where that benchmark sits
  inside it: the gap against the mean, and the share of peers below it.

Both go through `BenchmarkPriorPeriod.BuildChanges` or the same grouping discipline for the
one rule they must never disagree about: **no number is derived across two different units.**
`BenchmarkMetric.Unit` is a free string, so the same metric can arrive as `percent` one period
and `fraction` the next, and 0.68 differenced against 70 reads as a 69-point collapse that did
not happen. `compare` and `trends` withhold the delta. `industry` cannot withhold a mean — a
mean has to be a mean *of* something — so `percent` and `fraction` are simply two rows.

---

## Merged, not dropped

### `bulk` → `import`

They are one act: create many benchmarks in one request. Two routes doing it would mean two
places to get the authorization rule right, and the authorization rule is the whole reason
#90 calls this path out. There is one route, and `validateOnly: true` covers the "check my
file first" half that a separate `bulk` endpoint would otherwise have justified.

**The rule, stated plainly:** `companyId` is per **item**, and a null one creates a *global*
benchmark that every tenant reads. So `CanWriteBenchmark` runs **per item**, before any
validation and before any write. A bulk route that authorizes the *caller* once and then
trusts the payload reopens exactly the hole #84 closed on create, through a second door, in a
request that looks like data entry. The integration suite asserts it with the offending item
placed *second*, behind a legitimate one, because a check that runs per item and a check that
runs on the first item are indistinguishable until something is hidden behind a valid row.

The import is also **all-or-nothing**, in one transaction. A partial import leaves the
caller's file and the database disagreeing about what happened, and the obvious remedy —
re-running the file — then duplicates everything that did land.

**That last sentence is an argument for all-or-nothing and it is also an admission. Read
"Known gaps" below before relying on this route.**

### `similar` → `industry?benchmarkId=…`

"Benchmarks similar to this one" is "the sector this one belongs to", which is `industry` with
the subject's own attributes as the filter. #90 itself says some legacy routes are thin
wrappers and to drop those rather than port them; this is one, so supplying `benchmarkId`
defaults `industry` and `category` from the subject.

Two things are deliberately **not** defaulted from the subject:

- **Company size and region** narrow a sector rather than define one. A caller who wants
  "manufacturers of our size in Central America" has to say so, because silently applying
  three filters is how a sector of forty becomes a sector of one without anybody noticing.
- **Type** matters more. `type` separates an *internal* benchmark from an *industry* one. An
  internal benchmark's sector is made of `industry`-type rows, so defaulting type from the
  subject would compare a company only against other companies' internal numbers and never
  against the industry — which is the one comparison the client asked for.

---

## Dropped

### `analysis`

Dropped. Whatever it returned, the questions a benchmark analysis answers are now each
answered by a route that owns them: how does this compare to others (`compare`), how has it
moved (`trends`), how does it sit in its sector (`industry`), and is it trustworthy
(`validate`). A fourth route that re-derived those would be a second implementation of every
one of them, and the second implementation is the one that drifts. If a caller genuinely needs
all four in one round trip, that is a composition route to be specified deliberately — with a
client asking for it — rather than a name carried across from a codebase nobody can read.

### `recommendations`

Not built here. #90 says it "may depend on AI — if so, split that part out behind #67", and a
recommendation that is not derived from something is a hard-coded opinion. #67 owns the AI
work. Nothing in this change stubs it, because a stub that returns an empty list is
indistinguishable on a page from a working feature that found nothing.

---

## The quality rule, made explicit

#90 asks `validate` to "enforce the quality score already on the entity" and to "make the
scoring rule explicit". Two things were true before this change:

- `benchmarks.quality_score` and `benchmarks.validation_status` had been columns since the
  table was created, and nothing ever wrote anything but `0` and `"pending"` into them.
- The benchmarks page nevertheless charts the average score per category
  (`averageQualityByCategory`), so it was drawing a chart of a constant.

The rule now lives in `BenchmarkQuality` — pure, no database, no clock, no caller — and is the
single thing both `validate` and `import` call, so an imported row is scored on the way in
rather than sitting at `pending`/0 waiting for somebody to notice.

Five components, each scored 0..1 and weighted:

| Component | Weight | Satisfied by | Counted over |
| --- | --- | --- | --- |
| `metrics` | 0.30 | Up to three **distinct** metrics. A benchmark is a profile, not a reading. | distinct names |
| `sample-size` | 0.25 | Each **reading**'s `sampleSize` ≥ 30 — the conventional floor for a reportable mean. | stored readings |
| `distribution` | 0.15 | Each **reading** carrying a `percentile`, so the number has a position and not only a centre. | stored readings |
| `attribution` | 0.20 | `industry`, `companySize`, `region` — an "industry benchmark" with no industry is comparable to nothing. | the three fields |
| `unit-consistency` | 0.10 | No metric name recorded in two different units. | distinct names |

**The fourth column is load-bearing, and it was wrong in the code before it was written
down here.** A benchmark stores one row per *reading*, and one metric is routinely stored
several times — the ordinary shape is a single measure reported at p25, p50 and p75. The
`metrics` component counted those three readings as three metrics, so a benchmark measuring
one thing filled a component worth 30% of the score and came out `verified` where the rule as
published makes it `needs-review`. That is a badge a client sees, moved by which of two
readings of one sentence the handler took.

The other two per-reading components are per reading on purpose, and the fix is not "count
distinct everywhere": every stored reading has to state its own sample and its own percentile.
A benchmark that gives p50 a sample size and leaves p25 and p75 without one has two thirds of
its readings unsourced, and scoring those per distinct name would let the one answered reading
cover for the two that were not.

Total × 100, rounded to one decimal. **≥ 70 → `verified`, ≥ 40 → `needs-review`, otherwise
`failed`.**

Two rules inside it are worth stating separately, because both are places where a lenient
reading would produce a badge nobody earned:

- **A metric with no stated sample size scores zero for it.** An unstated sample is not a
  large one. Scoring it as if it were is how a benchmark built from six responses ends up
  labelled `verified`.
- **A benchmark with no metrics scores 0 and fails outright.** Attribution and unit
  consistency are both vacuously perfect on an empty metric list, which would otherwise carry
  a fully described benchmark that measures nothing to 70 — `verified`. A benchmark that
  measures nothing is not a low-quality benchmark; it is not a benchmark.

The validate response returns every component with its weight, its raw score and the counts
behind it, so the total can be recomputed by hand from the payload. That is deliberate: the
client will argue with this rule, because it encodes a judgement rather than a fact, and an
argument about a number whose derivation nobody can see is unwinnable.

`validate` is a **write**, authorized as one. It moves two columns that every tenant reads on
a global benchmark and that two pages render, so validating a global benchmark is
SuperAdmin-only for the same reason creating one is.

`validation_status` also has a check constraint now (`ck_benchmarks_validation_status`), on the
same terms `prior_period_status` got one in #89. Until #90 nothing wrote anything but
`'pending'` into the column, so its vocabulary had never been tested by a second writer; #90
adds two. The constraint is built from `BenchmarkValidationStatuses.All` rather than a literal
list, so the constraint and the constants cannot drift apart.

---

## What these routes tell an unauthorized caller

Measured, not assumed. All four new routes that take a benchmark id — `compare`, `trends`,
`industry?benchmarkId=`, `validate` — answer **404 for an id that does not exist** and **403
for one belonging to another tenant.** That is the same pair the pre-existing
`GET /admin/benchmarks/{id}` has always answered, so none of them discloses anything a caller
could not already learn from the detail route.

Two notes, both narrower than they sound:

- **`validate` puts a *write* on that pair.** It is the first route where probing an id also
  attempts a state change. The change is refused by `CanWriteBenchmark` before anything is
  written, and the refusal is a 403 identical to the read routes', so the probe learns nothing
  new — but it is worth writing down that the surface is now a write surface.
- **The trend walk collapses the two**, answering `stopReason: "withheld"` for both a missing
  prior row and an unreadable one. An earlier comment justified this as "the oracle #89 closed
  on the detail route"; **that was not true and has been removed.** #89 collapsed unknown and
  foreign on `ValidateLinkTarget`, the write path, and never on `GetAsync`. The collapse here
  buys no protection the detail route does not already give away. It stays because
  `withheld` is one honest word for "the chain does not continue for you", and splitting it
  would put a claim about another tenant's data into a payload whose subject is this caller's
  benchmark.

---

## The sector is made of industry rows

`type` is **not** defaulted from the subject, for the reason above. It is defaulted to
`industry` when the caller names none, and that is a separate decision taken after the first
version of this route applied no type filter at all.

"No filter" turned out not to be the neutral option. A company's own internal benchmarks — a
target it set for itself, a division held up as the standard — sit in the same category and
the same industry as the rows it is measured against, and with no type filter they were
averaged into the sector mean. That is the outcome the paragraph above forbids, arrived at
through the other door: the company drags its own sector toward itself and the gap the
reading exists to show shrinks. Every fixture in the suite used `type: "industry"`, so nothing
could see it.

So the default is `industry`, the value is named in `BenchmarkTypes` rather than written as a
literal inside a query, and a caller who wants a different slice asks for it by name —
`?type=internal` still works and is tested. Note that `benchmarks.type` remains a free string
typed into an open text field: `BenchmarkTypes` records the convention, it does not enforce
it, and a benchmark created with a third type is simply not in any sector until somebody asks
for that type.

---

## The browser still has its own copy of the trend, and this change did not retire it

`trends` and `industry` **have no consumer.** `web/src/features/analytics/api/benchmarkAnalytics.ts`
is a typed client for both, and the only file that imports it is its own test.
`BenchmarksPage.tsx` still assembles the trend the way it did before this change: an effect
calling `followPriorPeriodChain` (`benchmarkAnalysis.ts`), which walks
`priorPeriodBenchmarkId` one `GET /admin/benchmarks/{id}` at a time, then `buildTrend` to
difference it.

So the duplication this document argues against in "The two the client contract hangs on" now
exists in the repository. **The two implementations already disagree**, in ways that are
visible on a page:

| | browser | server |
| --- | --- | --- |
| Chain cap | 12 periods (`followPriorPeriodChain`'s `maxPeriods`) | 32 (`BenchmarkPriorPeriod.MaxChainLength`) |
| Why the walk stopped | not reported — chain complete, cycle, cap and refused-read are all a bare `break` | `stopReason`: `none` / `unlinked` / `withheld` / `cap` / `cycle` |
| Round trips | one `GET` per period | one call |

The second row is the one that matters. A thirteen-period chain renders as a twelve-period
trend that looks complete, and a chain running into another tenant's row renders as a short
trend that also looks complete. `stopReason` exists precisely so those two cannot be confused
with a benchmark that genuinely has three periods behind it.

**What retiring the browser copy takes.** Deliberately not attempted in this change — it is
neither small nor confined:

- `BenchmarksPage.tsx`: replace the chain effect and its `chain` state with one
  `getBenchmarkTrend` call.
- `BenchmarkTrend.tsx` takes `chain: Benchmark[]` and derives everything itself. It would take
  `BenchmarkTrendResult` instead — a different shape, indexed against a parallel `periods`
  array rather than carrying each period's name on the point.
- `unitsDiffer`, which the component renders, has no field in `BenchmarkTrendPoint`. Either the
  DTO gains it or the component derives it by comparing adjacent points' units.
- `stopReason` needs somewhere to be said, and five i18n keys in both catalogues. Retiring the
  browser walk without rendering it swaps one silent truncation for another and gains nothing.
- `benchmarkAnalysis.test.ts` covers `buildTrend` and `followPriorPeriodChain` directly, and
  `BenchmarksPage.test.tsx` stubs the per-id `GET`s the walk makes. Both change shape.

That is five files and two test files, and the risk is concentrated in the one component on the
page that renders year-over-year — the reading the client contract names. It should be a slice
with its own verification, not a tail-end edit to this one.

---

## Known gaps

These are real, they are not fixed here, and each is written down so nothing in this document
reads as a safety claim it cannot support.

### Importing the same file twice imports it twice

**There is no idempotency.** Two identical `POST /admin/benchmarks/import` calls of a two-row
file produce four benchmarks. There is no idempotency key on the request, no natural key on
the row, and no unique index behind it — `benchmarks` has no uniqueness constraint of any kind
beyond its primary key.

This matters more than it first reads, because the all-or-nothing rule above is argued for
*from* this gap ("the obvious remedy — re-running the file — then duplicates everything that
did land") and then leaves re-running as the only available remedy. A caller whose import
fails halfway through the network rather than at validation cannot tell whether it landed, and
the way to find out is to look, not to retry.

What a fix needs, none of which is a small change:

- A decision about what makes two imported benchmarks *the same* one. `(name, company_id,
  category, type)` is the obvious candidate and it is wrong on its face — two periods of one
  benchmark can legitimately share all four, and #89's prior-period linkage exists precisely
  because they do.
- Or a caller-supplied idempotency key, which is a contract change: the client has to generate
  and store it, and the server has to keep the keys long enough to be useful.
- Either way a migration, an index, and a decision about what the second call should *answer* —
  the first result again, or a conflict.

**Until then**, the mitigations are `validateOnly: true` (check the file, see the scores, write
nothing) and the fact that the whole import is one transaction, so a failure leaves nothing
behind. Neither of those makes re-running safe. There is also no `MapDelete` on benchmarks, so
a duplicated import cannot be undone through the product.

### There is no way to delete a benchmark or a metric

Related, and the reason the finite-number guard in `MetricProblem` is written as strictly as it
is. Nothing in the product removes a benchmark row or a metric row. Every write path is
therefore one-way, and a bad row — a duplicate from a re-run import, a value somebody
mistyped — is permanent as far as an administrator is concerned. This is why validation
happens at the door rather than being left to the database or to a later cleanup: there is no
later cleanup.

### A subject with no industry has no sector to be placed in

`?benchmarkId=X` defaults `industry` from the subject. When the subject's own `industry` is
null there is nothing to default, no industry filter is applied, and the "sector" becomes every
readable industry benchmark in that category. The response echoes `filters.industry: null`, so
a careful consumer can see it, but nothing refuses the request and nothing labels the answer.
Filling in the benchmark's `industry` is the fix, and the quality rule already scores its
absence — an "industry benchmark" with no industry is comparable to nothing.

### No cap on `industry` or `categories`

`compare` caps at 10 ids and `import` at 200 items; the two read aggregates cap at nothing, and
this is deliberate rather than an oversight. A cap on an aggregate has only two shapes and both
are worse than the query: truncating means returning the mean of an arbitrary subset as though
it were the mean, and refusing means answering a legitimate sector with an error because it
grew. Both routes are admin-only and already scoped to one tenant's rows plus the global ones.
If a sector ever gets large enough to matter, the answer is to aggregate in the database rather
than to refuse.

---

## What is deliberately not covered by a test

- **The comparison and import size caps** (10 and 200). They are refusals at the door against
  an unbounded query and an unbounded transaction, not behaviour anybody depends on.

`Inactive benchmarks are excluded from a sector aggregate` used to be on this list, on the
grounds that no route deactivates a benchmark so no producer could build the fixture. That was
the right instinct applied to the wrong case, and it cost: the `IsActive` filter could be
deleted outright with the whole suite green. Leaving a real behaviour untested because the
*fixture* is awkward is different from asserting arithmetic over a payload no producer writes,
which is the failure the #89 suite warns about. `is_active` is a column the schema holds, is
indexed, and is written on every create; the test now sets it through the DbContext and says at
the point of use that it is doing so and why.
