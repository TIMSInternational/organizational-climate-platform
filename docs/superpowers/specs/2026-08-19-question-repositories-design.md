# Question repositories (#58) — design

**Verified against `d3b1fce` (main, 2026-08-19)** and the legacy checkout at
`../climate-project`, by reading the Mongoose models and counting their call sites. Nothing
here is derived from memory of either codebase.

This is the design #58 has been waiting on. It is the single largest unlock left on the
board: #110, #112, #114 and #115 are blocked on it, and #154's ETL has carried four
collections as unmappable since 2026-08-03 for the same reason.

---

## What actually exists in legacy

Five models, which is three attempts at one feature plus an AI layer. Call-site counts are
`grep -rl <Model> src/app/api/`:

| Model | Route files | What it is |
|---|---|---|
| `QuestionBank` | **15** | Flat repository behind the admin `/question-bank` page and the AI recommendation features |
| `QuestionLibrary` | **6** | Hierarchical repository behind the question picker in the survey and microclimate wizards |
| `QuestionCategory` | **3** | The hierarchy `QuestionLibrary` is filed under |
| `QuestionPool` (+ `QuestionAdaptation`, `QuestionEffectiveness`, `QuestionCombination`) | 3 | The AI question-adaptation engine — a different feature wearing a similar name |
| `LibraryQuestion` | **0** | **Dead.** No route, no page, no job references it |

15 + 6 + 3 = **24**, exactly the "24 routes total" #58 states. So the epic's scope is
precisely `QuestionBank` + `QuestionLibrary` + `QuestionCategory`, and it deliberately
excludes the other two.

### `LibraryQuestion` is dead code, and this design excludes it

It is the richest of the three question models — bilingual `text`, `emoji_options`,
`binary_comment_config`, `keywords`, `difficulty_level` — and nothing calls it. It reads as
an abandoned redesign of `QuestionLibrary`: same `category_id` reference, same purpose,
never wired up.

The ETL design doc already assumes its row count is zero; **#334's census must confirm
that** before this exclusion is final. If the count is non-zero, the rows are orphaned by
construction (no code ever read them) and the decision becomes "archive or discard", not
"migrate" — but that is a decision, and it needs the number first.

---

## Decision 1 — the two repositories stay separate

#58 states it outright: *"They do not overlap in purpose and must not be merged."* The code
agrees, and the reason is sharper than the issue puts it:

- **`QuestionBank` is a curation surface.** Its distinguishing fields are all about
  *choosing well across a corpus*: `metrics.usage_count`, `metrics.response_rate`,
  `metrics.insight_score`, `industry`, `company_size`, `is_ai_generated`, and variations
  via `parent_question_id`. Its category is a plain **string** with a `subcategory` string
  beside it. It has no hierarchy and needs none.
- **`QuestionLibrary` is an authoring surface.** Its distinguishing fields are all about
  *placing a question in a survey*: `category_id` into a real hierarchy, `dimension`,
  `reverse_coded` (which changes how the answer scores), and version chaining via
  `previous_version_id`.

Merging them would force one of two losses: the bank's cross-corpus metrics onto a tree
that has no use for them, or the library's hierarchy and scoring semantics onto a flat list.
**Two tables, kept apart, is the honest shape.**

---

## Decision 2 — instantiation is a COPY, never a reference

When an author picks a library question into a survey, the survey gets its **own**
`Question` row — a snapshot — not a foreign key to the library.

This is the load-bearing decision in the whole design, and it is not a performance
preference. `question_responses.response_value` stores the answer against the question as
it was asked. If a survey referenced a library row and someone later edited that row's
text, every stored answer in every closed survey using it would silently change meaning,
with no error and with row counts that reconcile exactly. That is the identical failure
mode #195 fixed for per-language option text, and the fix is the same: pin the value at the
moment it is used.

Provenance is kept with a nullable `SourceLibraryQuestionId` / `SourceQuestionBankItemId`
on `Question`, which is what lets `usage_count` be incremented and "where is this question
used" be answered — without making the survey's content depend on a mutable row.

---

## Decision 3 — options fan out to stable values, both repositories

Legacy stores options as `string[]` (`QuestionBank.options`) and as index-aligned
`options_en` / `options_es` pairs (`QuestionLibrary`). Both are the exact defect
`QuestionOption` already exists to fix, quoted from its own doc comment:

> Index-aligned `options_en`/`options_es` arrays cannot be constrained to the same length,
> so a one-element drift silently renumbers every respondent's answer.

So both repositories get an option **child table** mirroring `QuestionOption` — a stable,
locale-independent `Value` plus display-only `LabelEn`/`LabelEs`. A library question whose
options cannot be given stable values is a reported skip, not a silent import.

---

## Decision 4 — language attribution differs per repository (#195)

This is the trap that would otherwise be found during the ETL run:

- **`QuestionLibrary` is already bilingual** (`text_es` + `text_en`, both required). It maps
  straight onto `TextEn`/`TextEs` with `Language = both`. No attribution, no guessing.
- **`QuestionBank` is monolingual** (one `text` string). It needs the same
  `Company.language` attribution #195 applies to `Survey` and `Microclimate`: route into
  `_en`/`_es` by the owning company's language, set the row's `Language` to that single
  language — never `both` — and record every attribution per company in the data-quality
  report.
- **`QuestionCategory` is bilingual** (`name.en` + `name.es`, both required), like the
  library.

