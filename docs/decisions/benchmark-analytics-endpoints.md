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

| Component | Weight | Satisfied by |
| --- | --- | --- |
| `metrics` | 0.30 | Up to three distinct metrics. A benchmark is a profile, not a reading. |
| `sample-size` | 0.25 | Each metric's `sampleSize` ≥ 30 — the conventional floor for a reportable mean. |
| `distribution` | 0.15 | Each metric carrying a `percentile`, so the number has a position and not only a centre. |
| `attribution` | 0.20 | `industry`, `companySize`, `region` — an "industry benchmark" with no industry is comparable to nothing. |
| `unit-consistency` | 0.10 | No metric name recorded in two different units. |

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

---

## What is deliberately not covered by a test

- **Inactive benchmarks are excluded from a sector aggregate.** It is the right behaviour —
  deactivating a benchmark is an administrator saying it is no longer in use, and leaving it
  in the sector mean keeps it in use — but there is no route today that deactivates a
  benchmark, so no producer can build the fixture. Asserting it would mean hand-writing a row
  the product cannot write, which is the failure mode the #89 suite explains at length. It is
  documented here instead, and stays untested until a deactivate route exists.
- **The comparison and import size caps** (10 and 200). They are refusals at the door against
  an unbounded query and an unbounded transaction, not behaviour anybody depends on.
