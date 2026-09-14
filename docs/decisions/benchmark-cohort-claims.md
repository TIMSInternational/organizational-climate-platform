# A benchmark is not "your sector group", and the screens stop saying it is

**Ruled 2026-09-14. Owner: Federico.** The copy half is settled and shipped. Real
sector matching is **open** and scoped at the end of this file.

Puntos de Referencia called `Manufactura · 500–1000 personas` Grupo Meridiano's
«grupo del sector». Meridiano is **Servicios**. At the same time the super administrator's
Analítica said that same reference *is not compared with this company*. Both statements were
about one benchmark, they contradicted each other, and **both were false**.

## What is actually true, measured

**Benchmark selection is by ownership alone. It has never looked at a sector.**

```csharp
// src/ClimateProject.Api/Endpoints/BenchmarkEndpoints.cs:95
=> benchmarks.Where(b => b.CompanyId == null || b.CompanyId == companyId);
```

A company sees its own benchmarks plus every **global** one (`CompanyId == null`). Meridiano
sees a Manufactura reference because that reference is global, not because anything matched it
to Meridiano. `ReportShareRefutationTests.cs:564` already records this rule as "own OR global".

**The structured fields do exist — on both sides — and nothing joins them.** This corrects the
premise the ruling was first written on, which said references carry no industry or size:

| | |
|---|---|
| `Benchmark.Industry`, `.CompanySize`, `.Region` | `src/ClimateProject.Domain/Entities/Benchmark.cs:16-18`, and `BenchmarkEndpoints.cs:201` writes `Industry` on create |
| `Company.Industry`, `.Size` | `src/ClimateProject.Domain/Entities/Company.cs:8-9` |
| Any code comparing the two | **none** — `grep -rn 'Industry' --include='*.cs' src` reaches the question bank, company CRUD and the entities, and no benchmark-to-company match |

The list query does not even project them — `BenchmarkEndpoints.cs:142` selects
`Id, NameEn, NameEs, Type, Category, CompanyId, IsActive, QualityScore, PriorPeriodStatus` —
which is why the web's `BenchmarkRow` has no industry field and why the sector appears only
inside a free-text **name** like `Manufactura · 500–1000 personas`.

## The ruling

**Until the product actually matches on sector, no screen may claim that it does.** Five
strings changed, values only, in both catalogues:

| Key | Was | Is |
|---|---|---|
| `benchmarks.description` | "frente a **su grupo del sector**" | "frente a los **grupos de referencia disponibles para ella**" |
| `benchmarks.noCohortDescription` | "una referencia **para este sector y tamaño**" | "una referencia **activa**" |
| `benchmarks.next.privacyNote` | "El **grupo del sector** nunca identifica…" | "El **grupo de referencia** nunca identifica…" |
| `benchmarks.next.noAccessDescription` | "Comparar la empresa con **su sector**" | "Comparar la empresa con **un grupo de referencia**" |
| `superadmin.next.analytics.refs.emptyGlobalOneCompared` | "**No se compara con esta empresa** ({profile}), así que no se muestra aquí" | "Esta vista lee solo las referencias propias… — **toda empresa se compara contra una global, incluida esta** ({profile})" |

The last one is the Analítica contradiction, and it is worth naming why it was wrong rather
than merely different. Its sibling `emptyGlobalOne` already stated the true reason — *this view
reads only the company's own benchmarks* — because `useSuperAnalyticsModel`'s `own` is an exact
`companyId` match and therefore excludes globals. The `…Compared` variant invented a second,
false reason: that the global is not compared with this company. It is; every tenant reads it.

`benchmarks.next.typeIndustry` ("Sector") is **unchanged and correct**: it labels the
benchmark's own *type*, which is a real field, and claims nothing about whose sector it is.

## What this deliberately does not do

It does not add sector matching, and it does not hide the global reference. A company with no
peer group of its own is better served by a clearly-labelled general reference than by an empty
screen — the objection was never that the number is shown, only that it was described as
something it is not.

## Open: real sector matching

**Cheaper than it was first priced.** The original framing called this a schema change; it is
not, because both sides already carry the fields. What is missing is the join:

1. Project `Industry` and `CompanySize` in `BenchmarkEndpoints.cs:142` and carry them onto
   `BenchmarkRow`.
2. Read the caller's `Company.Industry` / `.Size` and either filter to matching references, or
   keep showing all and **label** each as matching or general.
3. Restore the stronger copy for the matching case only.

Labelling is likely better than filtering: filtering a small tenant down to nothing recreates
the empty screen this file just argued against. **When this is built, the five strings above are
the ones to revisit** — that is the whole reason they are listed with their old wording.