The `QuestionBank` rows with `company_id: null` are the hard case: a global question has no
company whose language could attribute it. **Proposal: attribute global bank items to the
platform fallback locale and report every one**, because the alternative — dropping them —
discards the shared corpus that makes a question bank worth having.

---

## Target schema

Five entities. Naming note: the legacy dead model is `LibraryQuestion` and the live one is
`QuestionLibrary`; to keep that from being a permanent tripwire, the target entities are
named `QuestionBankItem` and `QuestionLibraryItem` — symmetric, and neither collides.

### `QuestionCategory` (hierarchical, bilingual)

`Id`, `CompanyId` (**nullable — null is global**), `ParentCategoryId` (nullable, self-ref),
`NameEn`, `NameEs`, `DescriptionEn`, `DescriptionEs`, `Level`, `Path`, `Order`, `Icon`,
`Color`, `IsActive`, `CreatedByUserId`, `CreatedAt`, `UpdatedAt`.

`Level` and `Path` are **recomputed from `ParentCategoryId`**, never migrated, and asserted
against the legacy values as an integrity check — exactly the treatment `Department` already
gets in the ETL pipeline, and for the same reason: a stored path is a denormalisation that
can drift from the tree it describes.

`question_count` and `subcategory_count` are **dropped**. They are legacy denormalisations
maintained by an `updateCounts()` method; a `COUNT(*)` is correct by construction and cannot
go stale.

### `QuestionBankItem` (flat, curation-oriented)

`Id`, `CompanyId` (nullable — global), `TextEn`, `TextEs`, `Language`, `Type`, `Category`
(string), `Subcategory` (string), `ScaleMin`, `ScaleMax`, `ScaleLabelMinEn/Es`,
`ScaleLabelMaxEn/Es`, `Industry`, `CompanySize`, `UsageCount`, `ResponseRate`,
`InsightScore`, `LastUsedAt`, `IsActive`, `IsAiGenerated`, `Version`,
`ParentQuestionBankItemId` (nullable self-ref, the variation chain), `CreatedByUserId`,
`CreatedAt`, `UpdatedAt`.

Metrics are inlined rather than given a table: they are a fixed set of four scalars with
exactly one row per item, and a child table would buy nothing.

`+ QuestionBankItemOption(QuestionBankItemId, Order, Value, LabelEn, LabelEs)`.

### `QuestionLibraryItem` (hierarchical, authoring-oriented)

`Id`, `CompanyId` (nullable — global), `QuestionCategoryId`, `TextEn`, `TextEs`, `Language`,
`Type`, `ScaleMin`, `ScaleMax`, `ScaleLabelMinEn/Es`, `ScaleLabelMaxEn/Es`, `Dimension`,
`ReverseCoded`, `UsageCount`, `LastUsedAt`, `IsActive`, `Version`,
`PreviousVersionId` (nullable self-ref), `CreatedByUserId`, `LastModifiedByUserId`,
`CreatedAt`, `UpdatedAt`.

`+ QuestionLibraryItemOption(QuestionLibraryItemId, Order, Value, LabelEn, LabelEs)`.

**Tags** on both repositories become a child table
`QuestionBankItemTag` / `QuestionLibraryItemTag` `(ItemId, Tag)` rather than a Postgres
array, so the picker's tag filter is an indexed join rather than an array scan.

### One known, reported loss

`QuestionLibrary.scale.labels_en/labels_es` are `Map<number, string>` — a label for **every
scale point**. The target `Question` renders only min and max labels, so a library item that
carried per-point labels cannot be instantiated with them intact. Min and max migrate; the
intermediate points are a **named, reported loss** rather than a silent truncation. If
per-point labels are ever wanted, they are additive to both `Question` and this table.

---

## Multi-tenancy

`CompanyId == null` means global on all three tables, so the repo's standing rule applies
without exception: **global rows are readable by everyone in scope and writable by
`super_admin` only.** Read and write need separate checks, per `BenchmarkEndpoints.cs` — and
this is precisely the rule the seeding round found enforced on benchmarks (an industry
benchmark is 403 for a company_admin). The same tenant-leak shape #154 maps.

---

## What this unblocks, and what it does not

**Unblocked by this document:**

- **#112** `QuestionLibrary` and `QuestionCategory` endpoints
- **#110** `QuestionBank` endpoints (CRUD, categories, metrics, effectiveness, lifecycle)
- **#114** Question bank admin page
- **#115** Shared question-picker component — #58's second acceptance criterion, *"the
  shared question-picker component works in both wizards"*, is a **frontend** criterion:
  one `QuestionLibraryBrowser` mounted in both the survey and microclimate wizards, reading
  `QuestionLibraryItem`
- **#154's residual slice** — the four collections the ETL has held as unmappable now have a
  target, minus the dead `LibraryQuestion`

**Still blocked, deliberately:**

- **#111 / #113 / #119** — `QuestionPool` and the AI adaptation engine. A different feature:
  `QuestionAdaptation`, `QuestionEffectiveness` and `QuestionCombination` are an
  effectiveness-scoring and text-generation system, and pulling them into a repository
  design would repeat the mistake of conflating models that merely share a prefix. They
  need their own design, gated on the #67 AI-provider decision.

## Open questions for Federico

1. **Global `QuestionBank` items and language.** Attribute to the platform fallback locale
   and report (proposed), or hold them for a per-item human decision?
2. **Is the question bank's AI surface in scope at all?** `is_ai_generated` and
   `insight_score` are columns this design carries; the *features* that populate them are
   #111, which is gated on #67. Carrying the columns costs nothing and keeps the data; it
   just means two columns sit unused until then.
