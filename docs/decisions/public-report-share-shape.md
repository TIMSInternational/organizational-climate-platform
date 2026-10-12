# Decision: `Comparison` and `Scope` stay withheld from public report share links

**Status: DECIDED 2026-09-05 by Federico Tafur. Both sections remain withheld.**
Recorded against `main` at `6f8e1296`.

This ruling already existed in the code, as a comment. It did not exist as a decision anybody
had signed, which meant the next reader could find the *reasoning* for a privacy boundary but
not the *authority* for it — and a boundary nobody signed is a boundary the next implementer
feels entitled to move.

## What was asked

`PublicReportProjection` carries a tripwire: every stored section of a report must be named in
`StoredSectionsRuledOn`, so a section added later cannot reach an anonymous share link merely
because nobody thought about it. Two sections hit that tripwire when they were built:

- **`Comparison`** (#452) — period-over-period analysis across the two most recent closed waves.
- **`Scope`** (#453) — the filter model: what a report was told to include.

Both were ruled **withheld** by the implementer, together, and flagged for the owner.

## The decision

**Both stay withheld.** `GET /shared/reports/{token}` continues to carry neither.

Both sections **are** delivered today, to the people entitled to them: they are in the
authorized report's stored document and in the PDF and CSV an administrator downloads. Only the
anonymous link is without them.

## Why, in the owner's words as well as the implementer's

`PublicReportProjection` is an **allowlist that fails closed**, and it is that way because of a
specific incident rather than a general preference: `ReportBenchmarkComparison.CompanyId` — a
tenant GUID — once reached a payload served to the whole internet. The remarks at
`src/ClimateProject.Application/Reports/PublicReportDocument.cs:33-61` record it.

The implementer's reasoning, which this decision ratifies:

> A delta is the one figure in this document that states a RELATIONSHIP between two waves rather
> than a reading of one, and a share URL is forwardable to anyone. Deciding that a government
> client's wave-over-wave movement may be read by whoever holds a link is a privacy boundary,
> and this codebase's boundaries are the client's owner's to set, not a default an implementer
> picks while wiring a section up.

`Scope` is very likely harmless — it states how an administrator configured their document, not
a climate reading. It is ruled together with `Comparison` anyway, so one conversation settles
both and neither becomes a precedent for the other.

## What reversing would take, if it is ever revisited

Deliberately three steps, so it cannot happen by accident:

1. Declare a `PublicReportComparison` on `PublicReportDocument`.
2. Project it in `ToPublic`.
3. Rule on **each of its fields** by name in `ShapeRulings`.

And one more that is not a code step: re-check the floor of 5 against every comparison cell. A
delta between two waves can be computed from two suppressed populations without either
suppression being violated on its own — that is the shape of leak this repository has paid for
before, and it is the reason the reversal is not a one-line change.

## Decision

```
Comparison in public share links:  WITHHELD
Scope in public share links:       WITHHELD
Decided by: Federico Tafur
Date: 2026-09-05
```

## 2026-10-12 — a withheld group is counted, never named, on every surface

**Status: applied on branch `polish-and-privacy`, for review.** Measured before the change:
`/surveys/{id}/statistics`, `/analytics`, the report PDF and CSV, and the public share link each
named a withheld department or demographic group beside a count that recovers its size — directly
(`SuppressedRespondentCount`, when it is the only group withheld) or by one subtraction
(`completed − Σ disclosed − unsegmented`, on the public page, which withheld the headcount but
published the other three). Only the survey CSV export (`SurveyExport`) refused, by not naming
the group.

The CSV's rule is now everyone's: `SurveyResultsPrivacy.WithoutWithheldSegments` on the two
endpoints, `ReportSurveySections` for every report surface (with a render-time filter for
documents stored before it), and `PublicReportProjection` additionally withholds
`UnsegmentedRespondentCount`, so the one subtraction left to a link holder yields
`withheld + unsegmented` — a remainder `SurveyAggregation.WithholdComplement` already keeps at 0
or ≥ 5 — attributed to no named group. A stored document whose remainder is under the floor
anyway publishes no rows for that breakdown (`PublicReportProjection.Disclosable`).

Withholding the count instead of the name was considered and rejected: the count is recoverable
by subtraction from numbers every surface must publish to reconcile. The cost is real and
visible: the results page and the shared report no longer draw a hatched row per withheld group;
they say how many were withheld. Report sections with no department breakdown (a survey under
the floor) now carry `null` withheld counters instead of `0`.
