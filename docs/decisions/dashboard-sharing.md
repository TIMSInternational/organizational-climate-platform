# Decision needed: may a dashboard be shared on an anonymous link? (#134)

**Status: EXPORT SHIPPED. SHARING DEFERRED, and it needs Federico — it would be this
product's second anonymous public surface.**
Written 2026-09-05 against `main` at `6f8e1296`.

#134 has four acceptance criteria. Three are met by the export that ships with this record;
the fourth is not a coding task that ran out of time, it is a privacy boundary that is not an
implementer's to draw.

| # | Criterion | State |
|---|---|---|
| 1 | Export works, sharing shared infrastructure | **MET** — `GET /dashboard/{company,department}-admin/export?format=csv\|pdf`, rendered by `PdfDocument` and `CsvWriter`, the same writers the survey and report exports use |
| 2 | Links expire and can be revoked | **NOT MET — this document** |
| 3 | Suppression preserved in exports | **MET** — by construction; see below |
| 4 | Audit-logged | **MET** — `AuditSensitiveReadAttribute(AuditVerbs.Export)` on both routes, asserted in `DashboardEndpointsTests` |

## Criterion 3 — mostly by construction, and once by care

The export routes call `LoadCompanyAdminAsync` / `LoadDepartmentAdminAsync` — **the same
loaders the screens call**. There is no query in the export path, no floor, and no branch on a
respondent count. An export cannot reveal what the screen withholds if it never asks the
database anything the screen did not ask. That is the property `SurveyExportEndpoints` states
for surveys, and it is the reason the loader was extracted rather than the role checks copied.

`DashboardEndpointsTests` pins it from the other side too: every refusal the screen makes,
the export makes, asserted as *the two statuses agreeing* rather than as "the export returns
403" — which would still pass if the export refused everybody.

### The one place the export has to floor something itself

`CompanyAdminDashboard.Departments` carries **unfloored** completed-response counts, and that
is not a defect in the payload: the company screen applies the floor itself, in
`companyClimate.ts`'s `readDepartments`, and `ClimateMap` hatches every department below it
instead of drawing a number.

So "reuse the loader" is necessary and **not sufficient** here. An export that printed the
payload's department list verbatim would re-create the exact table that screen used to have and
deleted — its own comment says the table "printed `completedResponseCount` for every department
including the ones under the floor, which is exactly the figure the map's hatch exists to
withhold — the two could not both be right, and the table was the one that was wrong."

`DashboardExport.DepartmentSection` therefore applies `SurveyResultsPrivacy.MinimumSegmentRespondents`
and prints `Withheld` for a sub-floor department's participation, with the standard notice
explaining why. The department is still named and its member count still shown — both are
org-chart data the same administrator reads on `/admin/departments`, and it is the ruling
`ReportRenderer` already made for the identical table.

**The general lesson, worth carrying to any future export:** a payload built for a screen may
rely on that screen to suppress. "It goes through the same loader" proves the export cannot see
*more* than the screen; it does not prove the export *renders* as little.

The one disclosure-shaped judgement the export does make is how a withheld figure **prints**,
and it has a single rule: a withheld or absent figure prints as the word, never as zero. A
suppressed team's `RespondentCount` is zero by construction, so printing it would state that
nobody on that team answered — a claim about three named people. Both branches are mutation-
tested.

## Why criterion 2 is a decision and not a task

The criterion says share links should "follow the same expiry/revocation rules as report public
links". The **rules** are settled — `ReportShare` already models mint, expire, revoke and
count, and makes expired, revoked and invalid tokens indistinguishable to a caller. Copying
that machinery for dashboards is ordinary work.

What is not settled is **which dashboard figures may be published to whoever holds a URL.**

Today this product has exactly one anonymous public surface: `GET /shared/reports/{token}`. It
is guarded by `PublicReportProjection`, an allowlist that fails closed, with a per-field ruling
for every field of every type an admitted section reaches. It is built that way because of an
incident, recorded in its own remarks: `ReportBenchmarkComparison.CompanyId` — a tenant GUID —
once reached a payload served to the whole internet.

A dashboard share link would be the **second** such surface, and the payload behind it is not a
report:

- The company dashboard carries a department table. Department names are org-chart data, and
  the per-department completed-response counts beside them are *not* floored on this payload —
  deliberately, because a company admin reading their own tenant is a different disclosure from
  an anonymous reader. `DepartmentList` withholds them in the second case. **A share link makes
  every reader the second case**, so the projection would have to re-decide every column.
- The department dashboard carries a climate reading whose suppression is already correct for a
  leader looking at their own team — a population that, per the ruling of 2026-08-27, knows its
  own size. An anonymous holder of a forwarded URL does not.
- `MemberCount` and `ActiveMemberCount` are unfloored headcounts. On a small team those are the
  denominator someone needs to turn a published rate back into individuals.

None of that makes sharing wrong. It makes it a **field-by-field ruling on a government
client's employee data**, of exactly the kind `docs/decisions/public-report-share-shape.md`
records for `Comparison` and `Scope` — and the same reasoning applies: this codebase's privacy
boundaries are the owner's to set, not a default an implementer picks while wiring a section up.

## What is being asked

1. **Should a dashboard be shareable on an anonymous link at all?** "No" is a complete answer,
   and it closes criterion 2 as not-applicable rather than leaving it open. The export already
   gives an administrator a file they can send to a named person, which is what most requests
   for "share this dashboard" actually mean.
2. **If yes**, then per field: department names, per-department response counts, member
   headcounts, climate dimension scores. The floor of 5 applies to the scores already; it does
   **not** currently apply to the counts on the company payload.

## If it is built, the shape is already determined

Not a new invention — the pieces exist and should be reused rather than paralleled:

- A `DashboardShare` row modelled on `ReportShare` (a table, not columns: a revoked link and a
  never-minted one must not be the same row, or the trail cannot answer "who opened the link we
  revoked in March").
- A `PublicDashboardDocument` with the same tripwire `PublicReportProjection` uses — every
  section named in a `StoredSectionsRuledOn` set, so a field added later cannot reach the
  internet merely because nobody thought about it.
- The web half is the existing `ReportSharePanel`, which already mints, lists and revokes.

## Decision

```
Anonymous dashboard share links:  ____  (no | yes, with a per-field ruling)
Decided by: ____
Date: ____
```
